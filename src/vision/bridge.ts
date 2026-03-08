/**
 * @file bridge.ts
 * @description VisionBridge — unified vision analysis with offline-capable provider routing.
 *
 * ARCHITECTURE:
 *   Provider routing (analyzeScreen / analyzeFrame):
 *     1. Ollama multimodal (moondream/llava) — when VISION_ENGINE='ollama' or offline
 *     2. Python sidecar (Gemini / OpenAI Vision) — default cloud path
 *
 *   analyzeImageWithOllama():
 *     Encodes image as base64, sends to Ollama /api/generate with the vision model.
 *     Recommended models: moondream:1.8b (1.1GB) or llava:7b (4.7GB).
 *
 *   OfflineCoordinator integration:
 *     When offlineCoordinator.isOffline(), Ollama multimodal is automatically preferred.
 *
 * PAPER BASIS:
 *   - Phase 9 design: "LOCAL IS THE ARMOR, CLOUD IS THE UPGRADE"
 *   - LLaVA (Liu et al., 2023) — visual instruction tuning (Ollama models)
 *   - Moondream (2024) — 1.8B params, edge-optimized multimodal
 *
 * @module vision/bridge
 */

import { execa } from "execa"
import path from "node:path"
import { fileURLToPath } from "node:url"
import fs from "node:fs/promises"

import config from "../config.js"
import { createLogger } from "../logger.js"
import { offlineCoordinator } from "../offline/coordinator.js"

const logger = createLogger("vision.bridge")
const PY = config.PYTHON_PATH ?? "python"
const CWD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../python")

/** Default Ollama vision model to use for offline analysis. */
const OLLAMA_VISION_MODEL_DEFAULT = "moondream"

/** Timeout for Ollama vision API calls (ms). */
const OLLAMA_VISION_TIMEOUT_MS = 30_000

/**
 * Analyze an image using Ollama's multimodal API.
 *
 * @param imagePath - Absolute path to the image file
 * @param prompt    - Analysis prompt
 * @returns Analysis text or null if Ollama is unavailable
 */
async function analyzeImageWithOllama(imagePath: string, prompt: string): Promise<string | null> {
  const baseUrl = config.OLLAMA_BASE_URL?.trim() || "http://localhost:11434"

  try {
    const imageData = await fs.readFile(imagePath)
    const base64Image = imageData.toString("base64")

    const model = OLLAMA_VISION_MODEL_DEFAULT
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), OLLAMA_VISION_TIMEOUT_MS)

    try {
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          images: [base64Image],
          stream: false,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        logger.warn("Ollama vision API error", { status: response.status })
        return null
      }

      const payload = await response.json() as { response?: string }
      return payload.response?.trim() ?? null
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    logger.warn("Ollama vision analysis failed", { err })
    return null
  }
}

/**
 * Capture a screenshot and save to a temp file (platform-aware).
 * Returns the temp file path or null on failure.
 */
async function captureScreenshot(): Promise<string | null> {
  const tmpPath = path.join(
    process.env.TEMP ?? process.env.TMPDIR ?? "/tmp",
    `edith-screen-${Date.now()}.png`,
  )

  try {
    if (process.platform === "darwin") {
      await execa("screencapture", ["-x", tmpPath])
    } else if (process.platform === "win32") {
      // PowerShell screenshot
      await execa("powershell", [
        "-command",
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $bitmap = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); $bitmap.Save('${tmpPath}') }`,
      ])
    } else {
      // Linux: try scrot, fall back to import (ImageMagick)
      await execa("scrot", [tmpPath]).catch(
        async () => execa("import", ["-window", "root", tmpPath]),
      )
    }
    return tmpPath
  } catch (err) {
    logger.warn("screenshot capture failed", { err })
    return null
  }
}

/**
 * VisionBridge — vision analysis with offline-capable provider routing.
 *
 * Phase 9 adds Ollama multimodal as a first-priority provider when:
 *   - VISION_ENGINE='ollama' is configured
 *   - OfflineCoordinator reports offline/degraded state
 *
 * The Python sidecar (Gemini / OpenAI Vision) remains the default cloud provider.
 */
export class VisionBridge {
  /**
   * Determine if Ollama vision should be preferred.
   */
  private shouldUseOllamaVision(): boolean {
    return (
      config.VISION_ENGINE === "ollama"
      || offlineCoordinator.isOffline()
    )
  }

  /**
   * Analyze the current screen content.
   *
   * Priority: Ollama multimodal (offline) → Python sidecar (Gemini/OpenAI)
   *
   * @param prompt - What to look for / analyze on screen
   */
  async analyzeScreen(prompt = "What is on the screen?"): Promise<string> {
    if (!config.VISION_ENABLED) {
      return ""
    }

    // Phase 9: Try Ollama multimodal when offline or configured
    if (this.shouldUseOllamaVision()) {
      const screenshotPath = await captureScreenshot()
      if (screenshotPath) {
        try {
          const result = await analyzeImageWithOllama(screenshotPath, prompt)
          await fs.unlink(screenshotPath).catch(() => undefined)
          if (result) {
            logger.debug("screen analyzed via Ollama", { length: result.length })
            return result
          }
        } catch (err) {
          logger.warn("Ollama screen analysis failed, falling back to Python", { err })
          await fs.unlink(screenshotPath).catch(() => undefined)
        }
      }
    }

    // Fallback: Python sidecar
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

  /**
   * Analyze an image file.
   *
   * Priority: Ollama multimodal (offline) → Python sidecar (Gemini/OpenAI)
   *
   * @param imagePath - Path to the image file
   * @param prompt    - Analysis prompt
   */
  async analyzeFrame(imagePath: string, prompt = "What do you see?"): Promise<string> {
    if (!config.VISION_ENABLED) {
      return ""
    }

    // Phase 9: Try Ollama multimodal when offline or configured
    if (this.shouldUseOllamaVision()) {
      const result = await analyzeImageWithOllama(imagePath, prompt)
      if (result) {
        logger.debug("frame analyzed via Ollama", { imagePath, length: result.length })
        return result
      }
    }

    // Fallback: Python sidecar
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

  /**
   * Analyze an image from a URL (downloads first, then analyzes).
   * Always uses Ollama or Python cloud vision depending on routing.
   *
   * @param imageUrl - URL of the image to analyze
   * @param prompt   - Analysis prompt
   */
  async analyzeImageUrl(imageUrl: string, prompt = "Describe this image."): Promise<string> {
    if (!config.VISION_ENABLED) {
      return ""
    }

    // For URL analysis, always use Python sidecar (handles download + analysis)
    // Ollama path: download first then call analyzeFrame
    if (this.shouldUseOllamaVision()) {
      try {
        const tmpPath = path.join(
          process.env.TEMP ?? process.env.TMPDIR ?? "/tmp",
          `edith-img-${Date.now()}.png`,
        )
        const response = await fetch(imageUrl)
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer())
          await fs.writeFile(tmpPath, buffer)
          const result = await analyzeImageWithOllama(tmpPath, prompt)
          await fs.unlink(tmpPath).catch(() => undefined)
          if (result) {
            return result
          }
        }
      } catch (err) {
        logger.warn("Ollama URL image analysis failed", { err })
      }
    }

    // Fallback: Python sidecar
    try {
      const { stdout } = await execa(
        PY,
        [
          "-c",
          `from vision.processor import VisionProcessor; from vision.stream import CameraStream; s = CameraStream(); print(VisionProcessor(s).analyze_url(${JSON.stringify(imageUrl)}, ${JSON.stringify(prompt)}))`,
        ],
        { cwd: CWD, timeout: 30_000 },
      )
      return stdout.trim()
    } catch (err) {
      logger.error("analyzeImageUrl failed", err)
      return ""
    }
  }

  /**
   * Get current vision provider status for diagnostics.
   */
  getProviderStatus(): { provider: "ollama" | "python"; offline: boolean } {
    return {
      provider: this.shouldUseOllamaVision() ? "ollama" : "python",
      offline: offlineCoordinator.isOffline(),
    }
  }
}

/** Singleton export. */
export const vision = new VisionBridge()
