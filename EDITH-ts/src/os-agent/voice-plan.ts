import fs from "node:fs"

import { resolveOpenWakeWordInferenceAssets } from "../voice/wake-model-assets.js"
import type { ResolvedWakeWordConfig } from "../voice/wake-word.js"
import type { VoiceIOConfig } from "./types.js"

export interface PythonVoiceDependencies {
  pythonAvailable: boolean
  dotenv: boolean
  sounddevice: boolean
  soundfile: boolean
  whisper: boolean
  pvporcupine: boolean
  openwakeword: boolean
  onnxruntime: boolean
}

export interface VoiceRuntimePlan {
  captureImplementation: "python-streaming-vad" | "unavailable"
  vadImplementation: "python-streaming-vad" | "unavailable"
  sttImplementation: "python-whisper" | "deepgram-remote" | "unavailable"
  wakeWordImplementation: "porcupine-native" | "openwakeword-native" | "transcript-keyword"
  fallbackReasons: string[]
}

function canUseDeepgram(config: VoiceIOConfig): boolean {
  return Boolean(config.providers?.deepgram?.apiKey?.trim())
    && (config.sttEngine === "auto" || config.sttEngine === "deepgram")
}

export function resolveVoiceRuntimePlan(
  config: VoiceIOConfig,
  wakeConfig: ResolvedWakeWordConfig,
  dependencies: PythonVoiceDependencies,
  hasWakeAsset: (assetPath: string) => boolean = (assetPath) => fs.existsSync(assetPath),
): VoiceRuntimePlan {
  const fallbackReasons: string[] = []
  const wakeAssetConfigured = Boolean(wakeConfig.keywordAssetPath)
  const wakeAssetAvailable = wakeAssetConfigured && hasWakeAsset(wakeConfig.keywordAssetPath as string)

  const captureImplementation = dependencies.pythonAvailable && dependencies.sounddevice
    && dependencies.dotenv
    ? "python-streaming-vad"
    : "unavailable"

  if (!dependencies.pythonAvailable) {
    fallbackReasons.push("python runtime unavailable")
  }
  if (!dependencies.sounddevice) {
    fallbackReasons.push("python package 'sounddevice' missing")
  }
  if (!dependencies.dotenv) {
    fallbackReasons.push("python package 'python-dotenv' missing")
  }

  const pythonWhisperAvailable = dependencies.pythonAvailable && dependencies.whisper && dependencies.soundfile
  let sttImplementation: VoiceRuntimePlan["sttImplementation"] = "unavailable"

  if (canUseDeepgram(config)) {
    sttImplementation = "deepgram-remote"
  } else if (pythonWhisperAvailable) {
    sttImplementation = "python-whisper"
  } else {
    if (!dependencies.whisper) {
      fallbackReasons.push("python package 'whisper' missing")
    }
    if (!dependencies.soundfile) {
      fallbackReasons.push("python package 'soundfile' missing")
    }
  }

  if (config.sttEngine === "deepgram" && !config.providers?.deepgram?.apiKey?.trim()) {
    fallbackReasons.push("deepgram API key missing; using local whisper fallback")
  }

  let wakeWordImplementation: VoiceRuntimePlan["wakeWordImplementation"] = "transcript-keyword"
  let openWakeWordAssetsValid = false

  if (wakeConfig.effectiveEngine === "porcupine") {
    if (!wakeConfig.hasPicovoiceAccessKey) {
      fallbackReasons.push("picovoice access key missing")
    }
    if (wakeConfig.keywordAssetKind !== "porcupine" || !wakeConfig.keywordAssetPath) {
      fallbackReasons.push("porcupine custom keyword file (.ppn) not configured")
    } else if (!wakeAssetAvailable) {
      fallbackReasons.push(`wake model file not found: ${wakeConfig.keywordAssetPath}`)
    }
    if (!dependencies.pvporcupine) {
      fallbackReasons.push("python package 'pvporcupine' missing")
    }

    if (
      captureImplementation === "python-streaming-vad"
      && wakeConfig.hasPicovoiceAccessKey
      && wakeConfig.keywordAssetKind === "porcupine"
      && wakeAssetAvailable
      && dependencies.pvporcupine
    ) {
      wakeWordImplementation = "porcupine-native"
    }
  } else if (wakeConfig.effectiveEngine === "openwakeword") {
    let openWakeWordAssets:
      | ReturnType<typeof resolveOpenWakeWordInferenceAssets>
      | null = null

    if (wakeConfig.keywordAssetKind && wakeConfig.keywordAssetKind !== "openwakeword") {
      fallbackReasons.push("openwakeword requires a .onnx or .tflite wake model")
    }
    if (!wakeConfig.keywordAssetPath) {
      fallbackReasons.push("openwakeword custom model path not configured")
    } else if (!wakeAssetAvailable) {
      fallbackReasons.push(`wake model file not found: ${wakeConfig.keywordAssetPath}`)
    } else {
      openWakeWordAssets = resolveOpenWakeWordInferenceAssets(wakeConfig.keywordAssetPath, hasWakeAsset)
      const supportAssets = [
        openWakeWordAssets.melspectrogramPath,
        openWakeWordAssets.embeddingModelPath,
      ]
      const missingSupportAssets = supportAssets.filter((assetPath) => !hasWakeAsset(assetPath))
      openWakeWordAssetsValid = missingSupportAssets.length === 0

      for (const assetPath of missingSupportAssets) {
        fallbackReasons.push(`openwakeword support model file not found: ${assetPath}`)
      }
    }
    if (!dependencies.openwakeword) {
      fallbackReasons.push("python package 'openwakeword' missing")
    }
    if (!dependencies.onnxruntime) {
      fallbackReasons.push("python package 'onnxruntime' missing")
    }

    if (
      captureImplementation === "python-streaming-vad"
      && wakeConfig.keywordAssetKind === "openwakeword"
      && wakeAssetAvailable
      && openWakeWordAssetsValid
      && dependencies.openwakeword
      && dependencies.onnxruntime
    ) {
      wakeWordImplementation = "openwakeword-native"
    }
  }

  if (config.vadEngine === "cobra") {
    fallbackReasons.push("cobra VAD requested but python streaming VAD is the active implementation")
  } else if (config.vadEngine === "webrtc") {
    fallbackReasons.push("webrtc VAD requested but python streaming VAD is the active implementation")
  }

  return {
    captureImplementation,
    vadImplementation: captureImplementation === "unavailable" ? "unavailable" : "python-streaming-vad",
    sttImplementation,
    wakeWordImplementation,
    fallbackReasons: Array.from(new Set(fallbackReasons)),
  }
}
