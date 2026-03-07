import { describe, expect, it } from "vitest"

import { resolveWakeWordConfig } from "../wake-word.js"
import type { RuntimeVoiceConfig } from "../runtime-config.js"

function runtimeVoice(overrides: Partial<RuntimeVoiceConfig["wake"]> = {}): RuntimeVoiceConfig {
  return {
    enabled: true,
    mode: "always-on",
    stt: {
      engine: "auto",
      language: "auto",
      whisperModel: "base",
      providers: {
        deepgram: {},
      },
    },
    tts: {
      engine: "edge",
      voice: "en-US-GuyNeural",
    },
    wake: {
      engine: "openwakeword",
      keyword: "hey-edith",
      providers: {
        picovoice: {},
      },
      ...overrides,
    },
    vad: {
      engine: "silero",
    },
  }
}

describe("resolveWakeWordConfig", () => {
  it("falls back to openwakeword when porcupine is selected without an access key", () => {
    const resolved = resolveWakeWordConfig(runtimeVoice({
      engine: "porcupine",
      keyword: "edith",
      providers: {
        picovoice: {},
      },
    }))

    expect(resolved.requestedEngine).toBe("porcupine")
    expect(resolved.effectiveEngine).toBe("openwakeword")
    expect(resolved.keyword).toBe("edith")
    expect(resolved.hasPicovoiceAccessKey).toBe(false)
  })

  it("keeps porcupine when a user-managed access key is configured", () => {
    const resolved = resolveWakeWordConfig(runtimeVoice({
      engine: "porcupine",
      providers: {
        picovoice: {
          accessKey: "pv-secret",
        },
      },
    }))

    expect(resolved.requestedEngine).toBe("porcupine")
    expect(resolved.effectiveEngine).toBe("porcupine")
    expect(resolved.hasPicovoiceAccessKey).toBe(true)
  })

  it("derives a wake phrase and native asset hint from a porcupine keyword file path", () => {
    const resolved = resolveWakeWordConfig(runtimeVoice({
      engine: "porcupine",
      keyword: "models/hey-edith.ppn",
      providers: {
        picovoice: {
          accessKey: "pv-secret",
        },
      },
    }))

    expect(resolved.keyword).toBe("hey edith")
    expect(resolved.keywordAssetPath).toBe("models/hey-edith.ppn")
    expect(resolved.keywordAssetKind).toBe("porcupine")
  })

  it("derives an openwakeword asset hint from a model path", () => {
    const resolved = resolveWakeWordConfig(runtimeVoice({
      engine: "openwakeword",
      keyword: "models/hey_edith.onnx",
    }))

    expect(resolved.keyword).toBe("hey edith")
    expect(resolved.keywordAssetPath).toBe("models/hey_edith.onnx")
    expect(resolved.keywordAssetKind).toBe("openwakeword")
  })

  it("prefers an explicit wake model path over the keyword text", () => {
    const resolved = resolveWakeWordConfig(runtimeVoice({
      engine: "openwakeword",
      keyword: "edith",
      modelPath: "models/hey_edith.onnx",
    }))

    expect(resolved.keyword).toBe("hey edith")
    expect(resolved.keywordAssetPath).toBe("models/hey_edith.onnx")
    expect(resolved.keywordAssetKind).toBe("openwakeword")
  })

  it("strips version suffixes from managed wake-model filenames", () => {
    const resolved = resolveWakeWordConfig(runtimeVoice({
      engine: "openwakeword",
      modelPath: "models/hey_mycroft_v0.1.onnx",
    }))

    expect(resolved.keyword).toBe("hey mycroft")
  })
})
