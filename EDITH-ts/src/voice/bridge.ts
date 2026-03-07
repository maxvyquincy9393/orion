import { execa } from "execa"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import config from "../config.js"
import { createLogger } from "../logger.js"
import { VOICE_PYTHON_CWD, resolveVoicePythonCommand } from "./python-runtime.js"
import { EdgeEngine } from "./edge-engine.js"
import { AudioDSP } from "./dsp.js"
import { EDITH_VOICE, EDITH_DSP, CLEAN_DSP } from "./edith-preset.js"
import type { DSPPreset } from "./edith-preset.js"

const logger = createLogger("voice")
const PY = resolveVoicePythonCommand()
const CWD = VOICE_PYTHON_CWD

export interface VoiceTtsOverrides {
  voice?: string
  rate?: string | number
  pitch?: string
}

/**
 * VoiceBridge — Native TypeScript voice engine with EDITH personality.
 *
 * Phase 11: Replaces Python-bridge TTS with native TypeScript engines.
 *
 * Primary:  Edge TTS (free, no GPU, no API key, 300+ neural voices)
 * Fallback: Python voice pipeline (legacy, requires Python + GPU)
 *
 * Research: arXiv 2508.04721 (Low-Latency Voice Agents)
 *           arXiv 2509.15969 (VoXtream streaming TTS)
 */
export class VoiceBridge {
  private edge = new EdgeEngine()
  private dsp = new AudioDSP(24000)

  private get dspPreset(): DSPPreset {
    if (!config.VOICE_DSP_ENABLED) return CLEAN_DSP
    if (config.VOICE_DSP_PRESET === "clean") return CLEAN_DSP
    return EDITH_DSP
  }

  // ============== Phase 11: Native TypeScript TTS ==============

  /**
   * Speak text using the native TypeScript TTS engine.
   *
   * Pipeline: text → Edge TTS (neural voice) → DSP (EDITH character) → audio
   *
   * @param text - Text to speak.
   * @param _voiceProfile - Legacy param, ignored. Use VOICE_EDGE_VOICE env var.
   */
  async speak(
    text: string,
    _voiceProfile = "default",
    overrides: VoiceTtsOverrides = {},
  ): Promise<Buffer | void> {
    if (!config.VOICE_ENABLED) {
      return
    }

    const backend = config.VOICE_TTS_BACKEND ?? "edge"

    if (backend === "edge") {
      return this.speakWithEdge(text, overrides)
    }

    // Legacy fallback to Python
    return this.speakWithPython(text, _voiceProfile)
  }

  /**
   * Stream speech audio chunks via callback.
   *
   * @param text - Text to speak.
   * @param _voiceProfile - Legacy param.
   * @param onChunk - Called with each audio chunk.
   */
  async speakStreaming(
    text: string,
    _voiceProfile: string,
    onChunk: (audio: Buffer) => void,
    overrides: VoiceTtsOverrides = {},
  ): Promise<void> {
    if (!config.VOICE_ENABLED) {
      return
    }

    const backend = config.VOICE_TTS_BACKEND ?? "edge"

    if (backend === "edge") {
      try {
        await this.edge.stream(text, onChunk, {
          voice: overrides.voice ?? config.VOICE_EDGE_VOICE ?? EDITH_VOICE.voice,
          rate: overrides.rate ?? config.VOICE_EDGE_RATE ?? EDITH_VOICE.rate,
          pitch: overrides.pitch ?? config.VOICE_EDGE_PITCH ?? EDITH_VOICE.pitch,
        })
        return
      } catch (err) {
        logger.warn("edge streaming failed, falling back to python", err)
      }
    }

    // Legacy Python fallback
    return this.speakStreamingPython(text, _voiceProfile, onChunk)
  }

  /**
   * List available TTS voices.
   */
  async listVoices(): Promise<Array<{ Name: string; ShortName: string; Gender: string; Locale: string }>> {
    return this.edge.listVoices()
  }

  // ============== Edge TTS Implementation ==============

  private async speakWithEdge(text: string, overrides: VoiceTtsOverrides = {}): Promise<Buffer> {
    try {
      const audio = await this.edge.generate(text, {
        voice: overrides.voice ?? config.VOICE_EDGE_VOICE ?? EDITH_VOICE.voice,
        rate: overrides.rate ?? config.VOICE_EDGE_RATE ?? EDITH_VOICE.rate,
        pitch: overrides.pitch ?? config.VOICE_EDGE_PITCH ?? EDITH_VOICE.pitch,
      })
      logger.info("edge tts generated", { bytes: audio.length, text: text.slice(0, 50) })
      return audio
    } catch (err) {
      logger.error("edge tts failed, falling back to python", err)
      await this.speakWithPython(text, "default")
      return Buffer.alloc(0)
    }
  }

  // ============== Legacy Python Fallback ==============

  private async speakWithPython(text: string, voiceProfile: string): Promise<void> {
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
      logger.error("python speak failed", err)
    }
  }

  private async speakStreamingPython(
    text: string,
    voiceProfile: string,
    onChunk: (audio: Buffer) => void,
  ): Promise<void> {
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
      logger.error("python speakStreaming failed", err)
    }
  }

  // ============== STT (still Python — Whisper) ==============

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

  async transcribe(audioSource: string): Promise<string> {
    if (!config.VOICE_ENABLED) {
      return ""
    }

    return this.transcribeWithPython(audioSource)
  }

  async transcribeBuffer(audio: Buffer, extension = ".wav"): Promise<string> {
    if (!config.VOICE_ENABLED) {
      return ""
    }

    const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`
    const tempFile = path.join(os.tmpdir(), `edith-voice-${Date.now()}-${Math.random().toString(36).slice(2)}${normalizedExtension}`)

    try {
      await fs.writeFile(tempFile, audio)
      return await this.transcribeWithPython(tempFile)
    } catch (err) {
      logger.error("transcribeBuffer failed", err)
      return ""
    } finally {
      await fs.unlink(tempFile).catch(() => {})
    }
  }

  private async transcribeWithPython(audioSource: string): Promise<string> {
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

  // ============== Profile Management ==============

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

  // ============== T-3: Streaming Voice Pipeline ==============

  /**
   * Start a full streaming voice conversation session.
   *
   * Uses the new StreamingVoicePipeline which runs ASR, LLM, and TTS
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
      return () => { }
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
    # Send base64 audio chunk
    print("AUDIO:" + base64.b64encode(chunk).decode('utf-8'), flush=True)

async def get_llm_response(user_text):
    # Placeholder - TypeScript side handles LLM calls
    # In full implementation, this would be a WebSocket back-channel
    # For now, just echo back
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

    // Return stop function
    return () => {
      child.kill("SIGTERM")
      logger.info("streaming voice conversation stopped")
    }
  }

  /**
   * Check if wake word has been detected in recent audio.
   * Runs a short background listen and returns immediately with result.
   *
   * @param keyword - Wake word to listen for (default: "edith")
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
}

export const voice = new VoiceBridge()
