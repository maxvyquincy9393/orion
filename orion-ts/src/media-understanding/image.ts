import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"

const log = createLogger("media-understanding.image")

export class ImageAnalyzer {
  async analyze(imageSource: string, prompt?: string): Promise<string> {
    try {
      const sourceType = this.detectSourceType(imageSource)
      if (sourceType === "unknown") {
        return "Unsupported image source. Use http(s) URL or base64 data URL."
      }

      const analysisPrompt = prompt ?? "Describe this image in detail. What do you see?"

      const engine = orchestrator.route("multimodal")

      const response = await engine.generate({
        prompt: analysisPrompt,
        context: [
          {
            role: "user",
            content: `[Image source type: ${sourceType}]\n[Image: ${imageSource}]\n\n${analysisPrompt}`,
          },
        ],
      })

      return response
    } catch (error) {
      log.error("analyze failed", error)
      return "Unable to analyze image"
    }
  }

  private detectSourceType(source: string): "url" | "base64" | "unknown" {
    if (/^https?:\/\//i.test(source.trim())) {
      return "url"
    }

    if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(source.trim())) {
      return "base64"
    }

    return "unknown"
  }
}

export const imageAnalyzer = new ImageAnalyzer()
