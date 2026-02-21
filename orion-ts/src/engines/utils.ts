import type { GenerateOptions } from "./types.js"

export function buildMessages(options: GenerateOptions): Array<{ role: "user" | "assistant"; content: string }> {
  const messages = [...(options.context ?? [])]
  messages.push({ role: "user" as const, content: options.prompt })
  return messages
}
