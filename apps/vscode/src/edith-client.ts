/**
 * @file edith-client.ts
 * @description WebSocket client that bridges the VS Code extension to the EDITH gateway.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Connects to `ws://host:port/ws` exposed by src/gateway/. Implements a
 *   request/response correlation pattern over the WebSocket so callers can
 *   `await client.request(type, payload)` without managing message IDs themselves.
 *   Reconnects automatically with exponential back-off when the connection drops.
 */

import * as vscode from "vscode"
import WebSocket from "ws"

/** Outbound message envelope sent to the EDITH gateway. */
interface OutboundMessage {
  id: string
  type: string
  payload: unknown
}

/** Inbound message envelope received from the EDITH gateway. */
interface InboundMessage {
  id?: string
  type: string
  payload?: unknown
  error?: string
}

/** Per-request pending handle. */
interface PendingRequest {
  resolve: (value: string) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** Maximum time (ms) to wait for a single gateway response. */
const REQUEST_TIMEOUT_MS = 30_000

/** Back-off ceiling (ms) for reconnect attempts. */
const MAX_BACKOFF_MS = 30_000

/**
 * Manages the WebSocket connection to the running EDITH gateway process.
 * Exposes a typed request/response API for VS Code commands.
 * Implements `vscode.Disposable` so it can be added to `context.subscriptions`.
 */
export class EdithClient implements vscode.Disposable {
  private ws: WebSocket | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private backoffMs = 1_000
  private disposed = false
  private seq = 0

  /**
   * @param url - Full WebSocket URL, e.g. `ws://localhost:18789/ws`
   * @param log - VS Code output channel for diagnostic messages
   */
  constructor(
    private readonly url: string,
    private readonly log: vscode.OutputChannel,
  ) {}

  /** Opens the WebSocket connection. Safe to call multiple times. */
  connect(): void {
    if (this.disposed || this.ws) return
    this.log.appendLine(`[EdithClient] connecting to ${this.url}`)

    const ws = new WebSocket(this.url)
    this.ws = ws

    ws.on("open", () => {
      this.backoffMs = 1_000
      this.log.appendLine("[EdithClient] connected")
    })

    ws.on("message", (raw: Buffer | string) => {
      this.handleMessage(raw.toString())
    })

    ws.on("close", () => {
      this.log.appendLine("[EdithClient] disconnected")
      this.ws = null
      this.scheduleReconnect()
    })

    ws.on("error", (err: Error) => {
      this.log.appendLine(`[EdithClient] error: ${err.message}`)
      this.ws = null
      this.scheduleReconnect()
    })
  }

  /**
   * Sends a typed request to the EDITH gateway and resolves with the response.
   * @param type - Request type, e.g. `"code/review"`
   * @param payload - Request body (serialisable object)
   * @returns Resolved response string from EDITH
   */
  request(type: string, payload: unknown): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("EDITH gateway is not connected. Is the server running?"))
        return
      }

      const id = `vsc-${++this.seq}`
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`EDITH request "${type}" timed out after ${REQUEST_TIMEOUT_MS}ms`))
      }, REQUEST_TIMEOUT_MS)

      this.pending.set(id, { resolve, reject, timer })

      const msg: OutboundMessage = { id, type, payload }
      this.ws.send(JSON.stringify(msg))
    })
  }

  /** Sends a fire-and-forget notification (no response expected). */
  notify(type: string, payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const id = `vsc-notify-${++this.seq}`
    const msg: OutboundMessage = { id, type, payload }
    this.ws.send(JSON.stringify(msg))
  }

  /** Returns true when the WebSocket is in an open state. */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /** Disposes the client, cancels any pending requests, closes the socket. */
  dispose(): void {
    this.disposed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)

    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error("EDITH extension disposed"))
    }
    this.pending.clear()

    this.ws?.close()
    this.ws = null
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Dispatches an inbound gateway message to the matching pending request.
   * @param raw - Raw JSON string from the WebSocket
   */
  private handleMessage(raw: string): void {
    let msg: InboundMessage
    try {
      msg = JSON.parse(raw) as InboundMessage
    } catch {
      this.log.appendLine(`[EdithClient] bad JSON: ${raw.slice(0, 200)}`)
      return
    }

    if (!msg.id) return

    const pending = this.pending.get(msg.id)
    if (!pending) return

    clearTimeout(pending.timer)
    this.pending.delete(msg.id)

    if (msg.error) {
      pending.reject(new Error(msg.error))
    } else {
      const result =
        typeof msg.payload === "string" ? msg.payload : JSON.stringify(msg.payload ?? "")
      pending.resolve(result)
    }
  }

  /**
   * Schedules a reconnect attempt with exponential back-off.
   */
  private scheduleReconnect(): void {
    if (this.disposed) return
    this.log.appendLine(`[EdithClient] reconnecting in ${this.backoffMs}ms…`)
    this.reconnectTimer = setTimeout(() => {
      this.ws = null
      this.connect()
    }, this.backoffMs)
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS)
  }
}
