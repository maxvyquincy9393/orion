/**
 * @file bridge.ts
 * @description VoiceBridge — unified TTS/STT orchestrator with offline-capable providers,
 * emotion-aware synthesis, and mobile-optimised audio paths.
 *
 * ARCHITECTURE:
 *   TTS provider priority:
 *     1. Kokoro.js (kokoro-js npm, pure TS, offline, emotion-aware)
 *        — when KOKORO_TTS_ENABLED=true OR system is offline
 *     2. Python streaming pipeline (legacy fallback)
 *
 *   STT provider priority:
 *     1. WhisperCpp via nodejs-whisper (offline)
 *        — when WHISPER_CPP_ENABLED=true OR system is offline
 *     2. Python streaming pipeline (legacy fallback)
 *
 *   Emotion system (NEW):
 *     EmotionEngine analyses outgoing text and returns Kokoro voice+speed params.
 *     Emotion is detected once per speak() call — O(n) lexicon pass, zero latency cost.
 *
 *   Mobile path (NEW):
 *     transcribeBuffer()  — accepts raw PCM/WAV bytes from mobile app via WebSocket
 *     getMobileVoiceConfig() — returns quantization + sample-rate hints for mobile
 *
 *   OfflineCoordinator integration:
 *     When offlineCoordinator.isOffline(), local providers are automatically preferred.
 *
 * PAPER BASIS:
 *   - arXiv:2508.04721 (Low-Latency Voice Agents) — multi-threaded pipeline architecture
 *   - arXiv:2509.15969 (VoXtream streaming TTS) — streaming chunk delivery
 *   - arXiv:2306.10799 (Emotion-aware TTS survey) — lexicon → prosody mapping
 *   - Phase 9 design: "LOCAL IS THE ARMOR, CLOUD IS THE UPGRADE"
 *
 * @module voice/bridge
 */

import { execa } from "execa"
import path from "node:path"
import { fileURLToPath } from "node:url"
import fs from "node:fs/promises"
import os from "node:os"

import config from "../config.js"
import { createLogger } from "../logger.js"
import { offlineCoordinator } from "../offline/coordinator.js"
import {
  detectEmotion,
  emotionToVoiceParams,
  getVoiceParamsForText,
  type EmotionContext,
  type EmotionTag,
  type EmotionVoiceParams,
} from "./emotion-engine.js"

const logger = createLogger("voice.bridge")
const PY = config.PYTHON_PATH ?? "python"
const CWD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../python")

// Re-export for consumers that only import bridge
export type { EmotionTag, EmotionContext, EmotionVoiceParams }

// ─────────────────────────────────────────────────────────────
//  Mobile audio configuration
// ─────────────────────────────────────────────────────────────

/** Audio configuration hints for mobile clients. */
export interface MobileVoiceConfig {
  /** ONNX quantization — q4 for mobile, q8 for desktop. */
  dtype: "q4" | "q8" | "fp16" | "fp32"
  /** PCM sample rate to send for STT. WhisperCpp expects 16 kHz. */
  sttSampleRate: 16000
  /** TTS output sample rate from Kokoro.js. */
  ttsSampleRate: 24000
  /** Max TTS chunk size in bytes before streaming to mobile client. */
  chunkBytes: number
  /** Whether to use mobile-safe emotion presets (fewer voices). */
  mobileEmotionPresets: true
}

/** Return audio config hints for mobile clients. */
export function getMobileVoiceConfig(): MobileVoiceConfig {
  return {
    dtype: "q4",
    sttSampleRate: 16000,
    ttsSampleRate: 24000,
    chunkBytes: 8192,        // ~0.17s of 24kHz PCM per chunk
    mobileEmotionPresets: true,
  }
}

// ─────────────────────────────────────────────────────────────
//  Phase 9: Kokoro.js TTS provider (emotion-aware)
// ─────────────────────────────────────────────────────────────

/** Lazily loaded KokoroTTS instance. Initialized once on first use. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let kokoroTTSInstance: any | null = null
let kokoroInitAttempted = false

/**
 * Load the KokoroTTS model (once).
 * Returns the instance or null if kokoro-js is not installed / fails.
 */
async function loadKokoroTTS(): Promise<unknown | null> {
  if (kokoroInitAttempted) {
    return kokoroTTSInstance
  }
  kokoroInitAttempted = true

  if (!config.KOKORO_TTS_ENABLED && !offlineCoordinator.isOffline()) {
    return null
  }

  try {
    const mod = await (Function("return import('kokoro-js')")() as Promise<unknown>).catch(() => null)
    if (!mod || typeof mod !== "object") {
      logger.warn("kokoro-js not installed — Python TTS will be used. Run: pnpm add kokoro-js")
      return null
    }

    const { KokoroTTS } = mod as {
      KokoroTTS: {
        from_pretrained: (model: string, opts: Record<string, unknown>) => Promise<unknown>
      }
    }
    logger.info("loading Kokoro TTS model", { dtype: config.KOKORO_TTS_DTYPE })

    kokoroTTSInstance = await KokoroTTS.from_pretrained(
      "onnx-community/Kokoro-82M-v1.0-ONNX",
      { dtype: config.KOKORO_TTS_DTYPE, device: "cpu" },
    )

    logger.info("Kokoro TTS ready", { voice: config.KOKORO_TTS_VOICE })
    return kokoroTTSInstance
  } catch (err) {
    logger.warn("Kokoro TTS init failed — Python TTS will be used", { err })
    kokoroTTSInstance = null
    return null
  }
}

/**
 * Synthesize speech using KokoroTTS with emotion-aware voice params.
 * Returns the WAV audio as a Buffer, or null if KokoroTTS is unavailable.
 *
 * @param text   - Text to synthesize
 * @param params - Voice params from EmotionEngine (voice, speed)
 */
async function kokoroSpeak(text: string, params: EmotionVoiceParams): Promise<Buffer | null> {
  const tts = await loadKokoroTTS()
  if (!tts) {
    return null
  }

  try {
    const kokoro = tts as {
      generate: (
        text: string,
        opts: Record<string, unknown>,
      ) => Promise<{ save: (path: string) => Promise<void> }>
    }
    const tmpPath = path.join(os.tmpdir(), `edith-tts-${Date.now()}.wav`)
    const audio = await kokoro.generate(text, {
      voice: params.voice,
      speed: params.speed,
    })
    await audio.save(tmpPath)
    const buffer = await fs.readFile(tmpPath)
    await fs.unlink(tmpPath).catch(() => undefined)
    logger.debug("Kokoro TTS synthesized", { emotion: params.emotion, voice: params.voice, speed: params.speed })
    return buffer
  } catch (err) {
    logger.warn("Kokoro TTS generate failed", { err })
    return null
  }
}

// ─────────────────────────────────────────────────────────────
//  Phase 9: WhisperCpp STT provider
// ─────────────────────────────────────────────────────────────

/** Whether nodejs-whisper has been attempted to load. */
let whisperCppAttempted = false
let whisperCppAvailable = false

/**
 * Probe whether nodejs-whisper is installed and the model is available.
 */
async function probeWhisperCpp(): Promise<boolean> {
  if (whisperCppAttempted) {
    return whisperCppAvailable
  }
  whisperCppAttempted = true

  if (!config.WHISPER_CPP_ENABLED && !offlineCoordinator.isOffline()) {
    return false
  }

  try {
    const mod = await (Function("return import('nodejs-whisper')")() as Promise<unknown>).catch(() => null)
    if (!mod || typeof mod !== "object") {
      logger.warn("nodejs-whisper not installed — Python STT will be used. Run: pnpm add nodejs-whisper")
      whisperCppAvailable = false
      return false
    }

    whisperCppAvailable = true
    logger.info("WhisperCpp STT available", { model: config.WHISPER_CPP_MODEL })
    return true
  } catch {
    whisperCppAvailable = false
    return false
  }
}

/**
 * Transcribe an audio file using WhisperCpp (nodejs-whisper).
 * Returns null if WhisperCpp is unavailable.
 *
 * @param audioPath - Path to WAV file (16 kHz, mono recommended)
 */
async function whisperCppTranscribe(audioPath: string): Promise<string | null> {
  const available = await probeWhisperCpp()
  if (!available) {
    return null
  }

  try {
    const mod = await (Function("return import('nodejs-whisper')")() as Promise<unknown>)
    const { nodewhisper } = mod as {
      nodewhisper: (
        filePath: string,
        opts: {
          modelName: string
          autoDownloadModelName: string
          whisperOptions: { outputInText: boolean; language: string }
        },
      ) => Promise<string>
    }

    const result = await nodewhisper(audioPath, {
      modelName: config.WHISPER_CPP_MODEL,
      autoDownloadModelName: config.WHISPER_CPP_MODEL,
      whisperOptions: {
        outputInText: true,
        language: config.VOICE_LANGUAGE || "auto",
      },
    })

    return typeof result === "string" ? result.trim() : String(result).trim()
  } catch (err) {
    logger.warn("WhisperCpp transcription failed", { err })
    return null
  }
}

// ─────────────────────────────────────────────────────────────
//  VoiceBridge class
// ─────────────────────────────────────────────────────────────

/**
 * VoiceBridge — unified TTS/STT orchestrator.
 *
 * Key additions vs Phase 9 skeleton:
 *  - speakWithEmotion()  — auto-detects emotion and picks Kokoro voice/speed
 *  - transcribeBuffer()  — mobile path: accepts raw WAV bytes via WebSocket
 *  - getMobileVoiceConfig() — static config hints for React Native client
 *  - startStreamingConversation() — tries Kokoro.js+Whisper before Python
 */
export class VoiceBridge {

  // ──────────────────────── Provider selection ────────────────────────

  /**
   * Determine if local TTS should be preferred over Python.
   * True when: KOKORO_TTS_ENABLED=true OR system is offline.
   */
  private shouldPreferLocalTTS(): boolean {
    return config.KOKORO_TTS_ENABLED || offlineCoordinator.isOffline()
  }

  /**
   * Determine if local STT should be preferred over Python.
   * True when: WHISPER_CPP_ENABLED=true OR system is offline.
   */
  private shouldPreferLocalSTT(): boolean {
    return config.WHISPER_CPP_ENABLED || offlineCoordinator.isOffline()
  }

  // ──────────────────────── TTS ────────────────────────────────────────

  /**
   * Speak text using the best available TTS provider (no emotion detection).
   * Uses the default Kokoro voice from config.
   *
   * Priority: Kokoro.js (local) → Python sidecar
   *
   * @param text         - Text to synthesize
   * @param voiceProfile - Voice profile name (Python sidecar only)
   */
  async speak(text: string, voiceProfile = "default"): Promise<void> {
    if (!config.VOICE_ENABLED) {
      return
    }

    if (this.shouldPreferLocalTTS()) {
      const params: EmotionVoiceParams = {
        voice: config.KOKORO_TTS_VOICE,
        speed: 1.0,
        emotion: "calm",
      }
      const audioBuffer = await kokoroSpeak(text, params)
      if (audioBuffer) {
        await this.playAudioBuffer(audioBuffer)
        return
      }
    }

    // Fallback: Python sidecar
    try {
      await execa(
        PY,
        ["-c",
          `from delivery.voice import VoicePipeline; VoicePipeline().speak(${JSON.stringify(text)}, ${JSON.stringify(voiceProfile)})`,
        ],
        { cwd: CWD },
      )
    } catch (err) {
      logger.error("speak failed", err)
    }
  }

  /**
   * Speak text with automatic emotion detection and voice modulation.
   *
   * EmotionEngine analyses the text (O(n) lexicon pass), selects the best
   * Kokoro voice and speed, then synthesizes via Kokoro.js.
   * Falls back to Python sidecar if Kokoro is unavailable.
   *
   * @param text    - Text EDITH is about to say
   * @param context - Optional emotion context hints (tone preset, hour, mobile)
   */
  async speakWithEmotion(text: string, context?: EmotionContext): Promise<void> {
    if (!config.VOICE_ENABLED) {
      return
    }

    if (this.shouldPreferLocalTTS()) {
      const overrideVoice = config.KOKORO_TTS_VOICE !== "af_heart" ? config.KOKORO_TTS_VOICE : undefined
      const params = getVoiceParamsForText(text, context, overrideVoice)
      const audioBuffer = await kokoroSpeak(text, params)
      if (audioBuffer) {
        await this.playAudioBuffer(audioBuffer)
        return
      }
    }

    // Fallback: Python sidecar (emotion ignored — Python side has its own prosody)
    try {
      await execa(
        PY,
        ["-c",
          `from delivery.voice import VoicePipeline; VoicePipeline().speak(${JSON.stringify(text)}, "default")`,
        ],
        { cwd: CWD },
      )
    } catch (err) {
      logger.error("speakWithEmotion fallback failed", err)
    }
  }

  /**
   * Synthesize text with a given emotion tag and return the raw WAV buffer.
   * Intended for mobile clients that want to receive audio over WebSocket.
   *
   * @param text      - Text to synthesize
   * @param emotion   - Explicit emotion (skips detection)
   * @param isMobile  - Use mobile-safe voice presets
   * @returns WAV buffer, or null if Kokoro.js is unavailable
   */
  async synthesizeToBuffer(
    text: string,
    emotion?: EmotionTag,
    isMobile = false,
  ): Promise<Buffer | null> {
    if (!config.VOICE_ENABLED) {
      return null
    }

    const resolvedEmotion = emotion ?? detectEmotion(text)
    const overrideVoice = config.KOKORO_TTS_VOICE !== "af_heart" ? config.KOKORO_TTS_VOICE : undefined
    const params = emotionToVoiceParams(resolvedEmotion, overrideVoice, isMobile)

    if (this.shouldPreferLocalTTS()) {
      const buffer = await kokoroSpeak(text, params)
      if (buffer) {
        return buffer
      }
    }

    // Python sidecar fallback — write to temp, return bytes
    try {
      const tmpPath = path.join(os.tmpdir(), `edith-tts-${Date.now()}.wav`)
      await execa(
        PY,
        ["-c",
          `from delivery.voice import VoicePipeline; VoicePipeline().speak_to_file(${JSON.stringify(text)}, "default", ${JSON.stringify(tmpPath)})`,
        ],
        { cwd: CWD },
      )
      const buf = await fs.readFile(tmpPath).catch(() => null)
      await fs.unlink(tmpPath).catch(() => undefined)
      return buf
    } catch (err) {
      logger.error("synthesizeToBuffer Python fallback failed", err)
      return null
    }
  }

  /**
   * Speak text with streaming chunks delivered via callback.
   *
   * Priority: Kokoro.js streaming (local, emotion-aware) → Python streaming sidecar
   *
   * @param text      - Text to synthesize
   * @param onChunk   - Called with each audio Buffer chunk
   * @param context   - Emotion context hints
   */
  async speakStreaming(
    text: string,
    onChunk: (audio: Buffer) => void,
    context?: EmotionContext,
  ): Promise<void> {
    if (!config.VOICE_ENABLED) {
      return
    }

    if (this.shouldPreferLocalTTS()) {
      const overrideVoice = config.KOKORO_TTS_VOICE !== "af_heart" ? config.KOKORO_TTS_VOICE : undefined
      const params = getVoiceParamsForText(text, context, overrideVoice)
      const success = await this.kokoroStreamSpeak(text, onChunk, params)
      if (success) {
        return
      }
    }

    // Fallback: Python streaming sidecar
    try {
      const pythonCode = [
        "import base64",
        "from delivery.voice import VoicePipeline",
        "def _cb(chunk):",
        "    if chunk is None: return",
        "    print(base64.b64encode(chunk).decode('ascii'), flush=True)",
        `VoicePipeline().speak_streaming(${JSON.stringify(text)}, "default", _cb)`,
      ].join("; ")

      const child = execa(PY, ["-c", pythonCode], { cwd: CWD })

      if (child.stdout) {
        let remainder = ""
        child.stdout.on("data", (chunk: Buffer | string) => {
          remainder += chunk.toString()
          const lines = remainder.split(/\r?\n/)
          remainder = lines.pop() ?? ""
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            try {
              onChunk(Buffer.from(trimmed, "base64"))
            } catch (error) {
              logger.warn("Failed to decode streaming TTS chunk", error)
            }
          }
        })
      }

      await child
    } catch (err) {
      logger.error("speakStreaming failed", err)
    }
  }

  // ──────────────────────── STT ────────────────────────────────────────

  /**
   * Listen for user speech (microphone capture + transcription).
   * Live microphone capture uses Python sidecar; file transcription uses WhisperCpp.
   *
   * @param duration - How many seconds to listen (default: 5)
   */
  async listen(duration = 5): Promise<string> {
    if (!config.VOICE_ENABLED) {
      return ""
    }

    try {
      const { stdout } = await execa(
        PY,
        ["-c",
          `from delivery.voice import VoicePipeline; print(VoicePipeline().listen(${duration}))`,
        ],
        { cwd: CWD, timeout: (duration + 10) * 1000 },
      )
      return stdout.trim()
    } catch (err) {
      logger.error("listen failed", err)
      return ""
    }
  }

  /**
   * Transcribe an audio file to text.
   *
   * Priority: WhisperCpp (local, offline) → Python sidecar
   *
   * @param audioSource - Absolute path to WAV/MP3/etc file
   */
  async transcribe(audioSource: string): Promise<string> {
    if (!config.VOICE_ENABLED) {
      return ""
    }

    if (this.shouldPreferLocalSTT()) {
      const result = await whisperCppTranscribe(audioSource)
      if (result !== null) {
        logger.debug("transcribed via WhisperCpp", { length: result.length })
        return result
      }
    }

    // Fallback: Python sidecar
    try {
      const { stdout } = await execa(
        PY,
        ["-c",
          `from delivery.voice import VoicePipeline; print(VoicePipeline().transcribe_file(${JSON.stringify(audioSource)}))`,
        ],
        { cwd: CWD, timeout: 60_000 },
      )
      return stdout.trim()
    } catch (err) {
      logger.error("transcribe failed", err)
      return ""
    }
  }

  /**
   * Transcribe raw audio bytes (mobile path).
   *
   * The mobile app captures PCM/WAV at 16 kHz mono and sends the bytes
   * via WebSocket. This method writes to a temp file, transcribes, and returns text.
   *
   * @param audioBuffer - Raw WAV bytes (16 kHz, 16-bit, mono)
   * @returns Transcribed text, or empty string on failure
   */
  async transcribeBuffer(audioBuffer: Buffer): Promise<string> {
    if (!config.VOICE_ENABLED) {
      return ""
    }

    const tmpPath = path.join(os.tmpdir(), `edith-stt-${Date.now()}.wav`)
    try {
      await fs.writeFile(tmpPath, audioBuffer)
      return await this.transcribe(tmpPath)
    } finally {
      await fs.unlink(tmpPath).catch(() => undefined)
    }
  }

  // ──────────────────────── Streaming conversation ─────────────────────

  /**
   * Start a full streaming voice conversation session.
   *
   * Tries Kokoro.js (TTS) + WhisperCpp (STT) first for zero-dependency
   * offline mode. Falls back to Python StreamingVoicePipeline.
   *
   * Architecture: arXiv 2508.04721 multi-threaded concurrent pipeline.
   *
   * @param onTranscript  - Called when user speech is transcribed
   * @param onAudioChunk  - Called with each TTS audio chunk (base64 string)
   * @param emotionContext - Optional emotion context for voice modulation
   * @returns Stop function to end the conversation
   */
  async startStreamingConversation(
    onTranscript: (text: string) => void,
    onAudioChunk: (chunk: string) => void,
    emotionContext?: EmotionContext,
  ): Promise<() => void> {
    if (!config.VOICE_ENABLED) {
      return () => {}
    }

    // Phase 9: Try native TS path when both local providers are available
    const kokoroReady = this.shouldPreferLocalTTS() && !!(await loadKokoroTTS())
    const whisperReady = this.shouldPreferLocalSTT() && await probeWhisperCpp()

    if (kokoroReady && whisperReady) {
      logger.info("streaming conversation: using Kokoro.js + WhisperCpp (native TS)")
      return this.startNativeStreamingConversation(onTranscript, onAudioChunk, emotionContext)
    }

    // Fallback: Python StreamingVoicePipeline
    logger.info("streaming conversation: using Python sidecar")
    return this.startPythonStreamingConversation(onTranscript, onAudioChunk)
  }

  // ──────────────────────── Info / diagnostics ─────────────────────────

  /**
   * Return mobile audio configuration hints (for React Native client).
   */
  getMobileVoiceConfig(): MobileVoiceConfig {
    return getMobileVoiceConfig()
  }

  /** List available voice profiles from the Python sidecar. */
  async listProfiles(): Promise<string[]> {
    try {
      const { stdout } = await execa(
        PY,
        ["-c",
          "from delivery.voice import VoicePipeline; import json; print(json.dumps(VoicePipeline().list_voice_profiles()))",
        ],
        { cwd: CWD },
      )
      return JSON.parse(stdout)
    } catch (err) {
      logger.error("listProfiles failed", err)
      return []
    }
  }

  /** Clone a voice from a reference audio file. */
  async cloneVoice(referenceAudio: string, voiceName: string): Promise<string> {
    const { stdout } = await execa(
      PY,
      ["-c",
        `from delivery.voice import VoicePipeline; print(VoicePipeline().clone_voice_from_file(${JSON.stringify(referenceAudio)}, ${JSON.stringify(voiceName)}))`,
      ],
      { cwd: CWD, timeout: 60_000 },
    )
    return stdout.trim()
  }

  /**
   * Check if wake word has been detected in recent audio.
   *
   * @param keyword       - Wake word to listen for (default: "edith")
   * @param windowSeconds - How long to listen (default: 2s)
   */
  async checkWakeWord(keyword = "edith", windowSeconds = 2): Promise<boolean> {
    if (!config.VOICE_ENABLED) return false

    // WhisperCpp path: capture via Python mic, transcribe via WhisperCpp
    if (this.shouldPreferLocalSTT()) {
      try {
        const { stdout } = await execa(
          PY,
          ["-c",
            `from delivery.voice import VoicePipeline; p = VoicePipeline(); import tempfile, os; f = tempfile.mktemp(suffix='.wav'); p.record_to_file(${windowSeconds}, f); print(f)`,
          ],
          { cwd: CWD, timeout: (windowSeconds + 5) * 1000 },
        )
        const audioFile = stdout.trim()
        if (audioFile) {
          const text = await whisperCppTranscribe(audioFile)
          await fs.unlink(audioFile).catch(() => undefined)
          if (text !== null) {
            return text.toLowerCase().includes(keyword.toLowerCase())
          }
        }
      } catch {
        // Fall through to Python path
      }
    }

    // Python fallback
    try {
      const { stdout } = await execa(
        PY,
        ["-c",
          `from delivery.voice import VoicePipeline; import json; p = VoicePipeline(); text = p.listen(${windowSeconds}); print(json.dumps("${keyword}".lower() in text.lower()))`,
        ],
        { cwd: CWD, timeout: (windowSeconds + 5) * 1000 },
      )
      return stdout.trim() === "true"
    } catch {
      return false
    }
  }

  /**
   * Report current TTS/STT provider status.
   * Useful for `pnpm run doctor` and debugging.
   */
  async getProviderStatus(): Promise<{
    tts: "kokoro-js" | "python"
    stt: "whisper-cpp" | "python"
    offline: boolean
    emotionEngine: true
  }> {
    const isOffline = offlineCoordinator.isOffline()
    const kokoroReady = (config.KOKORO_TTS_ENABLED || isOffline) && !!(await loadKokoroTTS())
    const whisperReady = (config.WHISPER_CPP_ENABLED || isOffline) && await probeWhisperCpp()

    return {
      tts: kokoroReady ? "kokoro-js" : "python",
      stt: whisperReady ? "whisper-cpp" : "python",
      offline: isOffline,
      emotionEngine: true,
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Private helpers
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Play audio buffer using platform-appropriate command.
   * afplay (macOS), powershell (Windows), aplay (Linux).
   */
  private async playAudioBuffer(buffer: Buffer): Promise<void> {
    const tmpPath = path.join(os.tmpdir(), `edith-play-${Date.now()}.wav`)
    try {
      await fs.writeFile(tmpPath, buffer)

      if (process.platform === "darwin") {
        await execa("afplay", [tmpPath])
      } else if (process.platform === "win32") {
        await execa("powershell", [
          "-c",
          `(New-Object Media.SoundPlayer '${tmpPath}').PlaySync()`,
        ])
      } else {
        await execa("aplay", [tmpPath])
      }
    } catch (err) {
      logger.warn("audio playback failed", { err })
    } finally {
      await fs.unlink(tmpPath).catch(() => undefined)
    }
  }

  /**
   * Attempt Kokoro.js streaming synthesis with emotion-aware params.
   * Returns true if successful, false if Kokoro is unavailable.
   *
   * @param text    - Text to synthesize
   * @param onChunk - Callback with audio buffer chunks
   * @param params  - Voice params from EmotionEngine
   */
  private async kokoroStreamSpeak(
    text: string,
    onChunk: (audio: Buffer) => void,
    params: EmotionVoiceParams,
  ): Promise<boolean> {
    const tts = await loadKokoroTTS()
    if (!tts) {
      return false
    }

    try {
      const kokoro = tts as {
        generate: (
          text: string,
          opts: Record<string, unknown>,
        ) => Promise<{ save: (path: string) => Promise<void> }>
      }

      const tmpPath = path.join(os.tmpdir(), `edith-tts-${Date.now()}.wav`)
      const audio = await kokoro.generate(text, {
        voice: params.voice,
        speed: params.speed,
      })
      await audio.save(tmpPath)
      const buffer = await fs.readFile(tmpPath)
      await fs.unlink(tmpPath).catch(() => undefined)

      // Deliver in configurable chunk size (mobile-friendly)
      const chunkSize = 8192
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        onChunk(buffer.subarray(offset, offset + chunkSize))
      }
      return true
    } catch (err) {
      logger.warn("Kokoro streaming failed", { err })
      return false
    }
  }

  /**
   * Native TS streaming conversation using Kokoro.js + WhisperCpp.
   * Used when both local providers are confirmed available.
   *
   * Architecture: record mic → WhisperCpp STT → LLM → Kokoro.js TTS → chunks
   * The LLM step is handled by the caller via the message pipeline; here we
   * set up the audio I/O loop.
   */
  private startNativeStreamingConversation(
    onTranscript: (text: string) => void,
    /** Reserved: caller receives TTS audio via synthesizeToBuffer() after getting LLM response. */
    _onAudioChunk: (chunk: string) => void,
    /** Reserved: passed to synthesizeToBuffer() by the caller's TTS step. */
    _emotionContext?: EmotionContext,
  ): () => void {
    let active = true

    const loop = async (): Promise<void> => {
      while (active) {
        try {
          // 1. Capture a short audio slice via Python mic (platform mic access)
          const tmpPath = path.join(os.tmpdir(), `edith-listen-${Date.now()}.wav`)
          await execa(
            PY,
            ["-c",
              `from delivery.voice import VoicePipeline; VoicePipeline().record_to_file(2, ${JSON.stringify(tmpPath)})`,
            ],
            { cwd: CWD, timeout: 8_000 },
          ).catch(() => null)

          if (!active) break

          // 2. Transcribe via WhisperCpp
          const transcript = await whisperCppTranscribe(tmpPath)
          await fs.unlink(tmpPath).catch(() => undefined)

          if (transcript && transcript.trim().length > 0 && active) {
            onTranscript(transcript.trim())
          }
        } catch (err) {
          logger.warn("native streaming loop error", { err })
          // Brief pause before retry
          await new Promise(r => setTimeout(r, 500))
        }
      }
    }

    void loop().catch(err => logger.error("native streaming loop fatal", { err }))

    return () => {
      active = false
      logger.info("native streaming conversation stopped")
    }
  }

  /**
   * Python StreamingVoicePipeline fallback for streaming conversations.
   * Original implementation — unchanged from Phase 9 skeleton.
   */
  private startPythonStreamingConversation(
    onTranscript: (text: string) => void,
    onAudioChunk: (chunk: string) => void,
  ): () => void {
    const pythonCode = `
import sys, threading, json, base64
sys.path.insert(0, '.')
from delivery.streaming_voice import StreamingVoicePipeline
stop_event = threading.Event()
pipeline = StreamingVoicePipeline()
def on_speech(text):
    print("TRANSCRIPT:" + json.dumps(text), flush=True)
def on_chunk(chunk):
    print("AUDIO:" + base64.b64encode(chunk).decode('utf-8'), flush=True)
async def get_llm_response(user_text):
    yield "I heard: " + user_text
pipeline.run_conversation(on_speech, on_chunk, get_llm_response, stop_event)
`.trim()

    const child = execa(PY, ["-c", pythonCode], { cwd: CWD })

    if (child.stdout) {
      let buffer = ""
      child.stdout.on("data", (chunk: Buffer | string) => {
        buffer += chunk.toString()
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          if (line.startsWith("TRANSCRIPT:")) {
            try { onTranscript(JSON.parse(line.slice("TRANSCRIPT:".length))) }
            catch { onTranscript(line.slice("TRANSCRIPT:".length)) }
          } else if (line.startsWith("AUDIO:")) {
            onAudioChunk(line.slice("AUDIO:".length))
          }
        }
      })
    }

    return () => {
      child.kill("SIGTERM")
      logger.info("Python streaming conversation stopped")
    }
  }
}

/** Singleton export. */
export const voice = new VoiceBridge()
