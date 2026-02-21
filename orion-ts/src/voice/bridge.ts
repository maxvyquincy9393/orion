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
