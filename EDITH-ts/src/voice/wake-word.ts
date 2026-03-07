import path from "node:path"

import { createLogger } from "../logger.js"
import { voice } from "./bridge.js"
import type { RuntimeVoiceConfig } from "./runtime-config.js"

const log = createLogger("voice.wake-word")

type WakeWordAssetKind = "porcupine" | "openwakeword"

export interface ResolvedWakeWordConfig {
  requestedEngine: RuntimeVoiceConfig["wake"]["engine"]
  effectiveEngine: RuntimeVoiceConfig["wake"]["engine"]
  keyword: string
  keywordAssetPath?: string
  keywordAssetKind?: WakeWordAssetKind
  hasPicovoiceAccessKey: boolean
}

function deriveWakeWordPhrase(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return "hey-edith"
  }

  const ext = path.extname(trimmed)
  if (!ext) {
    return trimmed
  }

  return path
    .basename(trimmed, ext)
    .replace(/[._-]v\d+(?:\.\d+)*$/i, "")
    .replace(/[._-]+/g, " ")
    .trim() || "hey-edith"
}

function resolveWakeWordAsset(value: string): { path?: string; kind?: WakeWordAssetKind } {
  const trimmed = value.trim()
  if (!trimmed) {
    return {}
  }

  if (/\.ppn$/i.test(trimmed)) {
    return {
      path: trimmed,
      kind: "porcupine",
    }
  }

  if (/\.(onnx|tflite)$/i.test(trimmed)) {
    return {
      path: trimmed,
      kind: "openwakeword",
    }
  }

  return {}
}

export function resolveWakeWordConfig(runtimeConfig: RuntimeVoiceConfig): ResolvedWakeWordConfig {
  const configuredKeyword = runtimeConfig.wake.keyword.trim().length > 0 ? runtimeConfig.wake.keyword.trim() : "hey-edith"
  const configuredModelPath = runtimeConfig.wake.modelPath?.trim()
  const modelAsset = configuredModelPath ? resolveWakeWordAsset(configuredModelPath) : {}
  const keywordAsset = modelAsset.path ? modelAsset : resolveWakeWordAsset(configuredKeyword)
  const hasPicovoiceAccessKey = Boolean(runtimeConfig.wake.providers.picovoice.accessKey?.trim())
  const requestedEngine = runtimeConfig.wake.engine
  const effectiveEngine = requestedEngine === "porcupine" && !hasPicovoiceAccessKey
    ? "openwakeword"
    : requestedEngine

  return {
    requestedEngine,
    effectiveEngine,
    keyword: modelAsset.path
      ? deriveWakeWordPhrase(configuredModelPath ?? configuredKeyword)
      : keywordAsset.path
        ? deriveWakeWordPhrase(configuredKeyword)
        : configuredKeyword,
    keywordAssetPath: keywordAsset.path,
    keywordAssetKind: keywordAsset.kind,
    hasPicovoiceAccessKey,
  }
}

export async function checkWakeWordWindow(
  runtimeConfig: RuntimeVoiceConfig,
  keyword: string | undefined,
  windowSeconds: number,
): Promise<boolean> {
  const resolved = resolveWakeWordConfig(runtimeConfig)
  const effectiveKeyword = typeof keyword === "string" && keyword.trim().length > 0
    ? keyword.trim()
    : resolved.keyword

  if (resolved.requestedEngine !== resolved.effectiveEngine) {
    log.warn("wake word engine fallback applied", {
      requestedEngine: resolved.requestedEngine,
      effectiveEngine: resolved.effectiveEngine,
    })
  }

  // Compatibility path for Phase 1B: the gateway/OS-agent resolve engine,
  // asset hints, and keyword phrase from top-level voice config before running
  // the existing host-side wake-word detector.
  return voice.checkWakeWord(effectiveKeyword, windowSeconds)
}
