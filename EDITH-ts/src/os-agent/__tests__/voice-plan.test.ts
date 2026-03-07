import { describe, expect, it } from "vitest"

import { resolveVoiceRuntimePlan, type PythonVoiceDependencies } from "../voice-plan.js"
import type { VoiceIOConfig } from "../types.js"
import type { ResolvedWakeWordConfig } from "../../voice/wake-word.js"

function buildVoiceConfig(overrides: Partial<VoiceIOConfig> = {}): VoiceIOConfig {
  return {
    enabled: true,
    mode: "always-on",
    wakeWord: "hey-edith",
    wakeWordEngine: "openwakeword",
    sttEngine: "auto",
    vadEngine: "silero",
    whisperModel: "base",
    fullDuplex: true,
    language: "auto",
    ttsVoice: "en-US-GuyNeural",
    providers: {},
    ...overrides,
  }
}

function buildWakeConfig(overrides: Partial<ResolvedWakeWordConfig> = {}): ResolvedWakeWordConfig {
  return {
    requestedEngine: "openwakeword",
    effectiveEngine: "openwakeword",
    keyword: "hey edith",
    hasPicovoiceAccessKey: false,
    ...overrides,
  }
}

function buildDependencies(overrides: Partial<PythonVoiceDependencies> = {}): PythonVoiceDependencies {
  return {
    pythonAvailable: true,
    dotenv: true,
    sounddevice: true,
    soundfile: true,
    whisper: true,
    pvporcupine: false,
    openwakeword: false,
    onnxruntime: true,
    ...overrides,
  }
}

describe("resolveVoiceRuntimePlan", () => {
  it("enables native porcupine only when sounddevice, key, package, and .ppn asset are present", () => {
    const plan = resolveVoiceRuntimePlan(
      buildVoiceConfig({
        wakeWordEngine: "porcupine",
        providers: {
          picovoice: {
            accessKey: "pv-test",
          },
        },
      }),
      buildWakeConfig({
        requestedEngine: "porcupine",
        effectiveEngine: "porcupine",
        keywordAssetPath: "models/hey-edith.ppn",
        keywordAssetKind: "porcupine",
        hasPicovoiceAccessKey: true,
      }),
      buildDependencies({
        pvporcupine: true,
      }),
      () => true,
    )

    expect(plan.captureImplementation).toBe("python-streaming-vad")
    expect(plan.sttImplementation).toBe("python-whisper")
    expect(plan.wakeWordImplementation).toBe("porcupine-native")
  })

  it("falls back to transcript keyword when openwakeword model packages are unavailable", () => {
    const plan = resolveVoiceRuntimePlan(
      buildVoiceConfig(),
      buildWakeConfig({
        keywordAssetPath: "models/hey_edith.onnx",
        keywordAssetKind: "openwakeword",
      }),
      buildDependencies({
        sounddevice: false,
        openwakeword: false,
      }),
      () => true,
    )

    expect(plan.captureImplementation).toBe("unavailable")
    expect(plan.vadImplementation).toBe("unavailable")
    expect(plan.sttImplementation).toBe("python-whisper")
    expect(plan.wakeWordImplementation).toBe("transcript-keyword")
    expect(plan.fallbackReasons).toContain("python package 'sounddevice' missing")
    expect(plan.fallbackReasons).toContain("python package 'openwakeword' missing")
  })

  it("marks local STT unavailable when whisper dependencies are missing and deepgram is not configured", () => {
    const plan = resolveVoiceRuntimePlan(
      buildVoiceConfig({
        sttEngine: "python-whisper",
      }),
      buildWakeConfig(),
      buildDependencies({
        soundfile: false,
        whisper: false,
      }),
      () => true,
    )

    expect(plan.sttImplementation).toBe("unavailable")
    expect(plan.fallbackReasons).toContain("python package 'whisper' missing")
    expect(plan.fallbackReasons).toContain("python package 'soundfile' missing")
  })

  it("marks capture unavailable when python-dotenv is missing for the streaming bridge", () => {
    const plan = resolveVoiceRuntimePlan(
      buildVoiceConfig(),
      buildWakeConfig({
        keywordAssetPath: "models/hey_edith.onnx",
        keywordAssetKind: "openwakeword",
      }),
      buildDependencies({
        dotenv: false,
        openwakeword: true,
      }),
      () => true,
    )

    expect(plan.captureImplementation).toBe("unavailable")
    expect(plan.wakeWordImplementation).toBe("transcript-keyword")
    expect(plan.fallbackReasons).toContain("python package 'python-dotenv' missing")
  })

  it("keeps native wake-word disabled when the configured asset path does not exist", () => {
    const plan = resolveVoiceRuntimePlan(
      buildVoiceConfig(),
      buildWakeConfig({
        keywordAssetPath: "models/hey_edith.onnx",
        keywordAssetKind: "openwakeword",
      }),
      buildDependencies({
        openwakeword: true,
      }),
      () => false,
    )

    expect(plan.wakeWordImplementation).toBe("transcript-keyword")
    expect(plan.fallbackReasons).toContain("wake model file not found: models/hey_edith.onnx")
  })

  it("keeps native openwakeword disabled when support models are missing next to the wake model", () => {
    const plan = resolveVoiceRuntimePlan(
      buildVoiceConfig(),
      buildWakeConfig({
        keywordAssetPath: "models/hey_edith.onnx",
        keywordAssetKind: "openwakeword",
      }),
      buildDependencies({
        openwakeword: true,
      }),
      (assetPath) => assetPath === "models/hey_edith.onnx",
    )

    expect(plan.wakeWordImplementation).toBe("transcript-keyword")
    expect(plan.fallbackReasons.some((reason) => reason.includes("melspectrogram.onnx"))).toBe(true)
    expect(plan.fallbackReasons.some((reason) => reason.includes("embedding_model.onnx"))).toBe(true)
  })
})
