/**
 * @file social-skill.ts
 * @description Skill wrapper exposing Phase 18 social memory capabilities to
 * the EDITH pipeline. Handles intents like "Who is Alice?", "I had a meeting
 * with Bob", "Draft a message to Carol", "Who have I not talked to lately?".
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Implements `Skill` interface from `src/skills/manager.ts`
 *   - Register in `src/core/startup.ts` via `skillManager.register(socialSkill)`
 *   - Delegates to: `peopleGraph`, `interactionTracker`, `socialDraft`,
 *     `dormantDetector`, `styleLearner`
 *
 * TRIGGER KEYWORDS:
 *   - "who is / tell me about [name]"
 *   - "had a meeting/call/email with [name]"
 *   - "draft a message to [name]"
 *   - "reconnect with [name]"
 *   - "who haven't I talked to / dormant contacts"
 */

import { createLogger } from "../logger.js"
import type { Skill } from "./manager.js"
import { peopleGraph } from "../memory/people/people-graph.js"
import { interactionTracker } from "../memory/people/interaction-tracker.js"
import { socialDraft } from "../memory/people/social-draft.js"
import { dormantDetector } from "../memory/people/dormant-detector.js"
import { styleLearner } from "../memory/people/style-learner.js"
import { computePersonStats } from "../memory/people/interaction-stats.js"
import type { InteractionType } from "../memory/people/people-schema.js"

const log = createLogger("skills.social")

// ── Intent Patterns ────────────────────────────────────────────────────────────

const INTENT_WHO_IS =
  /(?:who is|tell me about|what do you know about|info about)\s+(.+)/i

const INTENT_LOG_INTERACTION =
  /(?:i had a|had a|logged a|just had a?|i just had a?)\s+(meeting|call|email|chat|lunch|coffee|sync|catch[- ]?up)\s+(?:with|w\/)\s+(.+)/i

const INTENT_DRAFT =
  /(?:draft|write|compose)\s+(?:a\s+)?(?:message|email|text|msg|note)\s+(?:to|for)\s+(.+)/i

const INTENT_RECONNECT =
  /(?:reconnect with|reach out to|ping)\s+(.+)/i

const INTENT_DORMANT =
  /(?:who (?:have|haven'?t) i (?:not )?(?:talked|spoken|connected) (?:to |with )?(?:lately|recently|in a while))|dormant contacts?/i

const INTENT_STYLE =
  /(?:how does|what'?s?|describe)\s+(.+?)\s+(?:usually |typically )?(?:communicate|write|message|talk)/i

// ── Skill Definition ──────────────────────────────────────────────────────────

export const socialSkill: Skill = {
  name: "social",
  description:
    "Manage relationships and people memory. Use for: who is [name], had a meeting with [name], draft message to [name], dormant contacts, reconnect with [name], communication style of [name].",
  trigger:
    /(?:who is|tell me about|had a (?:meeting|call|email)|draft.*(?:message|email)|reconnect with|dormant contacts?|who haven'?t i talked to)/i,

  execute: async (input: string, userId: string): Promise<string> => {
    log.info("social skill invoked", { intent: input.slice(0, 100), userId })

    // ── Who is [name]? ────────────────────────────────────────────────────────
    const whoMatch = input.match(INTENT_WHO_IS)
    if (whoMatch) {
      const name = whoMatch[1].trim()
      const person = await peopleGraph.findByName(userId, name)
      if (!person) return `I don't have anyone named "${name}" in your contacts yet. Tell me more about them and I'll remember.`

      const interactions = await peopleGraph.getInteractions(person.id, 20)
      const stats = computePersonStats(person.id, person.name, interactions)

      const lines = [
        `**${person.name}** (${person.relationship}, ${person.context})`,
        `Interactions: ${person.interactionCount} | Last seen: ${person.lastSeen.toLocaleDateString()}`,
        stats.topTopics.length ? `Common topics: ${stats.topTopics.slice(0, 3).join(", ")}` : "",
        person.notes ? `Notes: ${person.notes}` : "",
      ].filter(Boolean)

      return lines.join("\n")
    }

    // ── Logged a meeting/call with [name] ────────────────────────────────────
    const logMatch = input.match(INTENT_LOG_INTERACTION)
    if (logMatch) {
      const rawType = logMatch[1].toLowerCase()
      const name = logMatch[2].split(/[,.!?]/)[0].trim()

      const typeMap: Record<string, InteractionType> = {
        meeting: "meeting", sync: "meeting", call: "call",
        email: "email", chat: "meeting", coffee: "meeting",
        lunch: "meeting", "catch-up": "meeting", catchup: "meeting",
      }
      const interactionType: InteractionType = typeMap[rawType] ?? "meeting"

      let person = await peopleGraph.findByName(userId, name)
      if (!person) {
        person = await peopleGraph.upsertPerson(userId, {
          name,
          relationship: "contact",
          context: "other",
          sentiment: "neutral",
          snippet: input.slice(0, 80),
        })
      }

      await interactionTracker.log(
        userId, person.id, interactionType,
        input.slice(0, 200), "", "neutral",
      )

      void styleLearner.updateStyle(userId, person.id).catch(err =>
        log.warn("style update failed", { err }),
      )

      return `Got it — logged a ${interactionType} with **${person.name}**.`
    }

    // ── Draft a message to [name] ─────────────────────────────────────────────
    const draftMatch = input.match(INTENT_DRAFT)
    if (draftMatch) {
      const name = draftMatch[1].split(/\s+(?:about|regarding|re:|for)\b/i)[0].trim()
      const person = await peopleGraph.findByName(userId, name)
      if (!person) return `I don't know "${name}" yet. Add them first.`

      const intentPart = input.replace(INTENT_DRAFT, "").trim() || "check in"
      const result = await socialDraft.draft({
        userId, personId: person.id,
        intent: intentPart || "check in and reconnect",
      })

      return `Here's a draft for **${result.recipientName}**:\n\n${result.draft}\n\n_Style: ${result.styleHints.join(", ")}_`
    }

    // ── Reconnect with [name] ─────────────────────────────────────────────────
    const reconnectMatch = input.match(INTENT_RECONNECT)
    if (reconnectMatch) {
      const name = reconnectMatch[1].trim()
      const person = await peopleGraph.findByName(userId, name)
      if (!person) return `I don't know "${name}" yet.`

      const result = await socialDraft.draftReconnect(userId, person.id)
      return `Here's a reconnect message for **${result.recipientName}**:\n\n${result.draft}`
    }

    // ── Dormant contacts ──────────────────────────────────────────────────────
    if (INTENT_DORMANT.test(input)) {
      const dormant = await dormantDetector.detectDormant(userId)
      if (dormant.length === 0) return "All your contacts are looking active — no dormant relationships detected."

      const lines = dormant.map(r => `• **${r.personName}** — ${r.message}`)
      return `**Dormant contacts:**\n${lines.join("\n")}`
    }

    // ── Communication style of [name] ─────────────────────────────────────────
    const styleMatch = input.match(INTENT_STYLE)
    if (styleMatch) {
      const name = styleMatch[1].trim()
      const person = await peopleGraph.findByName(userId, name)
      if (!person) return `I don't know "${name}" yet.`

      if (!person.communicationStyle) {
        return `I don't have enough interaction history with ${person.name} to infer a style yet.`
      }
      const s = person.communicationStyle
      return [
        `**${person.name}'s communication style:**`,
        `Formality: ${s.formality}/5 | Emoji: ${ ["none","occasional","frequent"][s.emojiUsage] } | Length: ${s.messageLength}`,
        s.greetings.length ? `Common greetings: ${s.greetings.slice(0, 2).join(", ")}` : "",
        s.phrases.length ? `Signature phrases: ${s.phrases.slice(0, 3).join(", ")}` : "",
      ].filter(Boolean).join("\n")
    }

    // ── Fallback ──────────────────────────────────────────────────────────────
    const all = await peopleGraph.listAll(userId)
    if (all.length === 0) return "Your people graph is empty. Mention someone in conversation and I'll start tracking!"
    return `I know about ${all.length} people in your network. Ask me about anyone specifically.`
  },
}
