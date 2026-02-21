import config from "../config.js"
import { createLogger } from "../logger.js"
import { markdownProcessor } from "../markdown/processor.js"
import type { BaseChannel } from "./base.js"
import { splitMessage, pollForConfirm } from "./base.js"

const log = createLogger("channels.teams")

export class TeamsChannel implements BaseChannel {
  readonly name = "teams"
  private running = false
  private readonly replies = new Map<string, Array<{ content: string; ts: number }>>()

  async start(): Promise<void> {
    if (!config.TEAMS_APP_ID.trim() || !config.TEAMS_APP_PASSWORD.trim() || !config.TEAMS_SERVICE_URL.trim()) {
      log.info("Teams disabled: missing TEAMS_APP_ID/TEAMS_APP_PASSWORD/TEAMS_SERVICE_URL")
      return
    }

    this.running = true
    log.info("Teams channel started")
  }

  async stop(): Promise<void> {
    this.running = false
  }

  isConnected(): boolean {
    return this.running
  }

  async send(userId: string, message: string): Promise<boolean> {
    if (!this.running) {
      return false
    }

    try {
      const token = await this.getAccessToken()
      if (!token) {
        return false
      }

      const rendered = markdownProcessor.process(message, "teams")
      const endpoint = `${config.TEAMS_SERVICE_URL.replace(/\/$/, "")}/v3/conversations/${encodeURIComponent(userId)}/activities`
      const chunks = splitMessage(rendered, 3000)

      for (const chunk of chunks) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            type: "message",
            text: chunk,
          }),
        })

        if (!response.ok) {
          log.warn("Teams send failed", { status: response.status })
          return false
        }
      }

      return true
    } catch (error) {
      log.error("Teams send error", { error })
      return false
    }
  }

  async sendWithConfirm(userId: string, message: string, action: string): Promise<boolean> {
    await this.send(userId, `${message}\n\n${action}\nReply YES or NO`)
    return pollForConfirm(async () => this.getLatestReply(userId), 60_000, 3000)
  }

  private async getAccessToken(): Promise<string> {
    try {
      const params = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.TEAMS_APP_ID,
        client_secret: config.TEAMS_APP_PASSWORD,
        scope: "https://api.botframework.com/.default",
      })

      const response = await fetch("https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      })

      if (!response.ok) {
        log.warn("Teams token request failed", { status: response.status })
        return ""
      }

      const data = (await response.json()) as { access_token?: string }
      return data.access_token ?? ""
    } catch (error) {
      log.error("Teams token request error", { error })
      return ""
    }
  }

  private async getLatestReply(userId: string): Promise<string | null> {
    const queue = this.replies.get(userId)
    if (!queue || queue.length === 0) {
      return null
    }

    const latest = queue.pop()
    return latest?.content ?? null
  }
}

export const teamsChannel = new TeamsChannel()
