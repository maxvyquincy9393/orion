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
      mode: "push-to-talk",
      wakeWord: "hey-edith",
      wakeWordModelPath: undefined,
      wakeWordEngine: "openwakeword",
      sttEngine: "auto",
      vadEngine: "silero",
      whisperModel: "base",
      fullDuplex: true,
      ttsVoice: "en-US-GuyNeural",
      language: "en",
      providers: {
        deepgram: {},
        picovoice: {},
      },
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
 * EDITH mode: all features enabled for maximum system integration.
 * Use when running as a dedicated system service.
 */
export function getEdithOSConfig(): OSAgentConfig {
  return {
    gui: {
      enabled: true,
      backend: "native",
      screenshotMethod: "native",
      requireConfirmation: false, // EDITH doesn't ask — but use with caution
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
      mode: "always-on",
      wakeWord: "hey-edith",
      wakeWordModelPath: undefined,
      wakeWordEngine: "openwakeword",
      sttEngine: "auto",
      vadEngine: "silero",
      whisperModel: "small",
      fullDuplex: true,
      ttsVoice: "en-US-GuyNeural",
      language: "en",
      providers: {
        deepgram: {},
        picovoice: {},
      },
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
