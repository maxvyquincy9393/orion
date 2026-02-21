export type ChannelType =
  | "discord"
  | "telegram"
  | "slack"
  | "whatsapp"
  | "webchat"
  | "cli"
  | "signal"
  | "line"
  | "matrix"
  | "teams"
  | "imessage"

export class MarkdownProcessor {
  process(markdown: string, channel: ChannelType): string {
    switch (channel) {
      case "discord":
        return markdown

      case "telegram":
        return this.toTelegram(markdown)

      case "slack":
        return this.toSlack(markdown)

      case "whatsapp":
        return this.toWhatsApp(markdown)

      case "webchat":
        return markdown

      case "cli":
        return this.stripFormatting(markdown)

      case "signal":
      case "line":
      case "matrix":
      case "teams":
      case "imessage":
        return this.toSlack(markdown)

      default:
        return markdown
    }
  }

  private toTelegram(markdown: string): string {
    let result = markdown

    result = result.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    result = result.replace(/\*([^*]+)\*/g, "<i>$1</i>")
    result = result.replace(/`([^`]+)`/g, "<code>$1</code>")
    result = result.replace(/```(\w*)\n([\s\S]*?)```/g, "<pre>$2</pre>")

    return result
  }

  private toSlack(markdown: string): string {
    let result = markdown

    result = result.replace(/\*\*([^*]+)\*\*/g, "*$1*")
    result = result.replace(/\*([^*]+)\*/g, "_$1_")
    result = result.replace(/~~([^~]+)~~/g, "~$1~")

    return result
  }

  private toWhatsApp(markdown: string): string {
    let result = markdown

    result = result.replace(/\*\*([^*]+)\*\*/g, "*$1*")
    result = result.replace(/\*([^*]+)\*/g, "_$1_")
    result = result.replace(/~~([^~]+)~~/g, "~$1~")

    return result
  }

  private stripFormatting(markdown: string): string {
    let result = markdown

    result = result.replace(/\*\*([^*]+)\*\*/g, "$1")
    result = result.replace(/\*([^*]+)\*/g, "$1")
    result = result.replace(/_([^_]+)_/g, "$1")
    result = result.replace(/~~([^~]+)~~/g, "$1")
    result = result.replace(/`([^`]+)`/g, "$1")
    result = result.replace(/```(\w*)\n([\s\S]*?)```/g, "$2")
    result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")

    return result
  }
}

export const markdownProcessor = new MarkdownProcessor()
