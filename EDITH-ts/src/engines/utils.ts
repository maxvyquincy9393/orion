import type { GenerateOptions } from "./types.js"

export function buildMessages(options: GenerateOptions): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = []

  if (options.systemPrompt?.trim()) {
    messages.push({ role: "system", content: options.systemPrompt.trim() })
  }

  messages.push(...(options.context ?? []))
  messages.push({ role: "user" as const, content: options.prompt })
  return messages
}
