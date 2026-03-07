import { describe, expect, it } from "vitest"

import {
  DEFAULT_OPENWAKEWORD_MODEL,
  getOpenWakeWordPhrase,
  getPreparedOpenWakeWordModel,
  normalizeOpenWakeWordModelName,
  resolveOpenWakeWordInferenceAssets,
} from "../wake-model-assets.js"

describe("wake-model-assets", () => {
  it("normalizes supported OpenWakeWord model phrases", () => {
    expect(normalizeOpenWakeWordModelName("hey mycroft")).toBe("hey_mycroft")
    expect(normalizeOpenWakeWordModelName("hey-jarvis")).toBe("hey_jarvis")
    expect(normalizeOpenWakeWordModelName("HEY_RHASSPY")).toBe("hey_rhasspy")
  })

  it("falls back to the recommended preset when the requested model is unknown", () => {
    expect(normalizeOpenWakeWordModelName("hey edith")).toBe(DEFAULT_OPENWAKEWORD_MODEL)
    expect(getOpenWakeWordPhrase(DEFAULT_OPENWAKEWORD_MODEL)).toBe("hey mycroft")
  })

  it("prefers ONNX inference assets when a sibling ONNX model exists", () => {
    const assets = resolveOpenWakeWordInferenceAssets(
      "C:\\models\\hey_mycroft.tflite",
      (assetPath) => assetPath === "C:\\models\\hey_mycroft.onnx",
    )

    expect(assets.format).toBe("onnx")
    expect(assets.modelPath).toBe("C:\\models\\hey_mycroft.onnx")
    expect(assets.melspectrogramPath).toBe("C:\\models\\melspectrogram.onnx")
    expect(assets.embeddingModelPath).toBe("C:\\models\\embedding_model.onnx")
  })

  it("detects prepared OpenWakeWord assets in the managed repo directory", () => {
    const prepared = getPreparedOpenWakeWordModel("hey mycroft")

    if (prepared) {
      expect(prepared.modelName).toBe("hey_mycroft")
      expect(prepared.keyword).toBe("hey mycroft")
      expect(prepared.modelPath.includes("hey_mycroft")).toBe(true)
      expect(prepared.modelPath.endsWith(".onnx")).toBe(true)
    } else {
      expect(prepared).toBeNull()
    }
  })
})
