/**
 * @file context-collector.ts
 * @description Collects relevant editor context (active file, language, selection, symbols)
 *              to attach to EDITH gateway requests.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called synchronously by command handlers in extension.ts before forwarding
 *   requests to EdithClient. Uses only the `vscode` API — no async I/O needed.
 */

import * as vscode from "vscode"

/** Snapshot of the current editor state captured for an EDITH request. */
export interface EditorContext {
  /** Absolute path to the active file, or empty string if no file is open. */
  file: string
  /** VS Code language identifier, e.g. `"typescript"`, `"python"`. */
  language: string
  /** Currently selected text, or null if nothing is selected. */
  selection: string | null
  /** The entire text of the active document, or null if no document is open. */
  fullText: string | null
  /** Zero-based line number of the cursor (primary selection start). */
  cursorLine: number
  /** Zero-based column of the cursor. */
  cursorColumn: number
  /** Named symbols (functions, classes) visible in the current file. */
  symbols: string[]
  /** Import/require statements extracted from the current file. */
  imports: string[]
}

/**
 * Provides a synchronous snapshot of the active VS Code editor state.
 * All methods are static — no instance needed.
 */
export class ContextCollector {
  /**
   * Captures the current editor context.
   * @returns An `EditorContext` object; all fields are safe to serialise as JSON.
   */
  static collect(): EditorContext {
    const editor = vscode.window.activeTextEditor

    if (!editor) {
      return {
        file: "",
        language: "",
        selection: null,
        fullText: null,
        cursorLine: 0,
        cursorColumn: 0,
        symbols: [],
        imports: [],
      }
    }

    const doc = editor.document
    const sel = editor.selection
    const selectedText = sel.isEmpty ? null : doc.getText(sel)
    const fullText = doc.getText()

    return {
      file: doc.fileName,
      language: doc.languageId,
      selection: selectedText,
      fullText,
      cursorLine: sel.active.line,
      cursorColumn: sel.active.character,
      symbols: ContextCollector.extractSymbols(fullText, doc.languageId),
      imports: ContextCollector.extractImports(fullText, doc.languageId),
    }
  }

  /**
   * Extracts top-level function and class names from source text using simple regex.
   * This is a fast, dependency-free approximation — not a full AST parse.
   *
   * @param text - Full document text
   * @param language - VS Code language id
   * @returns Array of symbol name strings
   */
  static extractSymbols(text: string, language: string): string[] {
    const symbols: string[] = []

    if (["typescript", "javascript", "typescriptreact", "javascriptreact"].includes(language)) {
      // function declarations, arrow functions assigned to const, classes
      const patterns = [
        /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
        /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[:=].*(?:=>|function)/g,
        /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g,
      ]
      for (const pattern of patterns) {
        let match: RegExpExecArray | null
        while ((match = pattern.exec(text)) !== null) {
          if (match[1]) symbols.push(match[1])
        }
      }
    } else if (language === "python") {
      const patterns = [/^(?:async\s+)?def\s+(\w+)/gm, /^class\s+(\w+)/gm]
      for (const pattern of patterns) {
        let match: RegExpExecArray | null
        while ((match = pattern.exec(text)) !== null) {
          if (match[1]) symbols.push(match[1])
        }
      }
    }

    // Deduplicate while preserving order
    return [...new Set(symbols)]
  }

  /**
   * Extracts import / require paths from the document.
   * @param text - Full document text
   * @param language - VS Code language id
   * @returns Array of import path strings
   */
  static extractImports(text: string, language: string): string[] {
    const imports: string[] = []

    if (["typescript", "javascript", "typescriptreact", "javascriptreact"].includes(language)) {
      // ESM import statements
      const esm = /^import\s+.+\s+from\s+['"]([^'"]+)['"]/gm
      let match: RegExpExecArray | null
      while ((match = esm.exec(text)) !== null) {
        if (match[1]) imports.push(match[1])
      }
      // CommonJS require
      const cjs = /require\(['"]([^'"]+)['"]\)/g
      while ((match = cjs.exec(text)) !== null) {
        if (match[1]) imports.push(match[1])
      }
    } else if (language === "python") {
      const patterns = [/^import\s+(\S+)/gm, /^from\s+(\S+)\s+import/gm]
      for (const pattern of patterns) {
        let match: RegExpExecArray | null
        while ((match = pattern.exec(text)) !== null) {
          if (match[1]) imports.push(match[1])
        }
      }
    }

    return [...new Set(imports)]
  }
}
