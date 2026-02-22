import { execa } from "execa"
import path from "node:path"
import { fileURLToPath } from "node:url"

import config from "../config.js"
import { createLogger } from "../logger.js"

const logger = createLogger("voice")
const PY = config.PYTHON_PATH ?? "python"
const CWD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../python")

/**
 * VoiceBridge — Interface to Python voice pipeline.
 *
 * Provides both batch (legacy) and streaming (T-3) voice processing.
 *
 * Research: arXiv 2508.04721 (Low-Latency Voice Agents)
 *           arXiv 2509.15969 (VoXtream streaming TTS)
 */
export class VoiceBridge {
  // ============== Legacy Methods (backward compatibility) ==============

  async speak(text: string, voiceProfile = "default"): Promise<void> {
    if (!config.VOICE_ENABLED) {
      return
    }

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

  async speakStreaming(
    text: string,
    voiceProfile: string,
    onChunk: (audio: Buffer) => void,
  ): Promise<void> {
    if (!config.VOICE_ENABLED) {
      return
    }

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

  // ============== T-3: Streaming Voice Pipeline Methods ==============

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
   * @param keyword - Wake word to listen for (default: "orion")
   * @param windowSeconds - How long to listen (default: 2s)
   */
  async checkWakeWord(keyword = "orion", windowSeconds = 2): Promise<boolean> {
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
