/**
 * @file social-draft.ts
 * @description Generates contextually-appropriate draft messages to known people
 * using their `StyleProfile`. Useful for reconnecting with dormant contacts or
 * writing messages in a style that matches prior communication patterns.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Called from `social-skill.ts` on user request ("Draft a message to Alice")
 *   - Uses `StyleProfile` from the people graph as context
 *   - Uses `orchestrator.generate("fast", ...)` for generation
 *
 * DESIGN:
 *   - If no style profile exists, generates a generic polite message
 *   - The prompt explicitly instructs the LLM to match the style profile
 */

import { createLogger } from "../../logger.js"
import { orchestrator } from "../../engines/orchestrator.js"
import { peopleGraph } from "./people-graph.js"
import type { StyleProfile } from "./people-schema.js"

const log = createLogger("memory.people.social-draft")

// ── Types ──────────────────────────────────────────────────────────────────────

/** Parameters for drafting a message */
export interface DraftRequest {
  /** User who is composing the message */
  userId: string
  /** Person to send to */
  personId: string
  /** Purpose / intent of the message */
  intent: string
  /** Additional context (optional) */
  context?: string
  /** Channel to draft for (affects language register) */
  channel?: string
}

/** Generated draft result */
export interface DraftResult {
  /** The drafted message text */
  draft: string
  /** Person name (for display) */
  recipientName: string
  /** Style hints used */
  styleHints: string[]
}

// ── SocialDraft ───────────────────────────────────────────────────────────────

/**
 * Generates personalized message drafts based on relationship context.
 */
export class SocialDraft {
  /**
   * Draft a message to the specified person.
   *
   * @param req - Draft request parameters
   * @returns Generated draft + metadata
   */
  async draft(req: DraftRequest): Promise<DraftResult> {
    const person = await peopleGraph.getById(req.userId, req.personId)
    if (!person) {
      throw new Error(`Person not found: ${req.personId}`)
    }

    const style = person.communicationStyle
    const styleHints = this.buildStyleHints(style)
    const systemPrompt = this.buildSystemPrompt(person.name, style, req.channel)
    const userPrompt = this.buildUserPrompt(person.name, req.intent, req.context)

    const draft = await orchestrator.generate("fast", {
      prompt: userPrompt,
      systemPrompt,
    })

    log.debug("draft generated", { personId: req.personId, intent: req.intent })

    return {
      draft: draft.trim(),
      recipientName: person.name,
      styleHints,
    }
  }

  /**
   * Quick one-liner draft for reconnecting with a dormant contact.
   *
   * @param userId   - User scope
   * @param personId - Person to reconnect with
   * @returns Short draft message
   */
  async draftReconnect(userId: string, personId: string): Promise<DraftResult> {
    return this.draft({
      userId,
      personId,
      intent: "reconnect after a long absence — keep it short and warm",
    })
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private buildSystemPrompt(
    name: string,
    style: StyleProfile | undefined,
    channel?: string,
  ): string {
    const lines = [
      `You are helping draft a message to ${name}.`,
      "Write a single, ready-to-send message. No alternatives, no explanation.",
    ]

    if (style) {
      if (style.formality >= 4) lines.push("Use formal language.")
      else if (style.formality <= 2) lines.push("Use casual, friendly language.")
      if (style.emojiUsage === 0) lines.push("Do NOT use emojis.")
      else if (style.emojiUsage === 2) lines.push("Use a couple of relevant emojis naturally.")
      if (style.messageLength === "short") lines.push("Keep it very brief — 1-2 sentences max.")
      if (style.language && style.language !== "en")
        lines.push(`Write in ${style.language}.`)
      if (style.greetings?.length)
        lines.push(`Example greeting style: "${style.greetings[0]}"`)
    }

    if (channel === "email") lines.push("Format as an email (Subject + body).")
    if (channel === "slack" || channel === "discord") lines.push("Format as a Slack/Discord message.")

    return lines.join("\n")
  }

  private buildUserPrompt(name: string, intent: string, context?: string): string {
    let prompt = `Draft a message to ${name}.\nPurpose: ${intent}`
    if (context) prompt += `\nContext: ${context}`
    return prompt
  }

  private buildStyleHints(style: StyleProfile | undefined): string[] {
    if (!style) return ["no style profile yet"]
    const hints: string[] = []
    const formalityLabel = ["", "very casual", "casual", "neutral", "formal", "very formal"][
      Math.round(style.formality)
    ]
    if (formalityLabel) hints.push(`formality: ${formalityLabel}`)
    hints.push(`emoji: ${ ["none", "occasional", "frequent"][style.emojiUsage] }`)
    hints.push(`length: ${style.messageLength}`)
    if (style.language !== "en") hints.push(`language: ${style.language}`)
    return hints
  }
}

/** Singleton social draft */
export const socialDraft = new SocialDraft()
