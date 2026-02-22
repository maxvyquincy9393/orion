/**
 * screenshotAnalyzeTool — Capture and analyze screen content via Vision LLM.
 *
 * Connects the existing VisionBridge (Python layer) to the agent tool system.
 * Allows Orion to "see" the screen and answer questions about it.
 *
 * Actions:
 *   analyze_screen  — Capture screen and analyze with prompt
 *   analyze_region  — Capture specific region (x, y, width, height)
 *   extract_text    — OCR text from screen
 *
 * Vision engine: Gemini Vision (primary), GPT-4V (fallback)
 * Based on OS Agent paradigm (arXiv 2501.16150):
 * visual input is essential for GUI-level task understanding.
 *
 * @module agents/tools/screenshot
 */
import { tool } from "ai"
import { z } from "zod"
import { vision } from "../../vision/bridge.js"
import config from "../../config.js"
import { createLogger } from "../../logger.js"

const log = createLogger("tools.screenshot")

export const screenshotAnalyzeTool = tool({
  description: `Capture and analyze the screen using Vision AI.
Actions: analyze_screen(prompt), extract_text (OCR).
Requires VISION_ENABLED=true and a Google or OpenAI API key.
Use for: understanding what's on screen, reading visible text, describing UI state.`,
  inputSchema: z.object({
    action: z.enum(["analyze_screen", "extract_text"]),
    prompt: z.string().optional().default("What is on the screen? Describe it in detail."),
  }),
  execute: async ({ action, prompt }) => {
    if (!config.VISION_ENABLED) {
      return "Vision not enabled. Set VISION_ENABLED=true in config."
    }

    try {
      if (action === "analyze_screen" || action === "extract_text") {
        const analysisPrompt = action === "extract_text"
          ? "Extract and return ALL visible text from this screen. Include all UI labels, content, and text."
          : (prompt ?? "What is on the screen?")

        const result = await vision.analyzeScreen(analysisPrompt)
        if (!result || result.startsWith("[Error]")) {
          return result || "Vision analysis returned empty result."
        }

        log.info("screenshotAnalyzeTool complete", { action, chars: result.length })
        return result
      }

      return "Unknown action"
    } catch (err) {
      log.error("screenshotAnalyzeTool failed", { action, error: String(err) })
      return `Screen analysis failed: ${String(err)}`
    }
  },
})
