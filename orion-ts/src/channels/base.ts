export interface BaseChannel {
  readonly name: string
  start(): Promise<void>
  stop(): Promise<void>
  send(userId: string, message: string): Promise<boolean>
  sendWithConfirm(userId: string, message: string, action: string): Promise<boolean>
  isConnected(): boolean
}

export function splitMessage(content: string, maxLength = 2000): string[] {
  if (content.length <= maxLength) {
    return [content]
  }

  const chunks: string[] = []
  let remaining = content

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }

    let splitIndex = maxLength
    const newlineIdx = remaining.lastIndexOf("\n", maxLength)
    const spaceIdx = remaining.lastIndexOf(" ", maxLength)

    if (newlineIdx > maxLength * 0.5) {
      splitIndex = newlineIdx + 1
    } else if (spaceIdx > maxLength * 0.5) {
      splitIndex = spaceIdx + 1
    }

    chunks.push(remaining.slice(0, splitIndex))
    remaining = remaining.slice(splitIndex)
  }

  return chunks
}

export async function pollForConfirm(
  getReply: () => Promise<string | null>,
  timeoutMs = 60_000,
  intervalMs = 3000
): Promise<boolean> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const reply = await getReply()
    if (reply) {
      const normalized = reply.trim().toLowerCase()
      if (normalized.includes("yes") || normalized.includes("confirm")) {
        return true
      }
      if (normalized.includes("no") || normalized.includes("cancel")) {
        return false
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  return false
}
