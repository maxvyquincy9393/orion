/**
 * @file vault.ts
 * @description SecureVault — encrypted key-value secret store backed by
 * AES-256-GCM + scrypt. Stores secrets in a single encrypted JSON file, with
 * a companion plaintext meta file holding the salt and cipher parameters.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - `vault-crypto.ts` supplies all crypto primitives
 *   - `vault-resolver.ts` consumes this class to resolve `$vault:KEY` refs
 *   - `src/core/startup.ts` should call `vault.load()` on startup (passphrase
 *     sourced from OS keychain via `keychain.ts`, or prompted interactively)
 *   - Auto-locks after `config.VAULT_AUTO_LOCK_MS` of inactivity
 *   - Never throws plaintext secrets into logs
 *
 * SECURITY DECISIONS:
 *   - Master key wiped from memory (`Buffer.fill(0)`) on `lock()`
 *   - Each `get()`/`set()` resets the auto-lock timer
 *   - Vault file is rewritten atomically (temp → rename) to prevent partial writes
 *   - Meta file is plaintext (salt exposure is acceptable per scrypt security model)
 */

import { readFile, writeFile, rename, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { createLogger } from "../logger.js"
import config from "../config.js"
import {
  deriveKey,
  generateSalt,
  encrypt,
  decrypt,
  type EncryptedBlob,
  type VaultMeta,
} from "./vault-crypto.js"

const log = createLogger("security.vault")

// ── Types ──────────────────────────────────────────────────────────────────────

/** A single secret entry in the vault */
export interface VaultEntry {
  /** Secret key (name) */
  key: string
  /** Encrypted value — stored as UTF-8 string inside the encrypted blob */
  value: string
  /** Optional description */
  description?: string
  /** ISO timestamp of last update */
  updatedAt: string
  /** Optional tags for grouping */
  tags?: string[]
}

// ── SecureVault ───────────────────────────────────────────────────────────────

/**
 * Persistent encrypted key-value store. Must be unlocked with a passphrase
 * before any get/set operations are possible.
 *
 * Usage:
 * ```ts
 * await vault.unlock("my-passphrase")
 * await vault.set("OPENAI_KEY", "sk-...")
 * const key = await vault.get("OPENAI_KEY")  // returns "sk-..."
 * vault.lock()
 * ```
 */
export class SecureVault {
  private entries: Map<string, VaultEntry> = new Map()
  private masterKey: Buffer | null = null
  private meta: VaultMeta | null = null
  private autoLockHandle: ReturnType<typeof setTimeout> | null = null

  /** Resolved path to the encrypted vault file */
  private get vaultPath(): string {
    return resolve(config.VAULT_PATH)
  }

  /** Resolved path to the plaintext meta file */
  private get metaPath(): string {
    return `${this.vaultPath}.meta`
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Unlock the vault with `passphrase`. If no vault file exists yet,
   * a new one is initialised with a fresh salt.
   *
   * @param passphrase - Master passphrase (UTF-8)
   * @throws When the vault file exists but decryption fails (wrong passphrase)
   */
  async unlock(passphrase: string): Promise<void> {
    await this.ensureDir()

    if (existsSync(this.metaPath)) {
      // Load existing vault
      const raw = await readFile(this.metaPath, "utf8")
      this.meta = JSON.parse(raw) as VaultMeta
    } else {
      // Initialise new vault
      this.meta = { salt: generateSalt(), params: { N: 32768, r: 8, p: 1 }, version: 1 }
      await writeFile(this.metaPath, JSON.stringify(this.meta, null, 2) + "\n", "utf8")
    }

    this.masterKey = await deriveKey(passphrase, this.meta.salt)

    if (existsSync(this.vaultPath)) {
      await this.loadFromDisk()
    } else {
      this.entries = new Map()
      await this.saveToDisk()
    }

    this.resetAutoLock()
    log.info("vault unlocked", { entries: this.entries.size })
  }

  /**
   * Lock the vault and wipe the master key from memory.
   * All subsequent `get()`/`set()` calls will throw until `unlock()` is called again.
   */
  lock(): void {
    if (this.autoLockHandle) {
      clearTimeout(this.autoLockHandle)
      this.autoLockHandle = null
    }
    if (this.masterKey) {
      this.masterKey.fill(0)
      this.masterKey = null
    }
    this.entries.clear()
    this.meta = null
    log.info("vault locked")
  }

  /**
   * Whether the vault is currently unlocked.
   */
  isUnlocked(): boolean {
    return this.masterKey !== null
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  /**
   * Retrieve a secret by key.
   *
   * @param key - Secret name
   * @returns Secret value string, or `undefined` if not found
   * @throws When vault is locked
   */
  async get(key: string): Promise<string | undefined> {
    this.requireUnlocked()
    this.resetAutoLock()
    return this.entries.get(key)?.value
  }

  /**
   * Store or update a secret.
   *
   * @param key         - Secret name
   * @param value       - Secret value
   * @param description - Optional human-readable description
   * @param tags        - Optional classification tags
   * @throws When vault is locked
   */
  async set(
    key: string,
    value: string,
    description?: string,
    tags?: string[],
  ): Promise<void> {
    this.requireUnlocked()
    this.entries.set(key, {
      key,
      value,
      description,
      tags,
      updatedAt: new Date().toISOString(),
    })
    await this.saveToDisk()
    this.resetAutoLock()
    log.debug("vault.set", { key })
  }

  /**
   * Delete a secret by key.
   *
   * @param key - Secret name
   * @returns `true` if found and deleted, `false` if not found
   * @throws When vault is locked
   */
  async delete(key: string): Promise<boolean> {
    this.requireUnlocked()
    const existed = this.entries.delete(key)
    if (existed) await this.saveToDisk()
    this.resetAutoLock()
    return existed
  }

  /**
   * List all secret keys (without values).
   *
   * @returns Array of key names
   * @throws When vault is locked
   */
  async list(): Promise<string[]> {
    this.requireUnlocked()
    this.resetAutoLock()
    return Array.from(this.entries.keys())
  }

  /**
   * List all entries with metadata but WITHOUT values.
   *
   * @returns Array of entry metadata
   * @throws When vault is locked
   */
  async listMetadata(): Promise<Omit<VaultEntry, "value">[]> {
    this.requireUnlocked()
    this.resetAutoLock()
    return Array.from(this.entries.values()).map(({ key, description, tags, updatedAt }) => ({
      key,
      description,
      tags,
      updatedAt,
    }))
  }

  /**
   * Replace the master passphrase with a new one.
   * Re-encrypts the vault with a fresh salt.
   *
   * @param currentPassphrase - Must match the currently stored passphrase
   * @param newPassphrase     - New passphrase
   * @throws When vault is locked or `currentPassphrase` is wrong
   */
  async rotatePassphrase(currentPassphrase: string, newPassphrase: string): Promise<void> {
    // Re-verify by unlocking (will throw if wrong)
    const snapshot = new Map(this.entries)
    this.lock()
    await this.unlock(currentPassphrase)
    this.entries = snapshot

    // Generate new salt and key
    const newMeta: VaultMeta = { salt: generateSalt(), params: { N: 32768, r: 8, p: 1 }, version: 1 }
    const newKey = await deriveKey(newPassphrase, newMeta.salt)

    if (this.masterKey) this.masterKey.fill(0)
    this.masterKey = newKey
    this.meta = newMeta

    await writeFile(this.metaPath, JSON.stringify(newMeta, null, 2) + "\n", "utf8")
    await this.saveToDisk()
    log.info("vault passphrase rotated")
  }

  // ── Private Helpers ─────────────────────────────────────────────────────────

  /** Throw if the vault is locked */
  private requireUnlocked(): void {
    if (!this.masterKey) throw new Error("Vault is locked — call vault.unlock() first")
  }

  /** Load and decrypt entries from disk */
  private async loadFromDisk(): Promise<void> {
    const raw = await readFile(this.vaultPath, "utf8")
    const blob = JSON.parse(raw) as EncryptedBlob
    const plaintext = decrypt(blob, this.masterKey!)
    const loaded = JSON.parse(plaintext) as VaultEntry[]
    this.entries = new Map(loaded.map(e => [e.key, e]))
  }

  /** Encrypt and persist entries to disk (atomic write via temp file) */
  private async saveToDisk(): Promise<void> {
    const plaintext = JSON.stringify(Array.from(this.entries.values()), null, 2)
    const blob = encrypt(plaintext, this.masterKey!)
    const tmp = `${this.vaultPath}.tmp`
    await writeFile(tmp, JSON.stringify(blob, null, 2) + "\n", "utf8")
    await rename(tmp, this.vaultPath)
  }

  /** Ensure the directory for the vault file exists */
  private async ensureDir(): Promise<void> {
    const dir = dirname(this.vaultPath)
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
  }

  /** Reset the auto-lock countdown */
  private resetAutoLock(): void {
    if (this.autoLockHandle) clearTimeout(this.autoLockHandle)
    if (config.VAULT_AUTO_LOCK_MS > 0) {
      this.autoLockHandle = setTimeout(() => {
        log.info("vault auto-locked due to inactivity")
        this.lock()
      }, config.VAULT_AUTO_LOCK_MS)
      // Don't prevent Node.js from exiting due to this timer
      if (this.autoLockHandle.unref) this.autoLockHandle.unref()
    }
  }
}

/** Singleton vault instance */
export const vault = new SecureVault()
