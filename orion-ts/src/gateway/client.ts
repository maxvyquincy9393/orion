import crypto from "node:crypto"

export class GatewayClient {
  private ws: WebSocket | null = null
  private pending = new Map<string, (value: any) => void>()

  constructor(private url = "ws://127.0.0.1:18789/ws") {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url)
      this.ws = ws

      const timeout = setTimeout(() => {
        reject(new Error("Gateway connection timeout"))
      }, 5000)

      ws.onopen = () => {
        clearTimeout(timeout)
        resolve()
      }

      ws.onerror = (err) => {
        clearTimeout(timeout)
        reject(err)
      }

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          if (payload.requestId && this.pending.has(payload.requestId)) {
            const resolver = this.pending.get(payload.requestId)
            if (resolver) {
              resolver(payload)
              this.pending.delete(payload.requestId)
            }
          }
        } catch {
          return
        }
      }
    })
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
  }

  async sendMessage(content: string, userId = "owner"): Promise<string> {
    const response = await this.sendRequest({
      type: "message",
      content,
      userId,
    })

    return response.content ?? ""
  }

  async getStatus(): Promise<object> {
    const response = await this.sendRequest({ type: "status" })
    return response
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private async sendRequest(payload: Record<string, unknown>): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Gateway is not connected")
    }

    const requestId = crypto.randomUUID()
    const message = { ...payload, requestId }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error("Gateway request timeout"))
      }, 30000)

      this.pending.set(requestId, (value) => {
        clearTimeout(timeout)
        resolve(value)
      })

      this.ws?.send(JSON.stringify(message))
    })
  }
}
