import { createLogger } from "../logger.js"
import { voice } from "./bridge.js"
import { createTurnSttProvider } from "./providers.js"
import { loadRuntimeVoiceConfig, type RuntimeVoiceConfig } from "./runtime-config.js"

const log = createLogger("voice.session-manager")

export interface VoiceSessionStartMessage {
  userId: string
  requestId?: unknown
  encoding?: string
  mimeType?: string
  sampleRate?: number
  channelCount?: number
  language?: RuntimeVoiceConfig["stt"]["language"]
}

export interface VoiceSessionStopMessage {
  userId: string
  requestId?: unknown
  data?: string
}

export interface VoiceSessionChunkMessage {
  userId: string
  requestId?: unknown
  data: string
}

export interface VoiceSessionEvent {
  type: "voice_transcript" | "assistant_transcript" | "voice_audio" | "voice_stopped" | "error"
  requestId?: unknown
  text?: string
  data?: string
  message?: string
  reason?: string
  provider?: string
}

interface VoiceSession {
  userId: string
  requestId?: unknown
  mimeType?: string
  language: RuntimeVoiceConfig["stt"]["language"]
  runtimeConfig: RuntimeVoiceConfig
  chunks: Buffer[]
  emit: (event: VoiceSessionEvent) => void
  abortController: AbortController
  processing?: Promise<void>
}

export interface VoiceSessionManagerOptions {
  generateResponse: (userId: string, transcript: string, signal: AbortSignal) => Promise<string>
}

function decodeBase64Audio(data: string): Buffer {
  try {
    return Buffer.from(data, "base64")
  } catch {
    throw new Error("Invalid base64 audio payload")
  }
}

export class VoiceSessionManager {
  private sessions = new Map<string, VoiceSession>()

  constructor(private readonly options: VoiceSessionManagerOptions) {}

  async startSession(
    start: VoiceSessionStartMessage,
    emit: (event: VoiceSessionEvent) => void,
  ): Promise<void> {
    this.cancelSession(start.userId, "superseded")

    const runtimeConfig = await loadRuntimeVoiceConfig()
    const session: VoiceSession = {
      userId: start.userId,
      requestId: start.requestId,
      mimeType: start.mimeType,
      language: start.language ?? runtimeConfig.stt.language,
      runtimeConfig,
      chunks: [],
      emit,
      abortController: new AbortController(),
    }

    this.sessions.set(start.userId, session)
    log.info("voice capture started", {
      userId: start.userId,
      requestId: start.requestId,
      mimeType: start.mimeType,
    })
  }

  appendChunk(chunk: VoiceSessionChunkMessage): void {
    const session = this.sessions.get(chunk.userId)
    if (!session) {
      throw new Error("Voice session not active")
    }
    if (session.requestId !== chunk.requestId) {
      throw new Error("Voice requestId does not match active session")
    }

    session.chunks.push(decodeBase64Audio(chunk.data))
  }

  async stopSession(stop: VoiceSessionStopMessage): Promise<void> {
    const session = this.sessions.get(stop.userId)
    if (!session) {
      throw new Error("Voice session not active")
    }
    if (session.requestId !== stop.requestId) {
      throw new Error("Voice requestId does not match active session")
    }
    if (typeof stop.data === "string" && stop.data.length > 0) {
      session.chunks.push(decodeBase64Audio(stop.data))
    }

    const audio = Buffer.concat(session.chunks)
    if (audio.length === 0) {
      this.finishSession(stop.userId, "empty")
      session.emit({
        type: "error",
        message: "Voice session ended without audio data",
        requestId: session.requestId,
      })
      return
    }

    session.processing = this.processSession(session, audio)
  }

  cancelSession(userId: string, reason: string): boolean {
    const session = this.sessions.get(userId)
    if (!session) {
      return false
    }

    session.abortController.abort(reason)
    this.finishSession(userId, reason)
    return true
  }

  cancelAll(reason: string): void {
    for (const userId of Array.from(this.sessions.keys())) {
      this.cancelSession(userId, reason)
    }
  }

  private async processSession(session: VoiceSession, audio: Buffer): Promise<void> {
    const { userId, requestId } = session
    try {
      const sttProvider = createTurnSttProvider(session.runtimeConfig)
      const transcriptResult = await sttProvider.transcribeTurn({
        audio,
        mimeType: session.mimeType,
        language: session.language,
      })
      if (session.abortController.signal.aborted) {
        return
      }

      const transcript = transcriptResult.text.trim()
      if (!transcript) {
        session.emit({
          type: "error",
          message: "No speech detected in voice input",
          requestId,
        })
        return
      }

      session.emit({
        type: "voice_transcript",
        text: transcript,
        provider: transcriptResult.provider,
        requestId,
      })

      const response = await this.options.generateResponse(userId, transcript, session.abortController.signal)
      if (session.abortController.signal.aborted) {
        return
      }

      session.emit({
        type: "assistant_transcript",
        text: response,
        requestId,
      })

      await voice.speakStreaming(
        response,
        "default",
        (chunk) => {
          if (session.abortController.signal.aborted) {
            return
          }
          session.emit({
            type: "voice_audio",
            data: chunk.toString("base64"),
            requestId,
          })
        },
        {
          voice: session.runtimeConfig.tts.voice,
        },
      )
    } catch (error) {
      if (!session.abortController.signal.aborted) {
        log.error("voice session processing failed", { userId, requestId, error: String(error) })
        session.emit({
          type: "error",
          message: String(error),
          requestId,
        })
      }
    } finally {
      const reason = session.abortController.signal.aborted
        ? String(session.abortController.signal.reason ?? "cancelled")
        : "completed"
      this.finishSession(userId, reason)
    }
  }

  private finishSession(userId: string, reason: string): void {
    const session = this.sessions.get(userId)
    if (!session) {
      return
    }

    this.sessions.delete(userId)
    session.emit({
      type: "voice_stopped",
      requestId: session.requestId,
      reason,
    })
  }
}
