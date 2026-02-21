import { execa } from "execa"

import config from "../config.js"
import { createLogger } from "../logger.js"

const logger = createLogger("voice")
const PY = config.PYTHON_PATH ?? "python"
const CWD = ".."

export class VoiceBridge {
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
}

export const voice = new VoiceBridge()
