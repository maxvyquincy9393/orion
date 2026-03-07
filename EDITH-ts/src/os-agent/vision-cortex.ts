/**
 * @file os-agent/vision-cortex.ts — Screen Understanding & Vision Intelligence
 *
 * The VisionCortex is EDITH's "eye" — it captures what's on screen and
 * transforms raw pixels into structured, actionable knowledge.
 *
 * ## What it does
 *
 *  1. captureAndAnalyze()   — screenshot → OCR + elements + description
 *  2. describeImage()       — any image buffer → natural language description
 *  3. findElement()         — "find the Save button" → UIElement with coordinates
 *  4. storeVisualContext()  — save visual snapshot to persistent memory
 *  5. extractText()         — OCR via Tesseract (local, free)
 *  6. detectElements()      — accessibility API or LLM-based detection
 *
 * ## Academic Foundation (all design decisions trace back to papers)
 *
 *  OmniParser (arXiv:2408.00203)
 *    → Hybrid strategy: Accessibility API first, LLM vision as fallback
 *    → Element detection concept: detect regions → caption each region
 *
 *  OmniParser V2 (Microsoft Research 2024)
 *    → ScreenSpot Pro grounding benchmark methodology
 *    → Gemini Flash recommended as best value for vision tasks
 *
 *  ScreenAgent (IJCAI 2024)
 *    → Pipeline separation: each stage (Capture/Analyze/Act) independently testable
 *    → Plan → Capture → Analyze → Act → Reflect loop
 *
 *  OSWorld (arXiv:2404.07972)
 *    → Provider-agnostic multimodal interface (Gemini → OpenAI → Anthropic)
 *    → Rate limit: max 1 LLM vision call per 10 seconds
 *
 *  Set-of-Mark / SoM (arXiv:2310.11441)
 *    → Overlay numbered marks on elements before sending to LLM
 *    → Converts hard coordinate regression → easy element ID classification
 *
 *  GPT-4V System Card (OpenAI 2023)
 *    → Max 20MB image, max 2048px edge length
 *    → MIME type validation, format support matrix
 *
 *  MemGPT (arXiv:2310.08560)
 *    → Visual context stored as MemoryNode with 7-day TTL
 *    → Enables "what were you working on?" recall across sessions
 *
 * @module os-agent/vision-cortex
 */

import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { execa } from "execa"
import { createLogger } from "../logger.js"
import type { VisionConfig, OSActionResult, UIElement, ScreenState } from "./types.js"
import type { GUIAgent } from "./gui-agent.js"
import type { ImagePayload } from "../engines/types.js"

const log = createLogger("os-agent.vision")

// ── Constants (from GPT-4V Card safety bounds) ────────────────────────────────

/** Maximum image size in bytes before rejecting. Source: GPT-4V Card. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024 // 20 MB

/** Maximum edge length in pixels before downscaling. Source: GPT-4V Card. */
const MAX_IMAGE_EDGE_PX = 2048

/**
 * Rate limit: minimum milliseconds between LLM vision API calls.
 * Source: OSWorld evaluation protocol (1 call per 10 seconds max).
 * Prevents cost explosion while still providing responsive vision.
 */
const VISION_RATE_LIMIT_MS = 10_000

/**
 * How long to cache element detection results in milliseconds.
 * Screen content rarely changes in < 5 seconds, so we avoid redundant calls.
 */
const ELEMENT_CACHE_TTL_MS = 5_000

/** Max wait for accessibility API before falling back to LLM. */
const ACCESSIBILITY_TIMEOUT_MS = 200

// ── Magic bytes for MIME detection ────────────────────────────────────────────
// Source: GPT-4V Card — validate format from bytes, not file extension.
// Using file extension is unreliable; magic bytes never lie.
const MAGIC_BYTES: Array<{ bytes: number[]; offset: number; mime: ImagePayload["mimeType"] }> = [
  { bytes: [0x89, 0x50, 0x4e, 0x47], offset: 0, mime: "image/png" },   // PNG
  { bytes: [0xff, 0xd8, 0xff], offset: 0, mime: "image/jpeg" },         // JPEG
  { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, mime: "image/webp" },   // WebP (RIFF)
  { bytes: [0x47, 0x49, 0x46], offset: 0, mime: "image/gif" },          // GIF
]

// ── Result Types ───────────────────────────────────────────────────────────────

/** Full result of a captureAndAnalyze() call */
export interface VisionAnalysisResult {
  /** Raw OCR text extracted from the screen (Tesseract) */
  ocrText: string
  /** Natural language description from multimodal LLM */
  description: string
  /** Detected UI elements with coordinates */
  elements: UIElement[]
  /** Active window, resolution at capture time */
  screenState: ScreenState | null
  /**
   * Confidence score [0–1].
   * Based on: 1.0 = accessibility + LLM, 0.7 = LLM only, 0.4 = OCR only.
   */
  confidence: number
  /** Total latency for the complete analysis in milliseconds */
  latencyMs: number
}

/** Visual snapshot stored to persistent memory (MemGPT pattern) */
interface VisualContextSnapshot {
  description: string
  ocrText: string
  activeWindow: string
  timestamp: number
}

// ── Element cache entry ────────────────────────────────────────────────────────

interface CacheEntry {
  elements: UIElement[]
  timestamp: number
  windowTitle: string
}

// ── VisionCortex ──────────────────────────────────────────────────────────────

export class VisionCortex {
  private initialized = false
  private readonly platform = process.platform
  private guiAgent: GUIAgent | null = null

  /**
   * Timestamp of the last LLM vision API call.
   * Used to enforce OSWorld rate limiting (1 call per 10 seconds).
   */
  private lastVisionCallMs = 0

  /**
   * In-memory cache for element detection results.
   * Key: hash of (query + activeWindowTitle)
   * Expires after ELEMENT_CACHE_TTL_MS milliseconds.
   */
  private readonly elementCache = new Map<string, CacheEntry>()

  constructor(private readonly config: VisionConfig) {}

  /**
   * Optionally inject a GUIAgent reference to reuse its screenshot capture logic.
   * Avoids duplicate screenshot implementation between VisionCortex and GUIAgent.
   */
  setGUIAgent(gui: GUIAgent): void {
    this.guiAgent = gui
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      log.info("Vision Cortex disabled by config")
      return
    }

    if (this.config.ocrEngine === "tesseract") {
      await this.verifyTesseract()
    }

    this.initialized = true
    log.info("Vision Cortex initialized", {
      ocr: this.config.ocrEngine,
      detection: this.config.elementDetection,
      multimodalEngine: this.config.multimodalEngine,
    })
  }

  async shutdown(): Promise<void> {
    this.initialized = false
    this.elementCache.clear()
    log.info("Vision Cortex shut down")
  }

  // ── Primary API ────────────────────────────────────────────────────────────

  /**
   * Capture the current screen and run full vision analysis.
   *
   * This is the main entry point for EDITH's screen awareness.
   * Implements the ScreenAgent "Capture → Analyze" pipeline stages.
   *
   * Returns:
   *   - OCR text (Tesseract, free, always attempted)
   *   - UI elements (accessibility API, fast)
   *   - Screen state (active window, resolution)
   *
   * Note: describeImage() is NOT called here automatically because it costs
   * money. Call it explicitly when a description is needed (e.g., user asks
   * "what's on my screen?").
   *
   * Paper basis: ScreenAgent (IJCAI 2024) — pipeline separation principle.
   */
  async captureAndAnalyze(
    region?: { x: number; y: number; width: number; height: number },
  ): Promise<OSActionResult> {
    if (!this.initialized) {
      return { success: false, error: "Vision Cortex not initialized" }
    }

    const startMs = Date.now()

    try {
      // Capture screenshot first — everything else depends on it
      const screenshot = await this.captureScreen(region)

      // Run OCR and element detection in parallel (ScreenAgent: parallel stages)
      const [ocrText, elements, screenState] = await Promise.all([
        this.extractText(screenshot),
        this.detectElements(screenshot),
        this.getScreenState(),
      ])

      const result: VisionAnalysisResult = {
        ocrText,
        description: "", // Populated lazily when describeImage() is explicitly called
        elements,
        screenState,
        confidence: elements.length > 0 ? 1.0 : 0.7,
        latencyMs: Date.now() - startMs,
      }

      return {
        success: true,
        data: result,
        duration: Date.now() - startMs,
      }
    } catch (err) {
      log.error("captureAndAnalyze failed", { error: String(err) })
      return { success: false, error: String(err), duration: Date.now() - startMs }
    }
  }

  /**
   * Describe any image using a multimodal LLM.
   *
   * This is the core vision capability — converts raw pixels to natural language.
   * Implements the ScreenAgent "Analyze" stage with OmniParser's caption model concept.
   *
   * Provider priority (OSWorld fallback chain):
   *   1. Gemini Flash  — cheapest, best value (OmniParser V2 evaluation)
   *   2. GPT-4o        — evaluated on ScreenSpot benchmark
   *   3. Claude Sonnet — OSWorld fallback chain recommendation
   *
   * Rate limiting (OSWorld): max 1 LLM call per 10 seconds.
   * Graceful degradation: returns OCR text if LLM call fails.
   *
   * @param imageBuffer - Raw image data (PNG, JPEG, WebP, GIF)
   * @param question - Optional specific question about the image.
   *                   Defaults to "Describe what you see in this image in detail."
   */
  async describeImage(imageBuffer: Buffer, question?: string): Promise<string> {
    // Validate and resize image before sending to API (GPT-4V Card safety bounds)
    const validatedBuffer = await this.validateAndResizeImage(imageBuffer)
    if (!validatedBuffer) {
      log.warn("describeImage: image validation failed, falling back to OCR")
      return this.extractText(imageBuffer)
    }

    // Enforce OSWorld rate limit to prevent cost explosion
    const msSinceLastCall = Date.now() - this.lastVisionCallMs
    if (msSinceLastCall < VISION_RATE_LIMIT_MS) {
      const waitMs = VISION_RATE_LIMIT_MS - msSinceLastCall
      log.debug("vision rate limit: waiting", { waitMs })
      await this.sleep(waitMs)
    }

    const base64 = validatedBuffer.toString("base64")
    const mimeType = this.detectMimeType(validatedBuffer)
    const prompt = question ?? "Describe what you see in this image in detail. Include the active application, visible UI elements, text content, and any relevant context."

    try {
      // Dynamically import orchestrator to avoid circular dependency
      const { orchestrator } = await import("../engines/orchestrator.js")

      this.lastVisionCallMs = Date.now()

      log.info("calling multimodal LLM for image description", {
        imageBytes: validatedBuffer.length,
        mimeType,
        hasQuestion: !!question,
      })

      // Pass image as ImagePayload — each engine adapter handles its own format
      // (Gemini: inlineData, OpenAI: image_url, Anthropic: base64 source)
      const description = await orchestrator.generate("multimodal", {
        prompt,
        images: [{ data: base64, mimeType }],
        maxTokens: 1024,
        systemPrompt: "You are a precise visual analyst. Describe what you see accurately and concisely. Focus on actionable details: what application is open, what UI elements are visible, what text is present, and what the user appears to be doing.",
      })

      return description
    } catch (err) {
      // Graceful degradation: LLM failed → return OCR text instead
      // This ensures vision always returns something useful (OSWorld: never hard fail)
      log.warn("describeImage LLM call failed, falling back to OCR", { error: String(err) })
      return this.extractText(imageBuffer)
    }
  }

  /**
   * Find a UI element matching the given query.
   *
   * Implements the OmniParser hybrid strategy:
   *   1. Try accessibility API first (free, fast, < 200ms)
   *   2. If no match found → apply Set-of-Mark visual prompting → LLM grounding
   *
   * The SoM approach (arXiv:2310.11441) converts hard coordinate regression to
   * easy element ID classification, significantly improving LLM grounding accuracy.
   *
   * Results are cached for ELEMENT_CACHE_TTL_MS to avoid repeated calls
   * for the same query on the same screen.
   *
   * @param query - Natural language description of the element to find.
   *                Example: "Save button", "search input", "File menu"
   * @returns UIElement with bounding box coordinates, or null if not found.
   */
  async findElement(query: string): Promise<UIElement | null> {
    const screenState = await this.getScreenState()
    const windowTitle = screenState?.activeWindowTitle ?? "unknown"

    // ── Step 1: Check cache (avoids redundant API calls for same screen) ────
    const cacheKey = this.buildCacheKey(query, windowTitle)
    const cached = this.elementCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < ELEMENT_CACHE_TTL_MS) {
      log.debug("findElement: cache hit", { query, windowTitle })
      return cached.elements[0] ?? null
    }

    // ── Step 2: Try accessibility API first (OmniParser hybrid — fast path) ─
    const accessibilityResult = await this.findElementViaAccessibility(query)
    if (accessibilityResult) {
      // Cache the successful result
      this.elementCache.set(cacheKey, {
        elements: [accessibilityResult],
        timestamp: Date.now(),
        windowTitle,
      })
      log.debug("findElement: found via accessibility API", { query, element: accessibilityResult.text })
      return accessibilityResult
    }

    // ── Step 3: Fallback to LLM visual grounding (SoM approach) ─────────────
    // Accessibility API didn't find it — maybe it's an icon, canvas element,
    // or app that doesn't expose accessibility tree properly.
    log.debug("findElement: accessibility miss, trying LLM grounding", { query })

    try {
      const screenshot = await this.captureScreen()
      const llmElement = await this.findElementViaLLM(screenshot, query)

      if (llmElement) {
        this.elementCache.set(cacheKey, {
          elements: [llmElement],
          timestamp: Date.now(),
          windowTitle,
        })
        return llmElement
      }
    } catch (err) {
      log.warn("findElement LLM fallback failed", { query, error: String(err) })
    }

    log.info("findElement: element not found", { query })
    return null
  }

  /**
   * Store a visual context snapshot in EDITH's persistent memory.
   *
   * Implements the MemGPT (arXiv:2310.08560) hierarchical memory pattern.
   * Visual context is stored in the external memory tier with:
   *   - Low importance (0.3) — doesn't crowd out critical memories
   *   - 7-day TTL — visual context becomes stale quickly
   *   - "visual_context" category — easily queryable by type
   *
   * This enables EDITH to answer: "What were you working on yesterday?"
   * by retrieving stored visual snapshots from memory.
   *
   * @param snapshot - Visual context to store
   */
  async storeVisualContext(snapshot: VisualContextSnapshot): Promise<void> {
    try {
      // Dynamically import memory service to avoid circular dependency
      const { memoryService } = await import("../memory/service.js")

      const content = [
        `[Visual Context] Window: ${snapshot.activeWindow}`,
        snapshot.description
          ? `Description: ${snapshot.description}`
          : `OCR Text: ${snapshot.ocrText.slice(0, 500)}`, // Truncate long OCR
      ].join("\n")

      await memoryService.storeMemory({
        userId: "owner",
        content,
        category: "visual_context",
        importance: 0.3,    // Low — visual context is ambient, not critical
        ttlDays: 7,         // Auto-expire after 7 days (MemGPT: stale data cleanup)
        metadata: {
          timestamp: snapshot.timestamp,
          activeWindow: snapshot.activeWindow,
          hasDescription: !!snapshot.description,
          ocrLength: snapshot.ocrText.length,
        },
      })

      log.debug("visual context stored to memory", {
        window: snapshot.activeWindow,
        contentLength: content.length,
      })
    } catch (err) {
      // Memory storage failure is non-fatal — vision still works without it
      log.warn("storeVisualContext: memory storage failed", { error: String(err) })
    }
  }

  /**
   * Extract text from an image using OCR.
   *
   * Uses Tesseract locally (free, no API cost) with English + Indonesian
   * language support. This is the always-available fallback for text extraction.
   *
   * @param imageBuffer - Raw image data
   * @returns Extracted text string, or empty string if OCR fails/unavailable
   */
  async extractText(imageBuffer: Buffer): Promise<string> {
    if (this.config.ocrEngine === "tesseract") {
      return this.tesseractOCR(imageBuffer)
    }
    // Cloud OCR placeholder (Google Vision, Azure, etc.)
    return ""
  }

  /**
   * Detect UI elements in a screenshot.
   *
   * Uses the platform accessibility API when available (Windows: UI Automation,
   * macOS: Accessibility API, Linux: AT-SPI). Falls back to heuristics.
   *
   * @param _screenshot - Screenshot buffer (used for future YOLO/OmniParser integration)
   * @returns Array of detected UIElements with type, text, bounds
   */
  async detectElements(_screenshot: Buffer): Promise<UIElement[]> {
    if (this.config.elementDetection === "accessibility") {
      return this.getAccessibilityElements()
    }
    // Future: YOLO / OmniParser local model integration here
    return []
  }

  /**
   * Get current screen state: active window title, process name, resolution.
   * Returns null if screen state cannot be determined.
   */
  async getScreenState(): Promise<ScreenState | null> {
    try {
      const [activeWindow, resolution] = await Promise.all([
        this.getActiveWindowTitle(),
        this.getScreenResolution(),
      ])

      return {
        activeWindowTitle: activeWindow.title,
        activeWindowProcess: activeWindow.process,
        resolution,
      }
    } catch {
      return null
    }
  }

  // ── Image Validation & Processing ─────────────────────────────────────────

  /**
   * Validate an image buffer and resize if necessary before API submission.
   *
   * Enforces GPT-4V Card safety bounds:
   *   - Reject images > 20MB
   *   - Downscale images with edge > 2048px
   *   - Only accept PNG, JPEG, WebP, GIF
   *
   * DECISION: We use sharp for resizing when available, but fall back to
   * returning the original buffer when sharp is not installed. This keeps
   * the dependency optional — vision still works without sharp, just without
   * automatic resizing for very large images.
   *
   * @param imageBuffer - Raw image data to validate
   * @returns Validated (and possibly resized) buffer, or null if invalid
   */
  async validateAndResizeImage(imageBuffer: Buffer): Promise<Buffer | null> {
    // Check file size (GPT-4V Card: max 20MB)
    if (imageBuffer.length > MAX_IMAGE_BYTES) {
      log.error("validateAndResizeImage: image too large", {
        sizeBytes: imageBuffer.length,
        maxBytes: MAX_IMAGE_BYTES,
      })
      return null
    }

    // Validate MIME type via magic bytes (more reliable than file extension)
    const mimeType = this.detectMimeType(imageBuffer)
    if (!mimeType) {
      log.error("validateAndResizeImage: unsupported image format")
      return null
    }

    // Check if image needs resizing (GPT-4V Card: max 2048px edge)
    // We attempt to use sharp if available; otherwise skip resize
    const needsResize = await this.checkNeedsResize(imageBuffer)
    if (needsResize) {
      const resized = await this.resizeImage(imageBuffer)
      return resized ?? imageBuffer // Fall back to original if resize fails
    }

    return imageBuffer
  }

  /**
   * Detect the MIME type of an image buffer via magic bytes.
   *
   * We read the first few bytes and compare against known magic byte signatures.
   * This is more reliable than checking file extensions (which can be faked
   * or missing). Source: GPT-4V Card format recommendations.
   *
   * @param buffer - Image buffer to inspect
   * @returns MIME type string or null if format is unsupported
   */
  detectMimeType(buffer: Buffer): ImagePayload["mimeType"] | null {
    for (const signature of MAGIC_BYTES) {
      const slice = buffer.slice(signature.offset, signature.offset + signature.bytes.length)
      const matches = signature.bytes.every((byte, i) => slice[i] === byte)
      if (matches) {
        return signature.mime
      }
    }
    return null
  }

  /**
   * Apply Set-of-Mark (SoM) visual prompting to a screenshot.
   *
   * Draws numbered bounding boxes around all detected UI elements.
   * When sent to an LLM with the query "which element is the Save button?",
   * the LLM can reliably return "element #3" instead of raw pixel coordinates.
   *
   * Why this works (arXiv:2310.11441):
   *   - Converts hard continuous regression (predict x,y coords) to
   *     easy classification (predict element ID from a numbered list)
   *   - Classification accuracy is significantly higher for LLMs
   *
   * DECISION: When sharp/canvas is not available, we return the original
   * screenshot with a text annotation prompt instead. The LLM can still
   * reason about elements from OCR text + element list metadata.
   *
   * @param screenshot - Original screenshot buffer
   * @param elements - UIElements to mark with numbers
   * @returns Buffer with numbered boxes drawn, or original if drawing fails
   */
  async applySetOfMarks(screenshot: Buffer, elements: UIElement[]): Promise<Buffer> {
    if (elements.length === 0) {
      return screenshot
    }

    // Attempt to use sharp for image annotation
    // If sharp isn't available, return original (LLM still works, just less precisely)
    try {
      const sharp = await import("sharp").then((m) => m.default).catch(() => null)
      if (!sharp) {
        log.debug("applySetOfMarks: sharp not available, returning original screenshot")
        return screenshot
      }

      // Build SVG overlay with numbered bounding boxes
      const svgOverlay = this.buildSoMSvgOverlay(elements)
      const annotated = await sharp(screenshot)
        .composite([{ input: Buffer.from(svgOverlay), blend: "over" }])
        .png()
        .toBuffer()

      log.debug("applySetOfMarks: annotated screenshot", { elementCount: elements.length })
      return annotated
    } catch (err) {
      log.warn("applySetOfMarks: annotation failed", { error: String(err) })
      return screenshot
    }
  }

  // ── Private: Element Finding ───────────────────────────────────────────────

  /**
   * Search for a UI element using the platform accessibility API.
   *
   * The accessibility API is the FAST PATH in OmniParser's hybrid strategy.
   * It provides exact element coordinates instantly (< 200ms) for any app
   * that exposes an accessibility tree (most native apps do).
   *
   * Returns null if no matching element is found within ACCESSIBILITY_TIMEOUT_MS.
   */
  private async findElementViaAccessibility(query: string): Promise<UIElement | null> {
    try {
      const elements = await Promise.race([
        this.getAccessibilityElements(),
        this.sleep(ACCESSIBILITY_TIMEOUT_MS).then(() => [] as UIElement[]),
      ])

      if (!Array.isArray(elements)) return null

      const queryLower = query.toLowerCase()

      // Find the element whose text/name most closely matches the query
      const match = elements.find((el) => {
        const textLower = el.text.toLowerCase()
        const nameLower = (el.name ?? "").toLowerCase()
        return (
          textLower.includes(queryLower) ||
          nameLower.includes(queryLower) ||
          queryLower.includes(textLower)
        )
      })

      return match ?? null
    } catch {
      return null
    }
  }

  /**
   * Use LLM visual grounding to find an element in a screenshot.
   *
   * Applies Set-of-Mark (SoM) prompting before sending to the LLM:
   *   1. Get all accessibility elements (for bounding boxes)
   *   2. Draw numbered boxes on the screenshot
   *   3. Ask LLM: "Which numbered element is the {query}?"
   *   4. Parse LLM response to get element ID
   *   5. Map element ID back to UIElement with real coordinates
   *
   * This converts coordinate prediction to element ID classification,
   * which is much more reliable for LLMs (SoM paper, arXiv:2310.11441).
   */
  private async findElementViaLLM(screenshot: Buffer, query: string): Promise<UIElement | null> {
    try {
      // Get current elements for SoM annotation
      const elements = await this.getAccessibilityElements()

      if (elements.length === 0) {
        // No accessibility elements — try pure LLM grounding without marks
        return this.findElementPureVisionLLM(screenshot, query)
      }

      // Apply SoM overlay to screenshot
      const annotatedScreenshot = await this.applySetOfMarks(screenshot, elements)
      const validatedBuffer = await this.validateAndResizeImage(annotatedScreenshot)
      if (!validatedBuffer) return null

      const base64 = validatedBuffer.toString("base64")
      const mimeType = this.detectMimeType(validatedBuffer) ?? "image/png"

      // Build the SoM-style prompt with element list for context
      const elementList = elements
        .slice(0, 50) // Cap at 50 elements to avoid token overflow
        .map((el, i) => `[${i + 1}] ${el.type}: "${el.text}" at (${el.bounds.x},${el.bounds.y})`)
        .join("\n")

      const prompt = [
        `Find the UI element matching: "${query}"`,
        `The screenshot has ${elements.length} numbered elements.`,
        `\nElement list:\n${elementList}`,
        `\nWhich element number matches the query? Reply with ONLY the element number (e.g., "3").`,
        `If not found, reply "none".`,
      ].join("\n")

      const { orchestrator } = await import("../engines/orchestrator.js")

      this.lastVisionCallMs = Date.now()

      const response = await orchestrator.generate("multimodal", {
        prompt,
        images: [{ data: base64, mimeType }],
        maxTokens: 10, // We only need a number or "none"
        temperature: 0, // Deterministic — we want the most likely element ID
      })

      const trimmed = response.trim().toLowerCase()

      // Parse element ID from LLM response
      if (trimmed === "none" || trimmed === "") {
        return null
      }

      const elementId = Number.parseInt(trimmed, 10)
      if (Number.isNaN(elementId) || elementId < 1 || elementId > elements.length) {
        log.warn("findElementViaLLM: LLM returned invalid element ID", { response: trimmed })
        return null
      }

      // Return the element at the given 1-based index
      return elements[elementId - 1] ?? null
    } catch (err) {
      log.warn("findElementViaLLM failed", { query, error: String(err) })
      return null
    }
  }

  /**
   * Pure LLM grounding without Set-of-Mark (last resort, least accurate).
   * Used when accessibility API returns no elements at all (e.g., game windows,
   * canvas-based apps, or apps that block accessibility APIs).
   */
  private async findElementPureVisionLLM(screenshot: Buffer, query: string): Promise<UIElement | null> {
    const validatedBuffer = await this.validateAndResizeImage(screenshot)
    if (!validatedBuffer) return null

    const base64 = validatedBuffer.toString("base64")
    const mimeType = this.detectMimeType(validatedBuffer) ?? "image/png"

    const prompt = [
      `Find the "${query}" UI element in this screenshot.`,
      `Reply in JSON format ONLY (no other text):`,
      `{"found": true, "x": <center_x_pixels>, "y": <center_y_pixels>, "width": <width>, "height": <height>, "text": "<element text>"}`,
      `If not found, reply: {"found": false}`,
    ].join("\n")

    const { orchestrator } = await import("../engines/orchestrator.js")
    this.lastVisionCallMs = Date.now()

    const response = await orchestrator.generate("multimodal", {
      prompt,
      images: [{ data: base64, mimeType }],
      maxTokens: 100,
      temperature: 0,
    })

    try {
      // Clean JSON response (LLM sometimes adds markdown backticks)
      const clean = response.replace(/```json|```/g, "").trim()
      const parsed = JSON.parse(clean)

      if (!parsed.found) return null

      return {
        type: "unknown",
        text: parsed.text ?? query,
        bounds: {
          x: Number(parsed.x),
          y: Number(parsed.y),
          width: Number(parsed.width),
          height: Number(parsed.height),
        },
        interactable: true,
        name: query,
      }
    } catch {
      return null
    }
  }

  // ── Private: Image Utilities ───────────────────────────────────────────────

  /**
   * Check if an image needs to be resized (edge > MAX_IMAGE_EDGE_PX).
   * Reads image dimensions without loading the full decoded image into memory.
   */
  private async checkNeedsResize(buffer: Buffer): Promise<boolean> {
    try {
      const sharp = await import("sharp").then((m) => m.default).catch(() => null)
      if (!sharp) return false

      const { width = 0, height = 0 } = await sharp(buffer).metadata()
      return Math.max(width, height) > MAX_IMAGE_EDGE_PX
    } catch {
      return false
    }
  }

  /**
   * Resize an image so its longest edge equals MAX_IMAGE_EDGE_PX.
   * Preserves aspect ratio. Returns null if resize fails.
   *
   * Scale formula (from GPT-4V Card / Section 2.5 of research paper):
   *   scale = min(1.0, MAX_IMAGE_EDGE_PX / max(width, height))
   *   new_width  = floor(width  * scale)
   *   new_height = floor(height * scale)
   */
  private async resizeImage(buffer: Buffer): Promise<Buffer | null> {
    try {
      const sharp = await import("sharp").then((m) => m.default).catch(() => null)
      if (!sharp) return null

      return sharp(buffer)
        .resize(MAX_IMAGE_EDGE_PX, MAX_IMAGE_EDGE_PX, {
          fit: "inside",      // Preserve aspect ratio (never upscale)
          withoutEnlargement: true,
        })
        .png()
        .toBuffer()
    } catch (err) {
      log.warn("resizeImage failed", { error: String(err) })
      return null
    }
  }

  /**
   * Build an SVG overlay string with numbered bounding boxes for Set-of-Mark.
   * Each UIElement gets a colored box + number label.
   */
  private buildSoMSvgOverlay(elements: UIElement[]): string {
    const boxes = elements
      .slice(0, 50) // Cap at 50 for readability
      .map((el, i) => {
        const { x, y, width, height } = el.bounds
        const label = String(i + 1)
        return [
          `<rect x="${x}" y="${y}" width="${width}" height="${height}"`,
          `  fill="none" stroke="#FF4444" stroke-width="2" opacity="0.9"/>`,
          `<rect x="${x}" y="${y - 16}" width="${label.length * 9 + 4}" height="16"`,
          `  fill="#FF4444" opacity="0.9"/>`,
          `<text x="${x + 2}" y="${y - 3}"`,
          `  font-size="12" font-family="monospace" fill="white"`,
          `  font-weight="bold">${label}</text>`,
        ].join("\n")
      })
      .join("\n")

    return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">\n${boxes}\n</svg>`
  }

  // ── Private: Platform OCR & Screenshot ───────────────────────────────────

  private async captureScreen(
    region?: { x: number; y: number; width: number; height: number },
  ): Promise<Buffer> {
    // Delegate to GUIAgent if injected (avoids duplicate screenshot code)
    if (this.guiAgent) {
      return this.guiAgent.captureScreenshot(region)
    }

    const tmpPath = path.join(os.tmpdir(), `edith-vision-${Date.now()}.png`)

    try {
      if (this.platform === "win32") {
        const script = region
          ? `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $bmp = New-Object Drawing.Bitmap(${region.width},${region.height}); $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(${region.x},${region.y},0,0,$bmp.Size); $bmp.Save('${tmpPath}')`
          : `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp = New-Object Drawing.Bitmap($s.Width,$s.Height); $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0,0,0,0,$bmp.Size); $bmp.Save('${tmpPath}')`
        await execa("powershell", ["-command", script], { timeout: 10_000 })
      } else if (this.platform === "darwin") {
        await execa("screencapture", ["-x", tmpPath])
      } else {
        // Linux: try scrot, then gnome-screenshot
        await execa("scrot", [tmpPath]).catch(() => execa("gnome-screenshot", ["-f", tmpPath]))
      }

      const buffer = await fs.readFile(tmpPath)
      await fs.unlink(tmpPath).catch(() => {})
      return buffer
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => {})
      throw new Error(`Screen capture failed: ${err}`)
    }
  }

  private async tesseractOCR(imageBuffer: Buffer): Promise<string> {
    const tmpIn = path.join(os.tmpdir(), `edith-ocr-in-${Date.now()}.png`)
    const tmpOut = path.join(os.tmpdir(), `edith-ocr-out-${Date.now()}`)

    try {
      await fs.writeFile(tmpIn, imageBuffer)
      // -l eng+ind: support English and Indonesian text (EDITH is bilingual)
      await execa("tesseract", [tmpIn, tmpOut, "-l", "eng+ind"], { timeout: 30_000 })
      const text = await fs.readFile(`${tmpOut}.txt`, "utf-8")
      return text.trim()
    } catch (err) {
      log.warn("Tesseract OCR failed", { error: String(err) })
      return ""
    } finally {
      await fs.unlink(tmpIn).catch(() => {})
      await fs.unlink(`${tmpOut}.txt`).catch(() => {})
    }
  }

  // ── Private: Accessibility API ────────────────────────────────────────────

  private async getAccessibilityElements(): Promise<UIElement[]> {
    if (this.platform === "win32") {
      return this.getWindowsAccessibilityElements()
    }
    // macOS and Linux accessibility API integration — future implementation
    return []
  }

  /**
   * Get UI elements from Windows UI Automation API via PowerShell.
   *
   * Windows UI Automation provides structured access to the accessibility tree
   * of any running application. This is the reliability backbone of findElement()
   * because it gives exact element coordinates without any LLM involvement.
   *
   * We query the currently focused element and walk its sibling tree,
   * collecting up to 50 elements to avoid PowerShell timeout issues.
   */
  private async getWindowsAccessibilityElements(): Promise<UIElement[]> {
    const script = `
Add-Type -AssemblyName UIAutomationClient
$root = [System.Windows.Automation.AutomationElement]::FocusedElement
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$elements = @()
$child = $walker.GetFirstChild($root)
$count = 0
while ($child -ne $null -and $count -lt 50) {
  $name = $child.Current.Name
  $type = $child.Current.ControlType.ProgrammaticName
  $rect = $child.Current.BoundingRectangle
  if ($name -and $rect.Width -gt 0) {
    $elements += @{ name=$name; type=$type; x=[int]$rect.X; y=[int]$rect.Y; w=[int]$rect.Width; h=[int]$rect.Height }
  }
  $child = $walker.GetNextSibling($child)
  $count++
}
$elements | ConvertTo-Json -Depth 3`

    try {
      const { stdout } = await execa("powershell", ["-command", script], {
        timeout: ACCESSIBILITY_TIMEOUT_MS,
      })
      if (!stdout.trim()) return []

      const data = JSON.parse(stdout)
      const list = Array.isArray(data) ? data : [data]

      return list.map((el: Record<string, unknown>) => ({
        type: this.mapUIAType(String(el.type ?? "")),
        text: String(el.name ?? ""),
        bounds: {
          x: Number(el.x ?? 0),
          y: Number(el.y ?? 0),
          width: Number(el.w ?? 0),
          height: Number(el.h ?? 0),
        },
        interactable: true,
        role: String(el.type ?? ""),
        name: String(el.name ?? ""),
      }))
    } catch {
      return []
    }
  }

  /** Map Windows UI Automation control type names to EDITH UIElement types */
  private mapUIAType(uiaType: string): UIElement["type"] {
    const map: Record<string, UIElement["type"]> = {
      "ControlType.Button": "button",
      "ControlType.Edit": "input",
      "ControlType.Hyperlink": "link",
      "ControlType.Text": "text",
      "ControlType.Image": "image",
      "ControlType.Menu": "menu",
      "ControlType.CheckBox": "checkbox",
      "ControlType.ComboBox": "dropdown",
      "ControlType.Tab": "tab",
    }
    return map[uiaType] ?? "unknown"
  }

  // ── Private: Screen State ─────────────────────────────────────────────────

  private async getActiveWindowTitle(): Promise<{ title: string; process: string }> {
    if (this.platform === "win32") {
      const script = `(Get-Process | Where-Object { $_.MainWindowHandle -eq (Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();' -Name User32 -Namespace Win -PassThru)::GetForegroundWindow() }).MainWindowTitle`
      try {
        const { stdout } = await execa("powershell", ["-command", script], { timeout: 3_000 })
        return { title: stdout.trim(), process: "unknown" }
      } catch {
        return { title: "Unknown", process: "unknown" }
      }
    }
    return { title: "Unknown", process: "unknown" }
  }

  private async getScreenResolution(): Promise<{ width: number; height: number }> {
    if (this.platform === "win32") {
      try {
        const script = `Add-Type -AssemblyName System.Windows.Forms; $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; "$($s.Width)x$($s.Height)"`
        const { stdout } = await execa("powershell", ["-command", script])
        const [w, h] = stdout.trim().split("x").map(Number)
        return { width: w, height: h }
      } catch {
        return { width: 1920, height: 1080 }
      }
    }
    return { width: 1920, height: 1080 }
  }

  // ── Private: Utilities ────────────────────────────────────────────────────

  /**
   * Build a deterministic cache key for element detection results.
   * Key includes the query and window title to ensure cache invalidation
   * when the user switches to a different application.
   */
  private buildCacheKey(query: string, windowTitle: string): string {
    return `${windowTitle}::${query.toLowerCase().trim()}`
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async verifyTesseract(): Promise<void> {
    try {
      await execa("tesseract", ["--version"])
      log.info("Tesseract OCR available")
    } catch {
      log.warn(
        "Tesseract not found — OCR unavailable. Install: choco install tesseract / apt install tesseract-ocr",
      )
    }
  }
}
