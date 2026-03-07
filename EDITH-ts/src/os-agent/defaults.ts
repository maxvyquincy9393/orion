/**
 * @file os-agent/defaults.ts — Default OS-Agent Configuration
 * @description Sensible defaults for the OS-Agent layer.
 * All features are disabled by default and must be explicitly enabled.
 *
 * @module os-agent/defaults
 */

import type { OSAgentConfig } from "./types.js"

/**
 * Get the default OS-Agent configuration.
 * Everything is disabled by default for safety.
 */
export function getDefaultOSAgentConfig(): OSAgentConfig {
  return {
    gui: {
      enabled: false,
      backend: "native",
      screenshotMethod: "native",
      requireConfirmation: true,
      maxActionsPerMinute: 30,
    },
    vision: {
      enabled: false,
      ocrEngine: "tesseract",
      elementDetection: "accessibility",
      multimodalEngine: "gemini",
      monitorIntervalMs: 5000,
    },
    voice: {
      enabled: false,
      wakeWord: "hey-nova",
      wakeWordEngine: "openwakeword",
      sttEngine: "whisper-local",
      vadEngine: "silero",
      whisperModel: "base",
      fullDuplex: true,
      language: "en",
    },
    system: {
      enabled: true, // System monitoring is safe to enable by default
      watchPaths: [],
      watchClipboard: false,
      watchActiveWindow: true,
      resourceCheckIntervalMs: 10_000,
      cpuWarningThreshold: 90,
      ramWarningThreshold: 85,
      diskWarningThreshold: 90,
    },
    iot: {
      enabled: false,
      autoDiscover: true,
    },
    perceptionIntervalMs: 2000,
  }
}

/**
 * JARVIS mode: all features enabled for maximum system integration.
 * Use when running as a dedicated system service.
 */
export function getJarvisConfig(): OSAgentConfig {
  return {
    gui: {
      enabled: true,
      backend: "native",
      screenshotMethod: "native",
      requireConfirmation: false, // JARVIS doesn't ask — but use with caution
      maxActionsPerMinute: 120,
    },
    vision: {
      enabled: true,
      ocrEngine: "tesseract",
      elementDetection: "accessibility",
      multimodalEngine: "gemini",
      monitorIntervalMs: 2000,
    },
    voice: {
      enabled: true,
      wakeWord: "hey-nova",
      wakeWordEngine: "openwakeword",
      sttEngine: "whisper-local",
      vadEngine: "silero",
      whisperModel: "small",
      fullDuplex: true,
      language: "en",
    },
    system: {
      enabled: true,
      watchPaths: [],
      watchClipboard: true,
      watchActiveWindow: true,
      resourceCheckIntervalMs: 5_000,
      cpuWarningThreshold: 85,
      ramWarningThreshold: 80,
      diskWarningThreshold: 85,
    },
    iot: {
      enabled: true,
      autoDiscover: true,
    },
    perceptionIntervalMs: 1000,
  }
}
