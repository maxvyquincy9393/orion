/**
 * @file sync-scheduler.ts
 * @description Per-connector sync scheduler with configurable intervals.
 *
 * ARCHITECTURE:
 *   Manages lifecycle of all knowledge-base connectors (Obsidian, Notion, Bookmarks).
 *   Called by startup.ts when KNOWLEDGE_BASE_ENABLED is true.
 *   Also exposes a tick() method for the background daemon.
 *
 * @module memory/knowledge/sync-scheduler
 */

import { createLogger } from "../../logger.js"
import { type EDITHConfig } from "../../config/edith-config.js"
import { obsidianConnector } from "./connectors/obsidian.js"
import { notionConnector } from "./connectors/notion.js"
import { bookmarkConnector } from "./connectors/bookmarks.js"

const log = createLogger("memory.knowledge.sync-scheduler")

/**
 * Per-connector sync scheduler.
 * Starts all enabled connectors and schedules periodic syncs.
 */
export class SyncScheduler {
  /** Active interval handles for periodic syncs. */
  private intervals: NodeJS.Timeout[] = []

  /** User ID bound to this scheduler instance. */
  private userId: string | null = null

  /** Current knowledge base config. */
  private kbConfig: EDITHConfig["knowledgeBase"] | null = null

  /**
   * Start all enabled connectors based on the provided knowledge base config.
   *
   * @param config - EDITHConfig.knowledgeBase section
   * @param userId - User identifier for all ingest operations
   */
  start(config: EDITHConfig["knowledgeBase"], userId: string): void {
    this.userId = userId
    this.kbConfig = config

    if (!config.enabled) {
      log.debug("knowledge base disabled — skipping connector start")
      return
    }

    // Obsidian vault connector
    if (config.obsidian.enabled && config.obsidian.vaultPath) {
      void obsidianConnector.start(config.obsidian.vaultPath, userId)
        .catch((err) => log.warn("obsidian connector start failed", { err }))

      const obsidianInterval = setInterval(() => {
        void obsidianConnector.fullSync(config.obsidian.vaultPath, userId)
          .then((r) => log.debug("obsidian periodic sync", r))
          .catch((err) => log.warn("obsidian periodic sync failed", { err }))
      }, config.obsidian.syncIntervalMs)
      this.intervals.push(obsidianInterval)
      log.info("obsidian connector started", { vaultPath: config.obsidian.vaultPath })
    }

    // Notion connector — periodic sync only (no file watcher)
    if (config.notion.enabled && config.notion.databaseIds.length > 0) {
      const notionInterval = setInterval(() => {
        void notionConnector.sync(config.notion.databaseIds, userId)
          .then((r) => log.debug("notion periodic sync", r))
          .catch((err) => log.warn("notion periodic sync failed", { err }))
      }, config.notion.syncIntervalMs)
      this.intervals.push(notionInterval)
      log.info("notion connector started", { databases: config.notion.databaseIds.length })
    }

    // Bookmark connector — one-shot on startup
    if (config.bookmarks.enabled && config.bookmarks.jsonPath) {
      void bookmarkConnector.ingestFromFile(config.bookmarks.jsonPath, userId)
        .then((r) => log.info("bookmark ingest complete", r))
        .catch((err) => log.warn("bookmark ingest failed", { err }))
    }
  }

  /**
   * Stop all active watchers and periodic sync intervals.
   */
  stop(): void {
    for (const interval of this.intervals) {
      clearInterval(interval)
    }
    this.intervals = []
    obsidianConnector.stop()
    log.info("sync scheduler stopped")
  }

  /**
   * Tick handler for the background daemon.
   * Triggers an immediate Notion sync if configured.
   */
  async tick(): Promise<void> {
    if (!this.userId || !this.kbConfig?.enabled) {
      return
    }

    if (this.kbConfig.notion.enabled && this.kbConfig.notion.databaseIds.length > 0) {
      await notionConnector.sync(this.kbConfig.notion.databaseIds, this.userId)
        .then((r) => log.debug("daemon tick: notion sync", r))
        .catch((err) => log.warn("daemon tick: notion sync failed", { err }))
    }
  }
}

/** Singleton SyncScheduler instance. */
export const syncScheduler = new SyncScheduler()
