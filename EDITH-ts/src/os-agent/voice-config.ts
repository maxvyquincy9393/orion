import type { RuntimeVoiceConfig } from "../voice/runtime-config.js"
import type { VoiceIOConfig } from "./types.js"

type LegacyVoiceConfig = {
  enabled?: boolean
  wakeWord?: string
  wakeWordModelPath?: string
  wakeWordEngine?: "porcupine" | "openwakeword"
  sttEngine?: "whisper-local" | "deepgram" | "google" | "azure"
  vadEngine?: "cobra" | "silero" | "webrtc"
  whisperModel?: VoiceIOConfig["whisperModel"]
  fullDuplex?: boolean
  language?: string
  ttsVoice?: string
}

function mapLegacySttEngine(engine?: LegacyVoiceConfig["sttEngine"]): VoiceIOConfig["sttEngine"] {
  if (engine === "deepgram") {
    return "deepgram"
  }
  return "python-whisper"
}

function mapLegacyVadEngine(engine?: LegacyVoiceConfig["vadEngine"]): VoiceIOConfig["vadEngine"] {
  if (engine === "cobra" || engine === "webrtc") {
    return engine
  }
  return "silero"
}

function mapLegacyLanguage(language?: string): VoiceIOConfig["language"] {
  if (language === "id" || language === "en" || language === "multi") {
    return language
  }
  return "auto"
}

export function resolveOSVoiceConfig(
  defaults: VoiceIOConfig,
  runtimeVoice: RuntimeVoiceConfig,
  legacyVoice?: LegacyVoiceConfig,
): VoiceIOConfig {
  const deepgramApiKey = runtimeVoice.stt.providers.deepgram.apiKey?.trim()
  const picovoiceAccessKey = runtimeVoice.wake.providers.picovoice.accessKey?.trim()
  const requestedWakeEngine = runtimeVoice.wake.engine ?? legacyVoice?.wakeWordEngine ?? defaults.wakeWordEngine
  const effectiveWakeEngine = requestedWakeEngine === "porcupine" && !picovoiceAccessKey
    ? "openwakeword"
    : requestedWakeEngine

  const resolvedTtsVoice = runtimeVoice.tts.voice === defaults.ttsVoice && legacyVoice?.ttsVoice
    ? legacyVoice.ttsVoice
    : runtimeVoice.tts.voice

  return {
    ...defaults,
    enabled: runtimeVoice.enabled ?? legacyVoice?.enabled ?? defaults.enabled,
    mode: runtimeVoice.mode ?? defaults.mode,
    wakeWord: runtimeVoice.wake.keyword ?? legacyVoice?.wakeWord ?? defaults.wakeWord,
    wakeWordModelPath: runtimeVoice.wake.modelPath ?? legacyVoice?.wakeWordModelPath ?? defaults.wakeWordModelPath,
    wakeWordEngine: effectiveWakeEngine,
    sttEngine: runtimeVoice.stt.engine === "python-whisper"
      ? "python-whisper"
      : runtimeVoice.stt.engine === "deepgram"
        ? "deepgram"
        : deepgramApiKey
          ? "deepgram"
          : (legacyVoice?.sttEngine ? mapLegacySttEngine(legacyVoice.sttEngine) : defaults.sttEngine),
    vadEngine: runtimeVoice.vad.engine ?? mapLegacyVadEngine(legacyVoice?.vadEngine),
    whisperModel: runtimeVoice.stt.whisperModel ?? legacyVoice?.whisperModel ?? defaults.whisperModel,
    fullDuplex: legacyVoice?.fullDuplex ?? defaults.fullDuplex,
    language: runtimeVoice.stt.language ?? mapLegacyLanguage(legacyVoice?.language),
    ttsVoice: resolvedTtsVoice ?? legacyVoice?.ttsVoice ?? defaults.ttsVoice,
    providers: {
      deepgram: {
        apiKey: deepgramApiKey,
      },
      picovoice: {
        accessKey: picovoiceAccessKey,
      },
    },
  }
}
