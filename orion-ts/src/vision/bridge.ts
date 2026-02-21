import { execa } from "execa"
import config from "../config"
import * as path from "path"

export class VisionBridge {
  private pythonPath = config.PYTHON_PATH
  private projectRoot = path.resolve("..")

  async analyzeScreen(prompt = "What is on the screen?"): Promise<string> {
    if (!config.VISION_ENABLED) {
      return "[Vision disabled] VISION_ENABLED is false"
    }

    const escapedPrompt = prompt.replace(/"/g, '\\"')
    const code = `from vision.processor import VisionProcessor; print(VisionProcessor().analyze_screen("${escapedPrompt}"))`

    try {
      const { stdout } = await execa(this.pythonPath, ["-c", code], {
        cwd: this.projectRoot,
        timeout: 60000,
      })
      return stdout.trim()
    } catch (err) {
      console.error("[VisionBridge] analyzeScreen failed:", err)
      return `[Error] Screen analysis failed: ${err}`
    }
  }

  async analyzeFrame(imagePath: string, prompt: string): Promise<string> {
    if (!config.VISION_ENABLED) {
      return "[Vision disabled] VISION_ENABLED is false"
    }

    const escapedPrompt = prompt.replace(/"/g, '\\"')
    const escapedPath = imagePath.replace(/"/g, '\\"')
    const code = `from vision.processor import VisionProcessor; import cv2; frame = cv2.imread("${escapedPath}"); print(VisionProcessor().analyze_frame(frame, "${escapedPrompt}"))`

    try {
      const { stdout } = await execa(this.pythonPath, ["-c", code], {
        cwd: this.projectRoot,
        timeout: 60000,
      })
      return stdout.trim()
    } catch (err) {
      console.error("[VisionBridge] analyzeFrame failed:", err)
      return `[Error] Frame analysis failed: ${err}`
    }
  }

  async extractTextFromImage(imagePath: string): Promise<string> {
    if (!config.VISION_ENABLED) {
      return "[Vision disabled] VISION_ENABLED is false"
    }

    const escapedPath = imagePath.replace(/"/g, '\\"')
    const code = `from vision.processor import VisionProcessor; import cv2; frame = cv2.imread("${escapedPath}"); print(VisionProcessor().extract_text_from_frame(frame))`

    try {
      const { stdout } = await execa(this.pythonPath, ["-c", code], {
        cwd: this.projectRoot,
        timeout: 30000,
      })
      return stdout.trim()
    } catch (err) {
      console.error("[VisionBridge] extractTextFromImage failed:", err)
      return `[Error] OCR failed: ${err}`
    }
  }

  async detectObjects(imagePath: string): Promise<Array<{ name: string; position: string }>> {
    if (!config.VISION_ENABLED) {
      return []
    }

    const escapedPath = imagePath.replace(/"/g, '\\"')
    const code = `from vision.processor import VisionProcessor; import cv2; import json; frame = cv2.imread("${escapedPath}"); print(json.dumps(VisionProcessor().detect_objects(frame)))`

    try {
      const { stdout } = await execa(this.pythonPath, ["-c", code], {
        cwd: this.projectRoot,
        timeout: 60000,
      })
      return JSON.parse(stdout)
    } catch (err) {
      console.error("[VisionBridge] detectObjects failed:", err)
      return []
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!config.VISION_ENABLED) {
      return false
    }

    const code = `from vision.processor import VisionProcessor; print(VisionProcessor().is_available())`

    try {
      const { stdout } = await execa(this.pythonPath, ["-c", code], {
        cwd: this.projectRoot,
        timeout: 10000,
      })
      return stdout.trim().toLowerCase() === "true"
    } catch {
      return false
    }
  }
}

export const vision = new VisionBridge()
