import { execa } from "execa"
import config from "../config"
import * as path from "path"

export class VoiceBridge {
  private pythonPath = config.PYTHON_PATH
  private projectRoot = path.resolve("..")

  async speak(text: string, voiceProfile = "default"): Promise<void> {
    if (!config.VOICE_ENABLED) {
      return
    }

    const escapedText = text.replace(/"/g, '\\"')
    const code = `from delivery.voice import VoicePipeline; VoicePipeline().speak("${escapedText}", "${voiceProfile}")`

    try {
      await execa(this.pythonPath, ["-c", code], {
        cwd: this.projectRoot,
        timeout: 60000,
      })
    } catch (err) {
      console.error("[VoiceBridge] speak failed:", err)
    }
  }

  async listen(duration = 5): Promise<string> {
    if (!config.VOICE_ENABLED) {
      return ""
    }

    const code = `from delivery.voice import VoicePipeline; print(VoicePipeline().listen(${duration}))`

    try {
      const { stdout } = await execa(this.pythonPath, ["-c", code], {
        cwd: this.projectRoot,
        timeout: duration * 1000 + 10000,
      })
      return stdout.trim()
    } catch (err) {
      console.error("[VoiceBridge] listen failed:", err)
      return ""
    }
  }

  async listVoiceProfiles(): Promise<string[]> {
    const code = `from delivery.voice import VoicePipeline; import json; print(json.dumps(VoicePipeline().list_voice_profiles()))`

    try {
      const { stdout } = await execa(this.pythonPath, ["-c", code], {
        cwd: this.projectRoot,
        timeout: 30000,
      })
      return JSON.parse(stdout)
    } catch (err) {
      console.error("[VoiceBridge] listVoiceProfiles failed:", err)
      return []
    }
  }

  async transcribeFile(audioPath: string): Promise<string> {
    const code = `from delivery.voice import VoicePipeline; print(VoicePipeline().transcribe_file("${audioPath}"))`

    try {
      const { stdout } = await execa(this.pythonPath, ["-c", code], {
        cwd: this.projectRoot,
        timeout: 120000,
      })
      return stdout.trim()
    } catch (err) {
      console.error("[VoiceBridge] transcribeFile failed:", err)
      return ""
    }
  }

  async cloneVoiceFromSample(samplePath: string, voiceName: string): Promise<boolean> {
    const code = `from delivery.voice import VoicePipeline; VoicePipeline().clone_voice_from_file("${samplePath}", "${voiceName}")`

    try {
      await execa(this.pythonPath, ["-c", code], {
        cwd: this.projectRoot,
        timeout: 60000,
      })
      return true
    } catch (err) {
      console.error("[VoiceBridge] cloneVoiceFromSample failed:", err)
      return false
    }
  }
}

export const voice = new VoiceBridge()
