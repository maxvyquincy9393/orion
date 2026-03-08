/**
 * @file format-handlers.ts
 * @description Format-specific parsers for DOCX, HTML, images (OCR optional).
 *
 * ARCHITECTURE:
 *   Called by RAGEngine.ingestFile() based on file extension.
 *   Returns ParsedDocument with text + section structure.
 *   RAGEngine owns chunking and saving — handlers only parse.
 *
 * PAPER BASIS:
 *   - Contextual Retrieval (Anthropic, Sep 2024): context prefix per chunk
 *   - HippoRAG (arXiv:2405.14831): entity-rich text preservation
 *
 * @module memory/knowledge/format-handlers
 */

import fs from "node:fs/promises"
import path from "node:path"

import { createLogger } from "../../logger.js"

const log = createLogger("memory.knowledge.format-handlers")

/** A structural section within a document. */
export interface DocumentSection {
  /** Section heading if present. */
  heading?: string
  /** Text content of this section. */
  content: string
  /** Page number (1-indexed) if available. */
  page?: number
  /** Heading depth level (1 = h1, 2 = h2, etc.). */
  level: number
}

/** The parsed output of a document file. */
export interface ParsedDocument {
  /** Full plain text of the document. */
  text: string
  /** Document title (usually derived from filename or first heading). */
  title: string
  /** Structural sections for hierarchical chunking. */
  structure: DocumentSection[]
  /** Document-level metadata. */
  metadata: {
    /** Number of pages (if applicable). */
    pageCount?: number
    /** Approximate word count. */
    wordCount: number
  }
}

/**
 * Parse a DOCX file using mammoth (optional dependency).
 * Returns null if mammoth is not installed or the file cannot be read.
 *
 * @param filePath - Absolute path to the .docx file
 * @returns Parsed document or null on failure
 */
export async function parseDocx(filePath: string): Promise<ParsedDocument | null> {
  try {
    // Dynamic import so the dependency is optional.
    // Using a variable to prevent TypeScript from statically resolving the optional module.
    const modName = "mammoth"
    const mammoth = await (import(/* webpackIgnore: true */ modName) as Promise<unknown>).catch(() => null)
    if (!mammoth) {
      log.warn("mammoth not installed — DOCX parsing unavailable", { filePath })
      return null
    }

    const m = mammoth as { convertToHtml: (opts: { path: string }) => Promise<{ value: string }> }
    const result = await m.convertToHtml({ path: filePath })
    const html = result.value

    // Extract sections from HTML headings
    const structure = extractHtmlSections(html)
    const text = html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()

    return {
      text,
      title: path.basename(filePath, path.extname(filePath)),
      structure,
      metadata: {
        wordCount: text.split(/\s+/).filter(Boolean).length,
      },
    }
  } catch (err) {
    log.warn("parseDocx failed", { filePath, err })
    return null
  }
}

/**
 * Parse an HTML file, stripping non-content tags and extracting heading structure.
 *
 * @param filePath - Absolute path to the .html or .htm file
 * @returns Parsed document or null on failure
 */
export async function parseHtml(filePath: string): Promise<ParsedDocument | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8")

    // Strip non-content tags
    const cleaned = raw
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")

    const structure = extractHtmlSections(cleaned)
    const text = cleaned
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()

    // Try to extract title from <title> tag
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    const title = titleMatch
      ? titleMatch[1].trim()
      : path.basename(filePath, path.extname(filePath))

    return {
      text,
      title,
      structure,
      metadata: {
        wordCount: text.split(/\s+/).filter(Boolean).length,
      },
    }
  } catch (err) {
    log.warn("parseHtml failed", { filePath, err })
    return null
  }
}

/**
 * Extract text from an image file via OCR using tesseract.js (optional dependency).
 * Returns null if tesseract.js is not installed or OCR fails.
 *
 * @param filePath - Absolute path to an image file
 * @returns Parsed document or null on failure
 */
export async function parseImage(filePath: string): Promise<ParsedDocument | null> {
  try {
    // Dynamic import so the dependency is optional.
    // Using a variable to prevent TypeScript from statically resolving the optional module.
    const tesseractMod = "tesseract.js"
    const tesseract = await (import(/* webpackIgnore: true */ tesseractMod) as Promise<unknown>).catch(() => null)
    if (!tesseract) {
      log.warn("tesseract.js not installed — OCR unavailable", { filePath })
      return null
    }

    const t = tesseract as {
      createWorker: (lang: string) => Promise<{
        recognize: (path: string) => Promise<{ data: { text: string } }>
        terminate: () => Promise<void>
      }>
    }
    const worker = await t.createWorker("eng")
    const { data } = await worker.recognize(filePath)
    await worker.terminate()

    const text = data.text.trim()
    if (!text) {
      return null
    }

    return {
      text,
      title: path.basename(filePath, path.extname(filePath)),
      structure: [{ content: text, level: 0 }],
      metadata: {
        wordCount: text.split(/\s+/).filter(Boolean).length,
      },
    }
  } catch (err) {
    log.warn("parseImage failed", { filePath, err })
    return null
  }
}

/**
 * Dispatch file parsing to the appropriate handler based on extension.
 * Falls back to plain-text reading for .txt, .md, .json.
 *
 * @param filePath - Absolute path to the file
 * @returns ParsedDocument or null if unsupported / failed
 */
export async function parseFile(filePath: string): Promise<ParsedDocument | null> {
  const ext = path.extname(filePath).toLowerCase()

  switch (ext) {
    case ".docx":
      return parseDocx(filePath)

    case ".html":
    case ".htm":
      return parseHtml(filePath)

    case ".png":
    case ".jpg":
    case ".jpeg":
      return parseImage(filePath)

    case ".txt":
    case ".md":
    case ".json": {
      try {
        const text = await fs.readFile(filePath, "utf-8")
        if (!text.trim()) {
          return null
        }
        const structure = parsePlainTextSections(text, ext)
        return {
          text,
          title: path.basename(filePath, ext),
          structure,
          metadata: {
            wordCount: text.split(/\s+/).filter(Boolean).length,
          },
        }
      } catch (err) {
        log.warn("plain text read failed", { filePath, err })
        return null
      }
    }

    default:
      log.warn("unsupported file extension", { filePath, ext })
      return null
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Extract heading-based sections from an HTML string.
 * Looks for h1–h3 tags and groups following content under each heading.
 *
 * @param html - Raw HTML string
 * @returns Array of DocumentSection
 */
function extractHtmlSections(html: string): DocumentSection[] {
  const sections: DocumentSection[] = []
  const headingRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h[1-3]>/gi
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = headingRe.exec(html)) !== null) {
    const level = parseInt(match[1], 10)
    const heading = match[2].replace(/<[^>]+>/g, "").trim()

    // Content before this heading (if any) belongs to the previous section or root
    const before = html.slice(lastIndex, match.index)
    const beforeText = before.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    if (beforeText) {
      sections.push({ content: beforeText, level: 0 })
    }

    lastIndex = match.index + match[0].length
    sections.push({ heading, content: "", level })
  }

  // Remaining content after last heading
  const remaining = html.slice(lastIndex).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  if (remaining) {
    const last = sections[sections.length - 1]
    if (last && !last.content) {
      last.content = remaining
    } else {
      sections.push({ content: remaining, level: 0 })
    }
  }

  // If no headings found, treat as single section
  if (sections.length === 0) {
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    if (text) sections.push({ content: text, level: 0 })
  }

  return sections
}

/**
 * Parse plain text or Markdown into coarse sections based on heading patterns.
 *
 * @param text - Raw file content
 * @param ext  - File extension (.md, .txt, .json)
 * @returns Array of DocumentSection
 */
function parsePlainTextSections(text: string, ext: string): DocumentSection[] {
  if (ext !== ".md") {
    return [{ content: text, level: 0 }]
  }

  const sections: DocumentSection[] = []
  const lines = text.split("\n")
  let currentHeading: string | undefined
  let currentLevel = 0
  let buffer: string[] = []

  for (const line of lines) {
    const h = line.match(/^(#{1,3})\s+(.+)/)
    if (h) {
      if (buffer.length > 0) {
        sections.push({ heading: currentHeading, content: buffer.join("\n").trim(), level: currentLevel })
        buffer = []
      }
      currentHeading = h[2].trim()
      currentLevel = h[1].length
    } else {
      buffer.push(line)
    }
  }

  if (buffer.length > 0) {
    sections.push({ heading: currentHeading, content: buffer.join("\n").trim(), level: currentLevel })
  }

  if (sections.length === 0) {
    sections.push({ content: text, level: 0 })
  }

  return sections
}
