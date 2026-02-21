import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"

const log = createLogger("media-understanding.image")

export class ImageAnalyzer {
  async analyze(imageSource: string, prompt?: string): Promise<string> {
    try {
      const analysisPrompt = prompt ?? "Describe this image in detail. What do you see?"

      const engine = orchestrator.route("multimodal")

      const response = await engine.generate({
        prompt: analysisPrompt,
        context: [
          {
            role: "user",
            content: `[Image: ${imageSource}]\n\n${analysisPrompt}`,
          },
        ],
      })

      return response
    } catch (error) {
      log.error("analyze failed", error)
      return "Unable to analyze image"
    }
  }
}

export const imageAnalyzer = new ImageAnalyzer()
