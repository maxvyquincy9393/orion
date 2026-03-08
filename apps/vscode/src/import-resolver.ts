/**
 * @file import-resolver.ts
 * @description Resolves and normalises import paths from the active VS Code document.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Consumed by context-collector.ts and command handlers that need to understand
 *   a file's dependency graph before sending context to the EDITH gateway.
 *   Uses only the synchronous VS Code TextDocument API — no file I/O.
 */

import * as vscode from "vscode"
import * as path from "path"

/** A single resolved import entry. */
export interface ResolvedImport {
  /** Raw import specifier as written in source. */
  raw: string
  /** Absolute file path if resolvable, otherwise null. */
  resolved: string | null
  /** Whether the import points to a node_modules package. */
  isExternal: boolean
  /** Whether the import is relative (starts with `.` or `..`). */
  isRelative: boolean
}

/**
 * Extracts and classifies import / require statements from a VS Code TextDocument.
 * All operations are synchronous and purely text-based.
 */
export class ImportResolver {
  /**
   * Resolves all imports in the given document.
   * @param document - VS Code text document to analyse
   * @returns Array of resolved import descriptors
   */
  static resolve(document: vscode.TextDocument): ResolvedImport[] {
    const text = document.getText()
    const language = document.languageId
    const fileDir = path.dirname(document.fileName)

    const rawImports = ImportResolver.extract(text, language)
    return rawImports.map(raw => ImportResolver.classify(raw, fileDir))
  }

  /**
   * Extracts raw import path strings from source text.
   * @param text - Full document source
   * @param language - VS Code language identifier
   * @returns Deduplicated array of raw specifier strings
   */
  static extract(text: string, language: string): string[] {
    const results = new Set<string>()

    if (["typescript", "javascript", "typescriptreact", "javascriptreact"].includes(language)) {
      // ESM: import X from 'path', import { X } from 'path', import 'path'
      const esm = /^import\s+(?:.+\s+from\s+)?['"]([^'"]+)['"]/gm
      let m: RegExpExecArray | null
      while ((m = esm.exec(text)) !== null) {
        if (m[1]) results.add(m[1])
      }
      // Dynamic: import('path')
      const dynamic = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
      while ((m = dynamic.exec(text)) !== null) {
        if (m[1]) results.add(m[1])
      }
      // CJS: require('path')
      const cjs = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
      while ((m = cjs.exec(text)) !== null) {
        if (m[1]) results.add(m[1])
      }
    } else if (language === "python") {
      // import X, import X.Y
      const imp = /^import\s+(\S+)/gm
      let m: RegExpExecArray | null
      while ((m = imp.exec(text)) !== null) {
        if (m[1]) results.add(m[1])
      }
      // from X import Y
      const frm = /^from\s+(\S+)\s+import/gm
      while ((m = frm.exec(text)) !== null) {
        if (m[1]) results.add(m[1])
      }
    }

    return [...results]
  }

  /**
   * Classifies a raw import specifier as external or local, and attempts
   * to resolve relative imports to filesystem paths.
   * @param raw - Import specifier string
   * @param fileDir - Directory of the file containing the import
   * @returns ResolvedImport descriptor
   */
  static classify(raw: string, fileDir: string): ResolvedImport {
    const isRelative = raw.startsWith(".") || raw.startsWith("/")
    // Node built-ins and scoped packages are treated as external
    const isExternal =
      !isRelative &&
      !raw.startsWith("/") &&
      (raw.startsWith("node:") ||
        /^[a-z@]/.test(raw))

    let resolved: string | null = null
    if (isRelative) {
      // Best-effort: strip query/hash and resolve relative path
      const cleanRaw = raw.split("?")[0].split("#")[0]
      resolved = path.resolve(fileDir, cleanRaw)
      // If no extension, the file system check must be done elsewhere
    }

    return { raw, resolved, isExternal, isRelative }
  }

  /**
   * Returns only the external (node_modules) imports from the document.
   * Useful for sending package dependency context to EDITH.
   * @param document - VS Code text document
   * @returns Array of external package specifiers
   */
  static externalPackages(document: vscode.TextDocument): string[] {
    return ImportResolver.resolve(document)
      .filter(imp => imp.isExternal)
      .map(imp => imp.raw)
  }

  /**
   * Returns only the local relative imports from the document.
   * @param document - VS Code text document
   * @returns Array of resolved local paths (absolute, best-effort)
   */
  static localFiles(document: vscode.TextDocument): string[] {
    return ImportResolver.resolve(document)
      .filter(imp => imp.isRelative && imp.resolved !== null)
      .map(imp => imp.resolved as string)
  }
}
