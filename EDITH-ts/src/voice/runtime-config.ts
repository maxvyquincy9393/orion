import config from "../config.js"
import { loadEdithConfig, type EdithConfig } from "../config/edith-config.js"

export interface RuntimeVoiceConfig {
  enabled: boolean
  mode: "push-to-talk" | "always-on"
  stt: {
    engine: "auto" | "python-whisper" | "deepgram"
    language: "auto" | "id" | "en" | "multi"
    whisperModel: "tiny" | "base" | "small" | "medium" | "large"
    providers: {
      deepgram: {
        apiKey?: string
      }
    }
  }
  tts: {
    engine: "edge"
    voice: string
  }
  wake: {
    engine: "porcupine" | "openwakeword"
    keyword: string
    modelPath?: string
    providers: {
      picovoice: {
        accessKey?: string
      }
    }
  }
  vad: {
    engine: "cobra" | "silero" | "webrtc"
  }
}

function mapLegacySttEngine(engine?: string): RuntimeVoiceConfig["stt"]["engine"] {
  if (engine === "deepgram") {
    return "deepgram"
  }
  if (engine === "whisper-local") {
    return "python-whisper"
  }
  return "auto"
}

function mapLegacyLanguage(language?: string): RuntimeVoiceConfig["stt"]["language"] {
  if (language === "id" || language === "en" || language === "multi") {
    return language
  }
  return "auto"
}

function mapLegacyVadEngine(engine?: string): RuntimeVoiceConfig["vad"]["engine"] {
  if (engine === "webrtc") {
    return "webrtc"
  }
  return "silero"
}

function normalizeWhisperModel(model?: string): RuntimeVoiceConfig["stt"]["whisperModel"] {
  if (model === "tiny" || model === "base" || model === "small" || model === "medium" || model === "large") {
    return model
  }
  return "base"
}

export function resolveRuntimeVoiceConfig(edithConfig?: EdithConfig): RuntimeVoiceConfig {
  const topLevel = edithConfig?.voice
  const legacyVoice = edithConfig?.osAgent?.voice

  return {
    enabled: topLevel?.enabled ?? config.VOICE_ENABLED,
    mode: topLevel?.mode ?? (legacyVoice?.enabled ? "always-on" : "push-to-talk"),
    stt: {
      engine: topLevel?.stt?.engine ?? mapLegacySttEngine(legacyVoice?.sttEngine),
      language: topLevel?.stt?.language ?? mapLegacyLanguage(legacyVoice?.language),
      whisperModel: normalizeWhisperModel(topLevel?.stt?.whisperModel ?? legacyVoice?.whisperModel ?? config.VOICE_WHISPER_MODEL),
      providers: {
        deepgram: {
          apiKey: topLevel?.stt?.providers?.deepgram?.apiKey,
        },
      },
    },
    tts: {
      engine: "edge",
      voice: topLevel?.tts?.voice ?? config.VOICE_EDGE_VOICE,
    },
    wake: {
      engine: topLevel?.wake?.engine ?? legacyVoice?.wakeWordEngine ?? "openwakeword",
      keyword: topLevel?.wake?.keyword ?? legacyVoice?.wakeWord ?? "hey-edith",
      modelPath: topLevel?.wake?.modelPath ?? legacyVoice?.wakeWordModelPath,
      providers: {
        picovoice: {
          accessKey: topLevel?.wake?.providers?.picovoice?.accessKey,
        },
      },
    },
    vad: {
      engine: topLevel?.vad?.engine ?? mapLegacyVadEngine(legacyVoice?.vadEngine),
    },
  }
}

export async function loadRuntimeVoiceConfig(): Promise<RuntimeVoiceConfig> {
  const edithConfig = await loadEdithConfig()
  return resolveRuntimeVoiceConfig(edithConfig)
}
