/**
 * @file obsidian.ts
 * @description Obsidian vault connector — filesystem watcher for .md files.
 *
 * ARCHITECTURE:
 *   Watches an Obsidian vault directory for .md file changes and ingests them
 *   into the RAG engine. Uses fs.watch for native file watching.
 *
 * @module memory/knowledge/connectors/obsidian
 */

import fs from "node:fs"
import fsAsync from "node:fs/promises"
import path from "node:path"

import { createLogger } from "../../../logger.js"
import { rag } from "../../rag.js"

const log = createLogger("memory.knowledge.connectors.obsidian")

/** Result of a full-sync operation. */
export interface SyncResult {
  /** Number of files successfully indexed. */
  indexed: number
  /** Number of files that failed to index. */
  failed: number
}

/**
 * Obsidian vault connector.
 * Watches a vault directory for .md file changes and re-ingests changed files.
 */
export class ObsidianConnector {
  /** Active fs.FSWatcher instances keyed by vault path. */
  private watchers = new Map<string, fs.FSWatcher>()

  /**
   * Start watching an Obsidian vault for .md file changes.
   * Performs a full sync on startup, then watches for incremental changes.
   *
   * @param vaultPath - Absolute path to the Obsidian vault directory
   * @param userId    - User identifier for memory storage
   */
  async start(vaultPath: string, userId: string): Promise<void> {
    try {
      await fsAsync.access(vaultPath)
    } catch {
      log.warn("vault path does not exist", { vaultPath })
      return
    }

    log.info("starting Obsidian vault sync", { vaultPath })
    const result = await this.fullSync(vaultPath, userId)
    log.info("initial vault sync complete", { ...result, vaultPath })

    // Watch for file changes
    if (!this.watchers.has(vaultPath)) {
      const watcher = fs.watch(vaultPath, { recursive: true }, (_eventType, filename) => {
        if (filename && filename.endsWith(".md")) {
          const filePath = path.join(vaultPath, filename)
          void this.handleFileChange(filePath, userId)
        }
      })
      this.watchers.set(vaultPath, watcher)
    }
  }

  /**
   * Stop all vault watchers.
   */
  stop(): void {
    for (const [vaultPath, watcher] of this.watchers) {
      watcher.close()
      log.debug("stopped vault watcher", { vaultPath })
    }
    this.watchers.clear()
  }

  /**
   * Walk the vault directory and ingest all .md files.
   *
   * @param vaultPath - Absolute path to the vault
   * @param userId    - User identifier
   * @returns Sync result counts
   */
  async fullSync(vaultPath: string, userId: string): Promise<SyncResult> {
    const result: SyncResult = { indexed: 0, failed: 0 }

    const mdFiles = await this.walkDir(vaultPath, ".md")
    for (const filePath of mdFiles) {
      const docId = await rag.ingestFile(userId, filePath)
      if (docId) {
        result.indexed++
      } else {
        result.failed++
      }
    }

    return result
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Re-ingest a file when it changes. Silently ignores ENOENT (deleted files).
   *
   * @param filePath - Absolute path to the changed file
   * @param userId   - User identifier
   */
  private async handleFileChange(filePath: string, userId: string): Promise<void> {
    try {
      await fsAsync.access(filePath)
      const docId = await rag.ingestFile(userId, filePath)
      if (docId) {
        log.debug("file re-indexed", { filePath })
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== "ENOENT") {
        log.warn("file change re-index failed", { filePath, err })
      }
    }
  }

  /**
   * Recursively walk a directory and return files with the given extension.
   *
   * @param dir - Directory to walk
   * @param ext - File extension to match (e.g. ".md")
   * @returns Array of absolute file paths
   */
  private async walkDir(dir: string, ext: string): Promise<string[]> {
    const results: string[] = []

    let entries: string[]
    try {
      entries = await fsAsync.readdir(dir)
    } catch {
      return results
    }

    for (const entry of entries) {
      if (entry.startsWith(".")) continue // skip hidden dirs like .obsidian
      const fullPath = path.join(dir, entry)
      let stat: fs.Stats
      try {
        stat = await fsAsync.stat(fullPath)
      } catch {
        continue
      }

      if (stat.isDirectory()) {
        const sub = await this.walkDir(fullPath, ext)
        results.push(...sub)
      } else if (fullPath.endsWith(ext)) {
        results.push(fullPath)
      }
    }

    return results
  }
}

/** Singleton ObsidianConnector instance. */
export const obsidianConnector = new ObsidianConnector()
