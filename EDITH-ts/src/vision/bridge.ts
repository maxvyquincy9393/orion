import { execa } from "execa"
import path from "node:path"
import { fileURLToPath } from "node:url"

import config from "../config.js"
import { createLogger } from "../logger.js"

const logger = createLogger("vision")
const PY = config.PYTHON_PATH ?? "python"
const CWD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../python")

export class VisionBridge {
  async analyzeScreen(prompt = "What is on the screen?"): Promise<string> {
    if (!config.VISION_ENABLED) {
      return ""
    }

    try {
      const { stdout } = await execa(
        PY,
        [
          "-c",
          `from vision.processor import VisionProcessor; from vision.stream import CameraStream; s = CameraStream(); print(VisionProcessor(s).analyze_screen(${JSON.stringify(
            prompt,
          )}))`,
        ],
        { cwd: CWD, timeout: 30_000 },
      )
      return stdout.trim()
    } catch (err) {
      logger.error("analyzeScreen failed", err)
      return ""
    }
  }

  async analyzeFrame(imagePath: string, prompt = "What do you see?"): Promise<string> {
    if (!config.VISION_ENABLED) {
      return ""
    }

    try {
      const { stdout } = await execa(
        PY,
        [
          "-c",
          `import cv2; from vision.processor import VisionProcessor; from vision.stream import CameraStream; s = CameraStream(); frame = cv2.imread(${JSON.stringify(
            imagePath,
          )}); print(VisionProcessor(s).analyze_frame(frame, ${JSON.stringify(prompt)}))`,
        ],
        { cwd: CWD, timeout: 30_000 },
      )
      return stdout.trim()
    } catch (err) {
      logger.error("analyzeFrame failed", err)
      return ""
    }
  }
}

export const vision = new VisionBridge()
