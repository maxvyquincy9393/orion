/**
 * @file bridge.ts
 * @description VoiceBridge — unified TTS/STT orchestrator with offline-capable providers.
 *
 * ARCHITECTURE:
 *   Provider priority (TTS):
 *     1. Kokoro.js (kokoro-js, pure TS, offline) — when KOKORO_TTS_ENABLED=true
 *     2. Python streaming pipeline (Kokoro + Whisper Python) — legacy fallback
 *
 *   Provider priority (STT):
 *     1. WhisperCpp via nodejs-whisper (offline) — when WHISPER_CPP_ENABLED=true
 *     2. Python streaming pipeline — legacy fallback
 *
 *   OfflineCoordinator integration:
 *     When offlineCoordinator.isOffline(), local providers are preferred automatically.
 *
 *   Backward compatibility:
 *     All existing methods (speak, listen, transcribe, etc.) are preserved.
 *     Phase 9 providers are opt-in via config flags.
 *
 * PAPER BASIS:
 *   - arXiv:2508.04721 (Low-Latency Voice Agents) — multi-threaded pipeline architecture
 *   - arXiv:2509.15969 (VoXtream streaming TTS) — streaming chunk delivery
 *   - Phase 9 design: "LOCAL IS THE ARMOR, CLOUD IS THE UPGRADE"
 *     kokoro-js: pnpm add kokoro-js (82M params, ONNX, pure TS)
 *     nodejs-whisper: pnpm add nodejs-whisper (whisper.cpp TS bindings)
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

const logger = createLogger("voice.bridge")
const PY = config.PYTHON_PATH ?? "python"
const CWD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../python")

// ============================================================
//  Phase 9: Kokoro.js TTS provider (optional)
// ============================================================

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

  if (!config.KOKORO_TTS_ENABLED) {
    return null
  }

  try {
    // Dynamic import to avoid compile-time errors when package is not installed
    const mod = await (Function("return import('kokoro-js')")() as Promise<unknown>).catch(() => null)
    if (!mod || typeof mod !== "object") {
      logger.warn("kokoro-js not installed — Python TTS will be used. Run: pnpm add kokoro-js")
      return null
    }

    const { KokoroTTS } = mod as { KokoroTTS: { from_pretrained: (model: string, opts: Record<string, unknown>) => Promise<unknown> } }
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
 * Synthesize speech using KokoroTTS and return the audio as a Buffer.
 * Returns null if KokoroTTS is unavailable.
 */
async function kokoroSpeak(text: string): Promise<Buffer | null> {
  const tts = await loadKokoroTTS()
  if (!tts) {
    return null
  }

  try {
    const kokoro = tts as { generate: (text: string, opts: Record<string, unknown>) => Promise<{ save: (path: string) => Promise<void> }> }
    const tmpPath = path.join(os.tmpdir(), `edith-tts-${Date.now()}.wav`)
    const audio = await kokoro.generate(text, { voice: config.KOKORO_TTS_VOICE, speed: 1.0 })
    await audio.save(tmpPath)
    const buffer = await fs.readFile(tmpPath)
    await fs.unlink(tmpPath).catch(() => undefined)
    return buffer
  } catch (err) {
    logger.warn("Kokoro TTS generate failed", { err })
    return null
  }
}

// ============================================================
//  Phase 9: WhisperCpp STT provider (optional)
// ============================================================

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

  if (!config.WHISPER_CPP_ENABLED) {
    return false
  }

  try {
    // Check if nodejs-whisper is resolvable
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
        }
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

// ============================================================
//  VoiceBridge class
// ============================================================

/**
 * VoiceBridge — unified TTS/STT orchestrator.
 *
 * Phase 9 adds native TS providers (Kokoro.js + WhisperCpp) as first-priority
 * when their respective config flags are enabled. The Python sidecar remains
 * the fallback for maximum compatibility.
 *
 * When offline (OfflineCoordinator), local providers are automatically preferred.
 */
export class VoiceBridge {
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

  // ============== TTS ==============

  /**
   * Speak text using the best available TTS provider.
   *
   * Priority: Kokoro.js (local) → Python sidecar (cloud/local Kokoro)
   *
   * @param text         - Text to synthesize
   * @param voiceProfile - Voice profile name (Python sidecar only)
   */
  async speak(text: string, voiceProfile = "default"): Promise<void> {
    if (!config.VOICE_ENABLED) {
      return
    }

    // Phase 9: Try Kokoro.js first
    if (this.shouldPreferLocalTTS()) {
      const audioBuffer = await kokoroSpeak(text)
      if (audioBuffer) {
        await this.playAudioBuffer(audioBuffer)
        return
      }
    }

    // Fallback: Python sidecar
    try {
      await execa(
        PY,
        [
          "-c",
          `from delivery.voice import VoicePipeline; VoicePipeline().speak(${JSON.stringify(
            text,
          )}, ${JSON.stringify(voiceProfile)})`,
        ],
        { cwd: CWD },
      )
    } catch (err) {
      logger.error("speak failed", err)
    }
  }

  /**
   * Speak text with streaming chunks delivered via callback.
   *
   * Priority: Kokoro.js streaming (local) → Python streaming sidecar
   *
   * @param text         - Text to synthesize
   * @param voiceProfile - Voice profile (Python sidecar)
   * @param onChunk      - Called with each audio Buffer chunk
   */
  async speakStreaming(
    text: string,
    voiceProfile: string,
    onChunk: (audio: Buffer) => void,
  ): Promise<void> {
    if (!config.VOICE_ENABLED) {
      return
    }

    // Phase 9: Try Kokoro.js streaming
    if (this.shouldPreferLocalTTS()) {
      const success = await this.kokoroStreamSpeak(text, onChunk)
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
        "    if chunk is None:",
        "        return",
        "    print(base64.b64encode(chunk).decode('ascii'), flush=True)",
        `VoicePipeline().speak_streaming(${JSON.stringify(text)}, ${JSON.stringify(voiceProfile)}, _cb)`,
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
            if (!trimmed) {
              continue
            }

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

  // ============== STT ==============

  /**
   * Listen for user speech (microphone capture + transcription).
   *
   * Note: Phase 9 local STT requires a pre-recorded file. Live microphone
   * capture still uses the Python sidecar for now.
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
        [
          "-c",
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
   * @param audioSource - Path to audio file
   */
  async transcribe(audioSource: string): Promise<string> {
    if (!config.VOICE_ENABLED) {
      return ""
    }

    // Phase 9: Try WhisperCpp first
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
        [
          "-c",
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

  // ============== Utility / Unchanged methods ==============

  /** List available voice profiles from the Python sidecar. */
  async listProfiles(): Promise<string[]> {
    try {
      const { stdout } = await execa(
        PY,
        [
          "-c",
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
      [
        "-c",
        `from delivery.voice import VoicePipeline; print(VoicePipeline().clone_voice_from_file(${JSON.stringify(
          referenceAudio,
        )}, ${JSON.stringify(voiceName)}))`,
      ],
      { cwd: CWD, timeout: 60_000 },
    )
    return stdout.trim()
  }

  /**
   * Start a full streaming voice conversation session.
   *
   * Uses the StreamingVoicePipeline which runs ASR, LLM, and TTS
   * concurrently for lower end-to-end latency (<800ms target).
   *
   * Architecture: arXiv 2508.04721 multi-threaded concurrent pipeline.
   *
   * @param onTranscript - Called when user speech is transcribed
   * @param onAudioChunk - Called with each TTS audio chunk (base64 string)
   * @returns Stop function to end the conversation
   */
  async startStreamingConversation(
    onTranscript: (text: string) => void,
    onAudioChunk: (chunk: string) => void,
  ): Promise<() => void> {
    if (!config.VOICE_ENABLED) {
      return () => {}
    }

    const pythonCode = `
import sys
import threading
import json
import base64
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
            try {
              const text = JSON.parse(line.slice("TRANSCRIPT:".length))
              onTranscript(text)
            } catch {
              onTranscript(line.slice("TRANSCRIPT:".length))
            }
          } else if (line.startsWith("AUDIO:")) {
            onAudioChunk(line.slice("AUDIO:".length))
          }
        }
      })
    }

    return () => {
      child.kill("SIGTERM")
      logger.info("streaming voice conversation stopped")
    }
  }

  /**
   * Check if wake word has been detected in recent audio.
   *
   * @param keyword       - Wake word to listen for (default: "edith")
   * @param windowSeconds - How long to listen (default: 2s)
   */
  async checkWakeWord(keyword = "edith", windowSeconds = 2): Promise<boolean> {
    if (!config.VOICE_ENABLED) return false

    try {
      const { stdout } = await execa(
        PY,
        [
          "-c",
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
  }> {
    const isOffline = offlineCoordinator.isOffline()
    const kokoroReady = config.KOKORO_TTS_ENABLED && !!(await loadKokoroTTS())
    const whisperReady = config.WHISPER_CPP_ENABLED && await probeWhisperCpp()

    return {
      tts: (kokoroReady || isOffline) && kokoroReady ? "kokoro-js" : "python",
      stt: (whisperReady || isOffline) && whisperReady ? "whisper-cpp" : "python",
      offline: isOffline,
    }
  }

  // ============================================================
  //  Private helpers
  // ============================================================

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
   * Attempt Kokoro.js streaming synthesis.
   * Returns true if successful, false if Kokoro is unavailable.
   */
  private async kokoroStreamSpeak(
    text: string,
    onChunk: (audio: Buffer) => void,
  ): Promise<boolean> {
    const tts = await loadKokoroTTS()
    if (!tts) {
      return false
    }

    try {
      const kokoro = tts as {
        stream: (splitter: unknown) => AsyncIterable<{ audio: Buffer }>
        TextSplitterStream?: new () => unknown
        generate: (text: string, opts: Record<string, unknown>) => Promise<{ save: (path: string) => Promise<void> }>
      }

      // Kokoro.js streaming: generates and delivers chunks
      // Fallback to batch generation if streaming API is unavailable
      const tmpPath = path.join(os.tmpdir(), `edith-tts-${Date.now()}.wav`)
      const audio = await kokoro.generate(text, { voice: config.KOKORO_TTS_VOICE, speed: 1.0 })
      await audio.save(tmpPath)
      const buffer = await fs.readFile(tmpPath)
      await fs.unlink(tmpPath).catch(() => undefined)

      // Deliver as single chunk
      onChunk(buffer)
      return true
    } catch (err) {
      logger.warn("Kokoro streaming failed", { err })
      return false
    }
  }
}

/** Singleton export. */
export const voice = new VoiceBridge()
