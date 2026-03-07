import { describe, expect, it } from "vitest"

import { getDefaultOSAgentConfig } from "../defaults.js"
import { resolveOSVoiceConfig } from "../voice-config.js"
import type { RuntimeVoiceConfig } from "../../voice/runtime-config.js"

function buildRuntimeVoiceConfig(overrides: Partial<RuntimeVoiceConfig> = {}): RuntimeVoiceConfig {
  return {
    enabled: true,
    mode: "push-to-talk",
    stt: {
      engine: "auto",
      language: "auto",
      whisperModel: "base",
      providers: {
        deepgram: {},
      },
      ...overrides.stt,
    },
    tts: {
      engine: "edge",
      voice: "en-US-GuyNeural",
      ...overrides.tts,
    },
    wake: {
      engine: "openwakeword",
      keyword: "hey-edith",
      providers: {
        picovoice: {},
      },
      ...overrides.wake,
    },
    vad: {
      engine: "silero",
      ...overrides.vad,
    },
    ...overrides,
  }
}

describe("resolveOSVoiceConfig", () => {
  it("maps top-level runtime voice config into the OS-agent voice config", () => {
    const defaults = getDefaultOSAgentConfig().voice
    const runtimeVoice = buildRuntimeVoiceConfig({
      mode: "always-on",
      stt: {
        engine: "auto",
        language: "id",
        whisperModel: "small",
        providers: {
          deepgram: {
            apiKey: "dg-test",
          },
        },
      },
      tts: {
        engine: "edge",
        voice: "id-ID-GadisNeural",
      },
      wake: {
        engine: "porcupine",
        keyword: "edith",
        providers: {
          picovoice: {},
        },
      },
      vad: {
        engine: "cobra",
      },
    })

    const resolved = resolveOSVoiceConfig(defaults, runtimeVoice)

    expect(resolved.mode).toBe("always-on")
    expect(resolved.sttEngine).toBe("deepgram")
    expect(resolved.language).toBe("id")
    expect(resolved.whisperModel).toBe("small")
    expect(resolved.ttsVoice).toBe("id-ID-GadisNeural")
    expect(resolved.wakeWord).toBe("edith")
    expect(resolved.wakeWordEngine).toBe("openwakeword")
    expect(resolved.vadEngine).toBe("cobra")
    expect(resolved.providers?.deepgram?.apiKey).toBe("dg-test")
  })

  it("falls back to legacy voice config when top-level providers are absent", () => {
    const defaults = getDefaultOSAgentConfig().voice
    const runtimeVoice = buildRuntimeVoiceConfig({
      enabled: false,
      stt: {
        engine: "python-whisper",
        language: "multi",
        whisperModel: "medium",
        providers: {
          deepgram: {},
        },
      },
    })

    const resolved = resolveOSVoiceConfig(defaults, runtimeVoice, {
      enabled: true,
      fullDuplex: false,
      ttsVoice: "en-US-JennyNeural",
    })

    expect(resolved.enabled).toBe(false)
    expect(resolved.sttEngine).toBe("python-whisper")
    expect(resolved.language).toBe("multi")
    expect(resolved.whisperModel).toBe("medium")
    expect(resolved.fullDuplex).toBe(false)
    expect(resolved.ttsVoice).toBe("en-US-JennyNeural")
  })
})
