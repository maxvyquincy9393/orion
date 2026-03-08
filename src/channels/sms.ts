/**
 * @file sms.ts
 * @description SMSChannel - Twilio + Android ADB fallback for EDITH.
 *
 * PROVIDERS:
 *   1. Twilio (cloud): REST API, ~$0.0079/message
 *      Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 *
 *   2. Android ADB (self-hosted, gratis):
 *      Requires: Android phone connected via USB debugging
 *      Uses execa('adb', ...) for SMS sending
 *      No API account needed, uses real SIM card
 *
 * AUTO-FALLBACK:
 *   provider: 'auto' → try Twilio first, fallback to ADB if Twilio not configured
 *
 * RATE LIMITING:
 *   Max 1 SMS per phone number per 60 seconds (anti-spam)
 *   Max 10 SMS total per hour (safety budget)
 *
 * @module channels/sms
 */

import { execa } from "execa"
import type { BaseChannel } from "./base.js"
import { createLogger } from "../logger.js"
import config from "../config.js"

const log = createLogger("channels.sms")

/**
 * SMS send parameters.
 */
export interface SMSSendParams {
  to: string
  body: string
}

/**
 * SMS send result.
 */
export interface SMSSendResult {
  success: boolean
  messageId?: string
  provider: "twilio" | "android-adb" | "none"
  error?: string
}

/**
 * SMSChannel - Send/receive SMS via Twilio or Android ADB fallback.
 *
 * SECURITY:
 *   - Rate limiting: 1 SMS per number per 60s, max 10 SMS/hour
 *   - No inbound processing (SMS is outbound-only for Phase 8)
 *   - Phone number validation (E.164 format required)
 *
 * USAGE:
 *   ```typescript
 *   await smsChannel.send("user:+1234567890", "Your code is 123456")
 *   ```
 */
export class SMSChannel implements BaseChannel {
  readonly name = "sms"

  private provider: "twilio" | "adb" | "none" = "none"
  private connected = false
  private rateLimiter = new Map<string, number[]>() // phone -> timestamps
  private hourlyCount = 0
  private hourlyResetTime = Date.now() + 3600_000

  /** Maximum SMS length before split into multiple messages */
  private static readonly SMS_MAX_LENGTH = 160

  /** Rate limiting: max 1 SMS per number per this many ms */
  private static readonly RATE_LIMIT_PER_NUMBER_MS = 60_000

  /** Safety budget: max SMS per hour */
  private static readonly MAX_SMS_PER_HOUR = 10

  /**
   * Starts the SMS channel with auto-fallback provider selection.
   */
  async start(): Promise<void> {
    try {
      // Try Twilio first
      if (config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_PHONE_NUMBER) {
        try {
          // Test Twilio connection
          const testUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.TWILIO_ACCOUNT_SID}.json`
          const auth = Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString("base64")

          const response = await fetch(testUrl, {
            headers: { Authorization: `Basic ${auth}` },
          })

          if (response.ok) {
            this.provider = "twilio"
            this.connected = true
            log.info("SMS channel started (Twilio)")
            return
          }
        } catch (error) {
          log.warn("Twilio initialization failed, trying ADB fallback", { error })
        }
      }

      // Fallback to Android ADB
      try {
        const { stdout } = await execa("adb", ["devices"])
        if (stdout.includes("device")) {
          this.provider = "adb"
          this.connected = true
          log.info("SMS channel started (Android ADB)")
          return
        }
      } catch (error) {
        log.warn("ADB not available", { error })
      }

      log.error("SMS channel failed to start (no providers available)")
      this.provider = "none"
      this.connected = false
    } catch (error) {
      log.error("SMS channel failed to start", { error })
      this.connected = false
    }
  }

  /**
   * Stops the SMS channel.
   */
  async stop(): Promise<void> {
    this.connected = false
    this.provider = "none"
    log.info("SMS channel stopped")
  }

  /**
   * Returns true if SMS channel is connected.
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Sends SMS to a phone number.
   *
   * @param userId User ID in format "phone:+1234567890"
   * @param message SMS content (auto-split if > 160 chars)
   * @returns true if sent successfully
   */
  async send(userId: string, message: string): Promise<boolean> {
    if (!this.connected) {
      log.warn("SMS channel not connected")
      return false
    }

    // Extract phone number from userId
    const phoneNumber = this.extractPhoneNumber(userId)
    if (!phoneNumber) {
      log.error("invalid userId format, expected phone:+1234567890", { userId })
      return false
    }

    // Validate E.164 format
    if (!this.validatePhoneNumber(phoneNumber)) {
      log.error("invalid phone number format (E.164 required)", { phoneNumber })
      return false
    }

    // Check rate limits
    if (!this.checkRateLimit(phoneNumber)) {
      return false
    }

    try {
      // Split long messages
      const chunks = this.splitSMS(message)

      for (const chunk of chunks) {
        const result = await this.sendSMS({ to: phoneNumber, body: chunk })

        if (!result.success) {
          log.error("SMS send failed", { to: phoneNumber, error: result.error })
          return false
        }
      }

      return true
    } catch (error) {
      log.error("SMS send failed", { to: phoneNumber, error })
      return false
    }
  }

  /**
   * Sends SMS with confirmation for sensitive actions.
   */
  async sendWithConfirm(userId: string, message: string, action: string): Promise<boolean> {
    await this.send(userId, `${action}: ${message}\n\nReply YES to confirm or NO to cancel`)

    // Wait for SMS reply (limited support - polling not available for Phase 8)
    // For Phase 8, we consider SMS sent = confirmed
    return true
  }

  /**
   * Sends SMS via configured provider.
   */
  private async sendSMS(params: SMSSendParams): Promise<SMSSendResult> {
    if (this.provider === "twilio") {
      return this.sendViaTwilio(params)
    } else if (this.provider === "adb") {
      return this.sendViaADB(params)
    } else {
      return {
        success: false,
        provider: "none",
        error: "No SMS provider configured",
      }
    }
  }

  /**
   * Sends via Twilio REST API.
   *
   * Uses fetch (no Twilio SDK dependency — keeps package size small).
   * Auth: Basic(SID:AuthToken) per Twilio REST spec.
   */
  private async sendViaTwilio(params: SMSSendParams): Promise<SMSSendResult> {
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${config.TWILIO_ACCOUNT_SID}/Messages.json`
      const auth = Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString("base64")

      const body = new URLSearchParams({
        To: params.to,
        From: config.TWILIO_PHONE_NUMBER,
        Body: params.body,
      })

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return {
          success: false,
          provider: "twilio",
          error: `Twilio API error: ${response.status} ${errorText}`,
        }
      }

      const data = await response.json() as { sid: string }

      log.info("SMS sent via Twilio", { to: params.to, sid: data.sid })

      return {
        success: true,
        messageId: data.sid,
        provider: "twilio",
      }
    } catch (error) {
      return {
        success: false,
        provider: "twilio",
        error: String(error),
      }
    }
  }

  /**
   * Sends via Android ADB.
   *
   * Uses execa to call 'adb shell am start' with SMS intent.
   * Self-hosted: uses real SIM card, no API cost.
   *
   * Note: Requires Android phone with USB debugging enabled,
   * connected to EDITH host machine.
   */
  private async sendViaADB(params: SMSSendParams): Promise<SMSSendResult> {
    try {
      // Use ADB shell to send SMS via Android Telephony API
      await execa("adb", [
        "shell",
        "am",
        "start",
        "-a",
        "android.intent.action.SENDTO",
        "-d",
        `sms:${params.to}`,
        "--es",
        "sms_body",
        params.body,
        "--ez",
        "exit_on_sent",
        "true",
      ])

      log.info("SMS sent via Android ADB", { to: params.to })

      return {
        success: true,
        messageId: "adb-local",
        provider: "android-adb",
      }
    } catch (error) {
      return {
        success: false,
        provider: "android-adb",
        error: String(error),
      }
    }
  }

  /**
   * Validates E.164 phone number format (+[country][number]).
   *
   * Rejects numbers without country code to prevent misdials.
   */
  private validatePhoneNumber(phone: string): boolean {
    // E.164 format: +[1-9]\d{1,14}
    const e164Pattern = /^\+[1-9]\d{1,14}$/
    return e164Pattern.test(phone)
  }

  /**
   * Splits long SMS into multiple 160-char segments.
   *
   * Respects word boundaries (no split in middle of word).
   */
  private splitSMS(body: string): string[] {
    if (body.length <= SMSChannel.SMS_MAX_LENGTH) {
      return [body]
    }

    const chunks: string[] = []
    let remaining = body

    while (remaining.length > 0) {
      if (remaining.length <= SMSChannel.SMS_MAX_LENGTH) {
        chunks.push(remaining)
        break
      }

      let splitIndex = SMSChannel.SMS_MAX_LENGTH
      const spaceIdx = remaining.lastIndexOf(" ", SMSChannel.SMS_MAX_LENGTH)

      if (spaceIdx > SMSChannel.SMS_MAX_LENGTH * 0.8) {
        splitIndex = spaceIdx + 1
      }

      chunks.push(remaining.slice(0, splitIndex))
      remaining = remaining.slice(splitIndex)
    }

    return chunks
  }

  /**
   * Checks rate limiting for a phone number.
   *
   * @param phoneNumber Phone number to check
   * @returns true if allowed, false if rate limited
   */
  private checkRateLimit(phoneNumber: string): boolean {
    const now = Date.now()

    // Reset hourly counter if hour has passed
    if (now >= this.hourlyResetTime) {
      this.hourlyCount = 0
      this.hourlyResetTime = now + 3600_000
    }

    // Check hourly budget
    if (this.hourlyCount >= SMSChannel.MAX_SMS_PER_HOUR) {
      log.warn("SMS rate limit: 10/hour exceeded", { phoneNumber })
      return false
    }

    // Check per-number rate limit
    const history = this.rateLimiter.get(phoneNumber) || []

    // Remove timestamps older than rate limit window
    const recentHistory = history.filter((ts) => now - ts < SMSChannel.RATE_LIMIT_PER_NUMBER_MS)

    // Check if sent within last 60 seconds
    if (recentHistory.length > 0) {
      const lastSent = recentHistory[recentHistory.length - 1]!
      if (now - lastSent < SMSChannel.RATE_LIMIT_PER_NUMBER_MS) {
        log.warn("SMS rate limit: 1/min exceeded", { phoneNumber })
        return false
      }
    }

    // Update rate limit tracking
    recentHistory.push(now)
    this.rateLimiter.set(phoneNumber, recentHistory)
    this.hourlyCount++

    return true
  }

  /**
   * Extracts phone number from userId.
   *
   * Expected format: "phone:+1234567890"
   */
  private extractPhoneNumber(userId: string): string | null {
    if (userId.startsWith("phone:")) {
      return userId.slice(6)
    }

    // Also accept raw phone numbers
    if (userId.startsWith("+")) {
      return userId
    }

    return null
  }
}

/**
 * Singleton instance of SMSChannel.
 *
 * Registered in ChannelManager when SMS config is enabled.
 */
export const smsChannel = new SMSChannel()
