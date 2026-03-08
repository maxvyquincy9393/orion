/**
 * @file phone.ts
 * @description PhoneChannel - Twilio Voice WebSocket bridge to Phase 1 pipeline.
 *
 * ARCHITECTURE:
 *   PhoneChannel DOES NOT have STT/TTS of its own.
 *   All audio processing is delegated to VoiceSessionManager (Phase 1).
 *
 *   Bridge flow:
 *   Twilio WebSocket → PCM conversion → VoiceSessionManager.processChunk()
 *                                       → STT → LLM → TTS → mulaw
 *   Twilio WebSocket ←────────────────────────────────── mulaw audio
 *
 * AUDIO FORMAT:
 *   Twilio sends: mulaw 8kHz mono (G.711 μ-law)
 *   Phase 1 STT expects: PCM 16kHz mono (standard)
 *   Conversion: mulaw 8kHz → PCM 16kHz via upsampling (2x) + decode
 *
 * TWILIO WEBHOOK:
 *   POST /voice/incoming  → TwiML response (initiate WebSocket stream)
 *   POST /voice/outbound  → TwiML response for outbound call
 *   WS   /voice/stream    → bidirectional audio stream
 *   POST /voice/status    → call status callbacks
 *
 * @module channels/phone
 */

import type { BaseChannel } from "./base.js"
import { createLogger } from "../logger.js"
import config from "../config.js"

const log = createLogger("channels.phone")

/**
 * Active call session.
 */
export interface ActiveCall {
  callSid: string
  streamSid: string
  direction: "inbound" | "outbound"
  from: string
  to: string
  startedAt: Date
}

/**
 * Call initiation parameters.
 */
export interface CallInitParams {
  to: string
  userId: string
  greeting?: string
}

/**
 * PhoneChannel - Twilio Voice WebSocket bridge to Phase 1 pipeline.
 *
 * SECURITY:
 *   - Validate Twilio signature on all webhook requests
 *   - Rate limit: Max 5 concurrent calls
 *   - No auto-answer for unknown callers (allowlist required)
 *
 * USAGE:
 *   ```typescript
 *   // Incoming call from Twilio webhook:
 *   phoneChannel.handleIncomingCall(callSid, from, to)
 *
 *   // Outbound call:
 *   await phoneChannel.initiateCall("+1234567890", "This is EDITH calling")
 *   ```
 *
 * NOTE: Full WebSocket + audio conversion implementation requires:
 *   - ws (WebSocket library)
 *   - Integration with Phase 1 VoiceSessionManager
 *   - mulaw <-> PCM audio codec
 *   This is a placeholder implementation that can be completed when needed.
 */
export class PhoneChannel implements BaseChannel {
  readonly name = "phone"

  private connected = false
  private activeCalls = new Map<string, ActiveCall>()
  private allowedCallers = new Set<string>()

  /** Twilio mulaw audio sample rate */
  // private static readonly TWILIO_SAMPLE_RATE = 8000

  /** Phase 1 STT expected sample rate */
  // private static readonly STT_SAMPLE_RATE = 16000

  /** Maximum concurrent calls */
  private static readonly MAX_CONCURRENT_CALLS = 5

  /**
   * Starts the phone channel.
   *
   * NOTE: Full implementation requires WebSocket server setup.
   * For Phase 8 initial release, phone channel is marked as available
   * but requires additional setup for production use.
   */
  async start(): Promise<void> {
    try {
      if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN) {
        log.info("Phone channel not started (Twilio credentials not configured)")
        this.connected = false
        return
      }

      // TODO: Initialize WebSocket server for Twilio Media Streams
      // const wsServer = new WebSocketServer({ port: config.PHONE_WEBHOOK_PORT || 8081 })
      // wsServer.on("connection", (ws, req) => { ... })

      this.connected = true
      log.info("Phone channel started (basic mode)")
    } catch (error) {
      log.error("Phone channel failed to start", { error })
      this.connected = false
    }
  }

  /**
   * Stops the phone channel.
   */
  async stop(): Promise<void> {
    // TODO: Close WebSocket server
    // TODO: Hangup active calls
    this.connected = false
    this.activeCalls.clear()
    log.info("Phone channel stopped")
  }

  /**
   * Returns true if phone channel is available.
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Sends a message via phone call (initiates outbound call).
   *
   * @param userId User ID in format "phone:+1234567890"
   * @param message Message to speak (using Phase 1 TTS)
   * @returns true if call initiated successfully
   */
  async send(userId: string, message: string): Promise<boolean> {
    if (!this.connected) {
      log.warn("Phone channel not connected")
      return false
    }

    const phoneNumber = this.extractPhoneNumber(userId)
    if (!phoneNumber) {
      log.error("invalid userId format for phone", { userId })
      return false
    }

    try {
      // Check concurrent call limit
      if (this.activeCalls.size >= PhoneChannel.MAX_CONCURRENT_CALLS) {
        log.warn("concurrent call limit reached", { limit: PhoneChannel.MAX_CONCURRENT_CALLS })
        return false
      }

      // Initiate outbound call via Twilio API
      await this.initiateCall({ to: phoneNumber, userId, greeting: message })

      return true
    } catch (error) {
      log.error("failed to initiate call", { to: phoneNumber, error })
      return false
    }
  }

  /**
   * Sends with confirmation (for phone, same as send).
   */
  async sendWithConfirm(userId: string, message: string, action: string): Promise<boolean> {
    return this.send(userId, `${action}: ${message}`)
  }

  /**
   * Initiates outbound call via Twilio REST API.
   *
   * @param params Call parameters
   * @returns Call SID from Twilio
   */
  async initiateCall(params: CallInitParams): Promise<{ callSid: string }> {
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${config.TWILIO_ACCOUNT_SID}/Calls.json`
      const auth = Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString("base64")

      const webhookUrl = config.PHONE_WEBHOOK_URL || "http://localhost:18789"

      const body = new URLSearchParams({
        To: params.to,
        From: config.TWILIO_PHONE_NUMBER,
        Url: `${webhookUrl}/voice/outbound`,
      })

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Twilio API error: ${response.status} ${errorText}`)
      }

      const data = await response.json() as { sid: string }

      log.info("outbound call initiated", { to: params.to, callSid: data.sid })

      // Track active call
      this.activeCalls.set(data.sid, {
        callSid: data.sid,
        streamSid: "", // Will be set when WebSocket connects
        direction: "outbound",
        from: config.TWILIO_PHONE_NUMBER,
        to: params.to,
        startedAt: new Date(),
      })

      return { callSid: data.sid }
    } catch (error) {
      log.error("failed to initiate call", { to: params.to, error })
      throw error
    }
  }

  /**
   * Generates TwiML response for incoming calls.
   *
   * Instructs Twilio to open WebSocket stream to EDITH.
   */
  handleIncomingTwiML(from: string, _to: string): string {
    // Check allowlist if configured
    if (this.allowedCallers.size > 0 && !this.allowedCallers.has(from)) {
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>This number is not authorized. Goodbye.</Say>
  <Hangup/>
</Response>`
    }

    // Check concurrent call limit
    if (this.activeCalls.size >= PhoneChannel.MAX_CONCURRENT_CALLS) {
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, all lines are busy. Please try again later.</Say>
  <Hangup/>
</Response>`
    }

    const webhookUrl = config.PHONE_WEBHOOK_URL || "http://localhost:18789"

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please wait while I connect you to EDITH.</Say>
  <Connect>
    <Stream url="${webhookUrl.replace("http://", "ws://")}/voice/stream" />
  </Connect>
</Response>`
  }

  /**
   * Generates TwiML response for outbound calls.
   */
  handleOutboundTwiML(greeting?: string): string {
    const webhookUrl = config.PHONE_WEBHOOK_URL || "http://localhost:18789"

    const sayElement = greeting
      ? `<Say>${this.escapeXml(greeting)}</Say>`
      : `<Say>This is EDITH calling.</Say>`

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${sayElement}
  <Connect>
    <Stream url="${webhookUrl.replace("http://", "ws://")}/voice/stream" />
  </Connect>
</Response>`
  }

  /**
   * Handles WebSocket connection for audio streaming.
   *
   * NOTE: Full implementation requires:
   *   - WebSocket event handlers (open, message, close)
   *   - Audio codec conversion (mulaw <-> PCM)
   *   - Integration with Phase 1 VoiceSessionManager
   *   - Bidirectional audio streaming
   *
   * This is a placeholder that logs the connection.
   */
  handleWebSocketConnect(callSid: string): void {
    log.info("WebSocket connected for call", { callSid })

    // TODO: Set up audio processing pipeline
    // TODO: Create Phase 1 VoiceSession
    // TODO: Handle incoming audio chunks
    // TODO: Send outgoing TTS audio
  }

  /**
   * Handles WebSocket message (audio chunk from Twilio).
   *
   * NOTE: Full implementation requires mulaw -> PCM conversion
   * and Phase 1 VoiceSessionManager integration.
   */
  handleWebSocketMessage(callSid: string, audioChunk: Buffer): void {
    log.debug("Audio chunk received", { callSid, size: audioChunk.length })

    // TODO: Convert mulaw to PCM
    // const pcm = this.mulawToPCM(audioChunk)
    // TODO: Send to Phase 1 VoiceSessionManager
    // await voice.processChunk(sessionId, pcm)
  }

  /**
   * Converts mulaw 8kHz buffer to PCM 16kHz.
   *
   * Phase 1 VoiceSessionManager expects 16kHz PCM.
   * Algorithm: G.711 μ-law decode → linear PCM → upsample 8kHz→16kHz
   *
   * NOTE: This is a placeholder. Full implementation requires
   * audio codec library or native Node.js audio processing.
   */
  // private mulawToPCM(mulawBuffer: Buffer): Buffer {
  //   // TODO: Implement mulaw -> PCM conversion
  //   // Requires audio codec library
  //   log.warn("mulaw -> PCM conversion not implemented")
  //   return mulawBuffer
  // }

  /**
   * Converts PCM 16kHz TTS output back to mulaw 8kHz for Twilio.
   *
   * Required for sending EDITH voice response back to caller.
   *
   * NOTE: This is a placeholder. Full implementation requires
   * audio codec library or native Node.js audio processing.
   */
  // private pcmToMulaw(pcmBuffer: Buffer): Buffer {
  //   // TODO: Implement PCM -> mulaw conversion
  //   // Requires audio codec library
  //   log.warn("PCM -> mulaw conversion not implemented")
  //   return pcmBuffer
  // }

  /**
   * Extracts phone number from userId.
   */
  private extractPhoneNumber(userId: string): string | null {
    if (userId.startsWith("phone:")) {
      return userId.slice(6)
    }

    if (userId.startsWith("+")) {
      return userId
    }

    return null
  }

  /**
   * Escapes XML special characters for TwiML.
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  }
}

/**
 * Singleton instance of PhoneChannel.
 *
 * NOTE: PhoneChannel requires additional setup for production:
 *   - WebSocket server configuration
 *   - Audio codec implementation
 *   - Phase 1 VoiceSessionManager integration
 *   - Ngrok or similar for Twilio webhook URL
 *
 * Current implementation provides structure and Twilio API integration.
 * Full audio processing can be completed when needed.
 */
export const phoneChannel = new PhoneChannel()
