/**
 * @file smart-form-filler.ts
 * @description LLM-driven form field mapping from user intent.
 *
 * ARCHITECTURE:
 *   Input: user intent string + detected form fields (from DOM simplifier)
 *   Process: LLM decides field→value mapping
 *   Output: array of {edithId, value} pairs for browserTool fill_element actions
 *
 *   Flow:
 *   1. SmartFormFiller.extractFields() — parse BrowserObservation for form fields
 *   2. SmartFormFiller.plan()          — LLM maps intent → fill plan
 *   3. browserTool executes fill_element actions using the plan
 *   4. If fields missing → missingInfo returned, ask user before proceeding
 *
 * PAPER BASIS:
 *   Mind2Web arXiv:2306.06070 — cross-website generalization: model must be able
 *   to map "destination: Bandung" to a field with placeholder "Arrival City" or
 *   "Kota Tujuan" → we use LLM for this generalization.
 *
 * DIPAKAI from:
 *   RecipeEngine.execute() — recipe knows there is a form but does not hardcode selectors
 *   browserTool action "smart_fill" — for freeform form filling
 *
 * @module browser/smart-form-filler
 */

import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"
import type { BrowserObservation, BrowserInteractableElement } from "../agents/tools/browser.js"

const log = createLogger("browser.smart-form-filler")

// ── Types ─────────────────────────────────────────────────────────────────────

/** Metadata about a detected form field. */
export interface FormFieldInfo {
  /** Set-of-Mark ID assigned by the SOM injector */
  edithId: string
  /** HTML tag: input, select, textarea */
  tag: string
  /** Human-readable label (aria-label, placeholder, nearby label text) */
  label?: string
  /** Input type: text, email, date, select, password, number */
  type?: string
  /** Available options for select elements */
  options?: string[]
  /** Whether the field is required */
  required: boolean
}

/** LLM-generated plan for filling a form. */
export interface FillPlan {
  /** Fields to fill with their values and confidence score */
  fills: Array<{ edithId: string; value: string; confidence: number }>
  /** Information that must be gathered from the user before filling */
  missingInfo: string[]
  /** Warnings that require user confirmation before proceeding */
  warnings: string[]
}

// ── SmartFormFiller ───────────────────────────────────────────────────────────

export class SmartFormFiller {
  /**
   * Generate a fill plan from user intent + detected form fields.
   * The LLM maps natural language intent → concrete field values.
   *
   * @param intent - User request string ("book tiket Bandung Sabtu pagi")
   * @param fields - Form fields detected on the current page
   * @param context - Additional user context (name, email, etc. from user profile)
   * @returns FillPlan with fills, missingInfo, and warnings
   */
  async plan(
    intent: string,
    fields: FormFieldInfo[],
    context: Record<string, string>,
  ): Promise<FillPlan> {
    const fieldDescriptions = fields
      .map((f) => {
        const parts = [`id=${f.edithId}`, `tag=${f.tag}`]
        if (f.label) parts.push(`label="${f.label}"`)
        if (f.type) parts.push(`type=${f.type}`)
        if (f.options?.length) parts.push(`options=[${f.options.slice(0, 8).join(", ")}]`)
        if (f.required) parts.push("required")
        return `  { ${parts.join(", ")} }`
      })
      .join("\n")

    const contextStr =
      Object.keys(context).length > 0
        ? `\nUser context:\n${Object.entries(context)
            .map(([k, v]) => `  ${k}: ${v}`)
            .join("\n")}`
        : ""

    const prompt = `You are a form-filling assistant. Map the user intent to form field values.

User intent: "${intent}"${contextStr}

Form fields:
${fieldDescriptions}

Respond with a JSON object (no markdown):
{
  "fills": [
    { "edithId": "e00", "value": "...", "confidence": 0.9 }
  ],
  "missingInfo": ["..."], 
  "warnings": ["..."]
}

Rules:
- Only fill fields where you can confidently derive the value from the intent or context.
- For password fields, always add a warning asking user to confirm.
- If critical fields (required, no value derivable) are missing, add to missingInfo.
- For date fields, use YYYY-MM-DD format if possible, or the value as-is.
- missingInfo and warnings should be empty arrays if nothing is missing or suspicious.`

    try {
      const raw = (await orchestrator.generate("fast", { prompt })).trim()
      // Strip markdown code blocks if present
      const jsonStr = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
      const parsed = JSON.parse(jsonStr) as FillPlan
      log.debug("smart fill plan generated", {
        intent: intent.slice(0, 60),
        fillCount: parsed.fills.length,
        missingCount: parsed.missingInfo.length,
      })
      return parsed
    } catch (err) {
      log.warn("smart fill plan failed", { err: String(err) })
      return { fills: [], missingInfo: ["Unable to parse form — please fill manually"], warnings: [] }
    }
  }

  /**
   * Extract form fields from a BrowserObservation (Set-of-Mark elements).
   * Filters to input/select/textarea elements only.
   *
   * @param observation - Current browser state from getCurrentBrowserObservation()
   * @returns Array of FormFieldInfo for all detected form elements
   */
  extractFields(observation: BrowserObservation): FormFieldInfo[] {
    const formTags = new Set(["input", "select", "textarea"])
    return observation.elements
      .filter((el: BrowserInteractableElement) => formTags.has(el.tag))
      .map((el: BrowserInteractableElement): FormFieldInfo => ({
        edithId: el.id,
        tag: el.tag,
        label: el.ariaLabel || el.placeholder || el.text || undefined,
        type: el.tag === "input" ? (el.role || "text") : el.tag,
        required: false, // accessibility tree doesn't expose required, default false
      }))
      .filter((f) => f.edithId)
  }
}

/** Singleton instance */
export const smartFormFiller = new SmartFormFiller()
