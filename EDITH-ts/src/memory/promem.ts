import type { Message } from "@prisma/client"

import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"
import { memory } from "./store.js"

const log = createLogger("memory.promem")

const MAX_ROUNDS = 3

export class ProMemExtractor {
  async extract(userId: string, messages: Message[]): Promise<string[]> {
    if (messages.length === 0) {
      return []
    }

    try {
      const history = this.formatHistory(messages)
      let facts: string[] = []

      for (let round = 1; round <= MAX_ROUNDS; round += 1) {
        const newFacts = await this.probe(history, facts)
        if (newFacts.length === 0) {
          break
        }
        facts = [...facts, ...newFacts]
        log.debug(`ProMem round ${round}`, { newFacts: newFacts.length, total: facts.length })
      }

      const verified = await this.verify(facts, history)
      return verified
    } catch (error) {
      log.error("ProMem extract failed", error)
      return []
    }
  }

  private formatHistory(messages: Message[]): string {
    return messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n")
  }

  private async probe(history: string, previousFacts: string[]): Promise<string[]> {
    try {
      let prompt: string

      if (previousFacts.length === 0) {
        prompt = `Extract important facts about this user from the conversation history. Return as JSON array of strings. Only include facts that are clearly stated. Return [] if nothing important.

History:
${history.slice(0, 4000)}

Format: ["fact 1", "fact 2", ...]`
      } else {
        prompt = `Based on the conversation history, what important things about this user are NOT captured in these existing facts? Return as JSON array of new facts. Return [] if nothing new.

Existing facts:
${previousFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")}

History:
${history.slice(0, 4000)}

New facts (JSON array):`
      }

      const response = await orchestrator.generate("fast", { prompt })

      try {
        const cleaned = response.replace(/```json|```/g, "").trim()
        const facts = JSON.parse(cleaned)
        if (!Array.isArray(facts)) {
          return []
        }
        return facts.filter((f): f is string => typeof f === "string" && f.length > 10).slice(0, 10)
      } catch {
        return []
      }
    } catch (error) {
      log.error("ProMem probe failed", error)
      return []
    }
  }

  private async verify(facts: string[], history: string): Promise<string[]> {
    if (facts.length === 0) {
      return []
    }

    try {
      const prompt = `Verify these facts against the conversation history. Return only facts that have evidence in the history as JSON array. Remove any facts that cannot be verified.

Facts to verify:
${facts.map((f, i) => `${i + 1}. ${f}`).join("\n")}

History:
${history.slice(0, 4000)}

Verified facts (JSON array):`

      const response = await orchestrator.generate("fast", { prompt })

      try {
        const cleaned = response.replace(/```json|```/g, "").trim()
        const verified = JSON.parse(cleaned)
        if (!Array.isArray(verified)) {
          return facts.slice(0, 5)
        }
        return verified.filter((f): f is string => typeof f === "string" && f.length > 10)
      } catch {
        return facts.slice(0, 5)
      }
    } catch (error) {
      log.error("ProMem verify failed", error)
      return facts.slice(0, 5)
    }
  }
}

export const proMem = new ProMemExtractor()
