import { createLogger } from "../logger.js"
import { voice } from "./bridge.js"
import type { RuntimeVoiceConfig } from "./runtime-config.js"

const log = createLogger("voice.providers")

export interface VoiceTurnInput {
  audio: Buffer
  mimeType?: string
  language: RuntimeVoiceConfig["stt"]["language"]
}

export interface VoiceTurnResult {
  text: string
  provider: "python-whisper" | "deepgram"
}

export interface TurnSttProvider {
  transcribeTurn(input: VoiceTurnInput): Promise<VoiceTurnResult>
}

function pickFileExtension(mimeType?: string): string {
  if (!mimeType) {
    return ".wav"
  }

  const normalized = mimeType.toLowerCase()
  if (normalized.includes("webm")) {
    return ".webm"
  }
  if (normalized.includes("mpeg") || normalized.includes("mp3")) {
    return ".mp3"
  }
  if (normalized.includes("ogg")) {
    return ".ogg"
  }
  if (normalized.includes("mp4") || normalized.includes("m4a")) {
    return ".m4a"
  }
  if (normalized.includes("wav")) {
    return ".wav"
  }
  return ".wav"
}

class PythonWhisperSttProvider implements TurnSttProvider {
  async transcribeTurn(input: VoiceTurnInput): Promise<VoiceTurnResult> {
    const text = await voice.transcribeBuffer(input.audio, pickFileExtension(input.mimeType))
    return {
      text,
      provider: "python-whisper",
    }
  }
}

class DeepgramSttProvider implements TurnSttProvider {
  constructor(private apiKey: string) {}

  async transcribeTurn(input: VoiceTurnInput): Promise<VoiceTurnResult> {
    const url = new URL("https://api.deepgram.com/v1/listen")
    url.searchParams.set("model", "nova-3")
    url.searchParams.set("smart_format", "true")
    url.searchParams.set("punctuate", "true")

    if (input.language === "en" || input.language === "id") {
      url.searchParams.set("language", input.language)
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.apiKey}`,
        "Content-Type": input.mimeType ?? "audio/wav",
      },
      body: new Uint8Array(input.audio),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Deepgram transcription failed (${response.status}): ${errorText}`)
    }

    const payload = await response.json() as {
      results?: {
        channels?: Array<{
          alternatives?: Array<{
            transcript?: string
          }>
        }>
      }
    }

    const text = payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? ""
    return {
      text,
      provider: "deepgram",
    }
  }
}

function shouldUseDeepgram(
  runtimeConfig: RuntimeVoiceConfig,
  requestedLanguage: RuntimeVoiceConfig["stt"]["language"],
): boolean {
  const effectiveLanguage = requestedLanguage === "auto" ? runtimeConfig.stt.language : requestedLanguage
  if (!runtimeConfig.stt.providers.deepgram.apiKey) {
    return false
  }

  if (runtimeConfig.stt.engine === "deepgram") {
    return effectiveLanguage === "en" || effectiveLanguage === "id"
  }

  if (runtimeConfig.stt.engine === "auto") {
    return effectiveLanguage === "en" || effectiveLanguage === "id"
  }

  return false
}

export function createTurnSttProvider(runtimeConfig: RuntimeVoiceConfig): TurnSttProvider {
  const whisperProvider = new PythonWhisperSttProvider()
  const deepgramApiKey = runtimeConfig.stt.providers.deepgram.apiKey?.trim()
  const deepgramProvider = deepgramApiKey ? new DeepgramSttProvider(deepgramApiKey) : null

  return {
    async transcribeTurn(input: VoiceTurnInput): Promise<VoiceTurnResult> {
      if (deepgramProvider && shouldUseDeepgram(runtimeConfig, input.language)) {
        try {
          return await deepgramProvider.transcribeTurn(input)
        } catch (error) {
          log.warn("deepgram transcription failed, falling back to python whisper", { error: String(error) })
        }
      }

      return whisperProvider.transcribeTurn(input)
    },
  }
}
