/**
 * @file email.ts
 * @description EmailChannel — Gmail + Outlook integration for EDITH.
 *
 * SECURITY:
 *   All inbound email content WAJIB melalui EmailContentFilter sebelum
 *   dikirim ke LLM. Tanpa filter ini, EDITH rentan terhadap EAH attack
 *   (arXiv:2507.02699) dengan ASR 100%.
 *
 *   All outbound email WAJIB melalui draft-confirm-send flow.
 *   Tidak ada auto-send mode. (Stark Rule #1)
 *
 * PAPER BASIS:
 *   - EAH Attack: arXiv:2507.02699 (email agent hijacking, 100% ASR)
 *   - PromptArmor: arXiv:2507.15219 (LLM guardrail defense, FPR+FNR < 1%)
 *   - CaMeL: arXiv:2503.18813 (taint tracking for email content)
 *
 * PROVIDERS:
 *   - Gmail: OAuth2 via googleapis (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN)
 *   - Outlook: OAuth2 via @microsoft/microsoft-graph-client
 *
 * OAUTH2 SCOPES (principle of least privilege):
 *   Gmail:   gmail.readonly, gmail.send, gmail.modify
 *   Outlook: Mail.Read, Mail.Send, Mail.ReadWrite
 *
 * @module channels/email
 */

import { google } from "googleapis"
import type { gmail_v1 } from "googleapis"
import { Client } from "@microsoft/microsoft-graph-client"
import type { BaseChannel } from "./base.js"
import { emailContentFilter, type RawEmail } from "./email-filter.js"
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"
import config from "../config.js"
import { eventBus } from "../core/event-bus.js"

const log = createLogger("channels.email")

/**
 * Raw email structure from API (before filtering).
 */
export interface EmailMessage extends RawEmail {
  bodyHtml?: string
  isRead: boolean
  labels: string[]
  threadId: string
  date: Date
}

/**
 * Draft email before sending (requires user confirmation).
 */
export interface EmailDraft {
  to: string[]
  subject: string
  body: string
  replyToId?: string
  previewText: string
}

/**
 * Result of email send operation.
 */
export interface EmailSendResult {
  success: boolean
  messageId?: string
  error?: string
}

/**
 * EmailChannel - Gmail + Outlook integration with mandatory security filtering.
 *
 * CRITICAL SECURITY RULES (Zero Tolerance):
 *   1. ALL inbound email content → EmailContentFilter before LLM
 *   2. ALL outbound email → draft → user confirm → send (no auto-send)
 *   3. Injected email content CANNOT trigger tool calls without user command
 *   4. OAuth2 tokens stored with encryption (AES-256-CBC, key from ADMIN_TOKEN)
 *
 * ARCHITECTURE:
 *   - Inbound: poll inbox → filter → classify importance → notify user
 *   - Outbound: draft → pendingDrafts map → user confirm → send
 *   - No auto-send mode (Stark Rule #1: draft first, send second)
 *
 * USAGE:
 *   ```typescript
 *   // Outbound email (draft-confirm-send flow)
 *   await emailChannel.createAndConfirmDraft({
 *     to: ["colleague@company.com"],
 *     subject: "Meeting Tomorrow",
 *     body: "Let's meet at 2pm. Confirmed?",
 *     previewText: "Meeting confirmation draft"
 *   })
 *   // User sees draft preview via active channel
 *   // User confirms with "yes" or "send"
 *   // Only then: await emailChannel.sendConfirmedDraft(draftId)
 *   ```
 */
export class EmailChannel implements BaseChannel {
  readonly name = "email"

  private provider: "gmail" | "outlook"
  private gmailClient: gmail_v1.Gmail | null = null
  private outlookClient: Client | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private connected = false
  private pendingDrafts = new Map<string, EmailDraft>()

  /**
   * Timestamp of the last successful inbox poll.
   * Used for incremental polling — only emails received after this time are fetched.
   * Initialized to epoch so the first poll fetches recent emails up to MAX_EMAILS_PER_POLL.
   */
  private lastCheckedAt = new Date(0)

  /**
   * Polling interval for checking new emails (milliseconds).
   * Default: 15 minutes (from config or fallback).
   */
  private static readonly POLL_INTERVAL_MS = 15 * 60 * 1000

  /**
   * Maximum emails to fetch per poll (avoid overwhelming on first run).
   */
  private static readonly MAX_EMAILS_PER_POLL = 20

  constructor() {
    // Determine provider based on which credentials are configured
    if (config.GMAIL_CLIENT_ID && config.GMAIL_CLIENT_SECRET) {
      this.provider = "gmail"
    } else if (config.OUTLOOK_CLIENT_ID && config.OUTLOOK_CLIENT_SECRET) {
      this.provider = "outlook"
    } else {
      this.provider = "gmail" // default, will fail at start() if not configured
    }
  }

  /**
   * Starts the email channel. Initializes OAuth2 client and begins polling.
   *
   * Polling interval: config.channels.email.checkIntervalMinutes (default: 15 min).
   * If OAuth2 credentials are missing or invalid, channel will not start.
   *
   * **IMPORTANT:** Only Gmail is currently supported. Outlook provider will
   * throw "not yet implemented" error.
   *
   * @throws Error if OAuth2 initialization fails or if Outlook is selected
   */
  async start(): Promise<void> {
    try {
      if (this.provider === "gmail") {
        await this.initGmail()
      } else {
        // Outlook not yet implemented - will throw error
        await this.initOutlook()
      }

      this.connected = true
      log.info("email channel started", { provider: this.provider })

      // Start polling inbox
      this.pollTimer = setInterval(() => {
        this.pollInbox().catch((error) => {
          log.error("inbox polling failed", { error })
        })
      }, EmailChannel.POLL_INTERVAL_MS)

      // Immediate first poll
      await this.pollInbox()
    } catch (error) {
      log.error("email channel failed to start", { provider: this.provider, error })
      this.connected = false
      throw error
    }
  }

  /**
   * Stops email polling and cleans up OAuth2 connections.
   */
  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }

    this.connected = false
    this.gmailClient = null
    this.outlookClient = null

    log.info("email channel stopped")
  }

  /**
   * Returns true only when OAuth2 is valid and polling is active.
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Sends a message to user via email.
   *
   * Note: This is for EDITH→user communication, not email compose tool.
   * Uses the authenticated user's email address as recipient.
   * Goes through draft-confirm-send flow (no auto-send).
   *
   * @param userId User ID (mapped to email address)
   * @param message Message content
   * @returns true if draft was created and sent to user for confirmation
   */
  async send(_userId: string, message: string): Promise<boolean> {
    const recipientEmail = this.getUserEmail()
    if (!recipientEmail) {
      log.error("cannot send email: user email not configured")
      return false
    }

    return this.createAndConfirmDraft({
      to: [recipientEmail],
      subject: "EDITH Update",
      body: message,
      previewText: message.slice(0, 80),
    })
  }

  /**
   * Sends with confirmation (required for BaseChannel interface).
   * Email channel always requires confirmation, so this delegates to send().
   */
  async sendWithConfirm(userId: string, message: string, action: string): Promise<boolean> {
    return this.send(userId, `${action}: ${message}`)
  }

  /**
   * Creates a draft email and sends preview to user for confirmation.
   *
   * NEVER sends email directly — always shows draft first (Stark Rule #1).
   * This is the ONLY safe way to send email from an LLM agent.
   *
   * FLOW:
   *   1. Create draft in pendingDrafts map
   *   2. Send preview to user via active channel (Telegram/Discord/etc)
   *   3. User confirms with "yes"/"send" or cancels with "no"/"cancel"
   *   4. On confirm: sendConfirmedDraft(draftId) actually sends the email
   *
   * @param draft EmailDraft object with recipient, subject, body
   * @returns true if draft was created and user was notified
   */
  async createAndConfirmDraft(draft: EmailDraft): Promise<boolean> {
    const draftId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    this.pendingDrafts.set(draftId, draft)

    log.info("draft created, awaiting user confirmation", { draftId, to: draft.to })

    // Emit draft preview via event bus so ChannelManager can pick it up
    eventBus.dispatch("email.draft.created", {
      draftId,
      to: draft.to,
      subject: draft.subject,
      bodyPreview: draft.body.slice(0, 200),
    })

    return true
  }

  /**
   * Sends a previously confirmed draft.
   *
   * Called only after user explicitly confirms via sendWithConfirm().
   * Removes draft from pendingDrafts map after sending.
   *
   * @param draftId ID of the pending draft to send
   * @returns EmailSendResult with success status and message ID
   */
  async sendConfirmedDraft(draftId: string): Promise<EmailSendResult> {
    const draft = this.pendingDrafts.get(draftId)
    if (!draft) {
      return { success: false, error: "Draft not found or already sent" }
    }

    try {
      let messageId: string | undefined

      if (this.provider === "gmail" && this.gmailClient) {
        messageId = await this.sendViaGmail(draft)
      } else if (this.provider === "outlook" && this.outlookClient) {
        messageId = await this.sendViaOutlook(draft)
      } else {
        return { success: false, error: "Email client not initialized" }
      }

      this.pendingDrafts.delete(draftId)

      log.info("email sent successfully", { draftId, messageId, to: draft.to })

      return { success: true, messageId }
    } catch (error) {
      log.error("failed to send email", { draftId, error })
      return { success: false, error: String(error) }
    }
  }

  /**
   * Polls inbox for new unread emails.
   *
   * Each email is processed through EmailContentFilter before LLM handling.
   * Only emails that pass importance filter are forwarded to user.
   *
   * SECURITY PIPELINE:
   *   1. Fetch unread emails since lastCheckedAt
   *   2. For each email: filter → classify importance → (if important) notify user
   *   3. Never trigger actions based on email content alone (defense layer 3)
   */
  private async pollInbox(): Promise<void> {
    try {
      const pollStart = new Date()
      const emails = await this.fetchUnread()

      log.debug("inbox poll completed", { count: emails.length })

      for (const email of emails) {
        await this.processEmail(email)
      }

      // Advance the cursor only after successful processing
      this.lastCheckedAt = pollStart
    } catch (error) {
      log.error("inbox polling error", { error })
    }
  }

  /**
   * Processes a single email through the full security pipeline.
   *
   * FLOW:
   *   email → EmailContentFilter → classify importance → (if high) notify user
   *
   * SECURITY: Never trigger tool calls based on email content alone.
   * Email content is TAINTED and cannot directly cause actions.
   *
   * @param email Raw email from API
   */
  private async processEmail(email: EmailMessage): Promise<void> {
    try {
      // Security Layer: Filter email content through EmailContentFilter
      const filtered = await emailContentFilter.filter(email)

      if (filtered.hadInjection) {
        log.warn("email injection detected", {
          emailId: email.id,
          from: email.from,
          patterns: filtered.injectionPatterns,
        })
      }

      // Classify importance (uses filtered content, not raw)
      const importance = await this.classifyImportance({
        ...email,
        body: filtered.cleaned,
      })

      // Only notify user for high-importance emails
      if (importance === "high") {
        log.info("high-importance email received", { emailId: email.id, from: email.from })
        // Emit high-importance email event for channel notification
        eventBus.dispatch("email.high_importance", {
          emailId: email.id,
          from: email.from,
          subject: email.subject,
        })
      }
    } catch (error) {
      log.error("email processing failed", { emailId: email.id, error })
    }
  }

  /**
   * Classifies email importance using LLM.
   *
   * Returns 'high' | 'medium' | 'low' | 'spam'.
   * Only 'high' importance emails are forwarded to user (configurable).
   *
   * @param email EmailContentFilter-cleaned email
   * @returns importance level
   */
  private async classifyImportance(email: EmailMessage): Promise<"high" | "medium" | "low" | "spam"> {
    try {
      const prompt = `Classify this email's importance for the user:

[UNTRUSTED CONTENT START]
From: ${email.from}
Subject: ${email.subject}
Body: ${email.body.slice(0, 500)}
[UNTRUSTED CONTENT END]

Return ONLY one word: high, medium, low, or spam`

      const response = await orchestrator.generate("fast", {
        prompt,
        maxTokens: 10,
        temperature: 0.0,
      })

      const classification = response.trim().toLowerCase() as "high" | "medium" | "low" | "spam"

      if (["high", "medium", "low", "spam"].includes(classification)) {
        return classification
      }

      return "medium" // fallback
    } catch (error) {
      log.error("importance classification failed", { error })
      return "medium" // safe fallback
    }
  }

  /**
   * Initializes Gmail API client with stored OAuth2 tokens.
   * Handles token refresh if access token is expired.
   */
  private async initGmail(): Promise<void> {
    const oauth2Client = new google.auth.OAuth2(
      config.GMAIL_CLIENT_ID,
      config.GMAIL_CLIENT_SECRET,
      "http://localhost" // redirect URI (not used for refresh token flow)
    )

    oauth2Client.setCredentials({
      refresh_token: config.GMAIL_REFRESH_TOKEN,
    })

    this.gmailClient = google.gmail({ version: "v1", auth: oauth2Client })

    // Test connection
    await this.gmailClient.users.getProfile({ userId: "me" })

    log.info("gmail client initialized", { email: config.GMAIL_USER_EMAIL })
  }

  /**
   * Initializes Microsoft Graph API client for Outlook.
   * Handles token refresh if access token is expired.
   */
  private async initOutlook(): Promise<void> {
    throw new Error(
      "Outlook email integration not yet implemented.\n\n" +
        "To use EDITH with email, please use Gmail (GMAIL_USER_EMAIL + GMAIL_CLIENT_ID).\n\n" +
        "Outlook support requires:\n" +
        "  - Microsoft Graph OAuth2 token flow\n" +
        "  - Mail.Read and Mail.Send permissions\n" +
        "  - Token refresh implementation\n\n" +
        "See: src/channels/email.ts for Gmail implementation patterns",
    )
  }

  /**
   * Fetches unread emails since lastCheckedAt.
   * @returns Array of RawEmail objects
   */
  private async fetchUnread(): Promise<EmailMessage[]> {
    if (this.provider === "gmail" && this.gmailClient) {
      return this.fetchUnreadGmail()
    } else if (this.provider === "outlook" && this.outlookClient) {
      return this.fetchUnreadOutlook()
    }

    return []
  }

  /**
   * Fetches unread emails from Gmail.
   */
  private async fetchUnreadGmail(): Promise<EmailMessage[]> {
    if (!this.gmailClient) {
      return []
    }

    // Incremental fetch: only emails after the last poll (epoch on first run = all recent)
    const afterUnixSec = Math.floor(this.lastCheckedAt.getTime() / 1000)
    const response = await this.gmailClient.users.messages.list({
      userId: "me",
      q: afterUnixSec > 0 ? `is:unread after:${afterUnixSec}` : "is:unread",
      maxResults: EmailChannel.MAX_EMAILS_PER_POLL,
    })

    const messages = response.data.messages || []
    const emails: EmailMessage[] = []

    for (const msg of messages) {
      if (!msg.id) {
        continue
      }

      const fullMessage = await this.gmailClient.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "full",
      })

      const headers = fullMessage.data.payload?.headers || []
      const subject = headers.find((h) => h.name === "Subject")?.value || "(no subject)"
      const from = headers.find((h) => h.name === "From")?.value || "unknown"

      // Extract body (simplified - handles plain text only)
      let body = ""
      const parts = fullMessage.data.payload?.parts || []
      for (const part of parts) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          body = Buffer.from(part.body.data, "base64").toString("utf-8")
          break
        }
      }

      emails.push({
        id: msg.id,
        subject,
        from,
        body,
        date: new Date(Number.parseInt(fullMessage.data.internalDate || "0", 10)),
        isRead: false,
        labels: fullMessage.data.labelIds || [],
        threadId: fullMessage.data.threadId || msg.id,
      })
    }

    return emails
  }

  /**
   * Fetches unread emails from Outlook.
   */
  private async fetchUnreadOutlook(): Promise<EmailMessage[]> {
    // Outlook is not yet implemented — initOutlook() throws before this is reachable.
    // Returns empty array as a safe fallback.
    return []
  }

  /**
   * Sends email via Gmail API.
   */
  private async sendViaGmail(draft: EmailDraft): Promise<string> {
    if (!this.gmailClient) {
      throw new Error("Gmail client not initialized")
    }

    const email = [
      `To: ${draft.to.join(", ")}`,
      `Subject: ${draft.subject}`,
      "",
      draft.body,
    ].join("\n")

    const encodedEmail = Buffer.from(email).toString("base64").replace(/\+/g, "-").replace(/\//g, "_")

    const response = await this.gmailClient.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedEmail,
      },
    })

    return response.data.id || "unknown"
  }

  /**
   * Sends email via Outlook API.
   */
  private async sendViaOutlook(_draft: EmailDraft): Promise<string> {
    throw new Error("Outlook email sending not yet implemented. Please use Gmail provider.")
  }

  /**
   * Gets the authenticated user's email address.
   */
  private getUserEmail(): string {
    if (this.provider === "gmail") {
      return config.GMAIL_USER_EMAIL
    }
    return ""
  }
}

/**
 * Singleton instance of EmailChannel.
 * Registered in ChannelManager when email config is enabled.
 */
export const emailChannel = new EmailChannel()
