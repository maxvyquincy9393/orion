/**
 * @file keychain.ts
 * @description OS keychain bridge via dynamic `keytar` import.
 * Stores and retrieves the vault passphrase from the platform keychain
 * (macOS Keychain, Windows Credential Manager, Linux Secret Service).
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Called by `src/core/startup.ts` to retrieve the vault passphrase at boot
 *   - `keytar` is an optional peer dependency — falls back gracefully when absent
 *   - Service name: "edith-ai" (configurable)
 *   - Account name: `userId` or `"default"` for single-user setups
 *
 * SECURITY:
 *   - If `keytar` is not installed the caller is responsible for prompting the
 *     user (e.g. CLI prompt or gateway API call)
 *   - Never logs the passphrase — only success/failure status
 */

import { createLogger } from "../logger.js"

const log = createLogger("security.keychain")

/** Keychain service name — identifies this application in the OS keychain */
const SERVICE_NAME = "edith-ai"

// ── Types ──────────────────────────────────────────────────────────────────────

/** Interface that matches the `keytar` module surface we actually use */
interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>
  setPassword(service: string, account: string, password: string): Promise<void>
  deletePassword(service: string, account: string): Promise<boolean>
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>
}

// ── KeychainBridge ────────────────────────────────────────────────────────────

/**
 * Thin wrapper around `keytar` with graceful degradation.
 * All methods return `null` / `false` when `keytar` is unavailable
 * rather than throwing.
 */
export class KeychainBridge {
  private keytar: KeytarLike | null = null
  private loaded = false

  /**
   * Dynamically load `keytar`. Called lazily on first use.
   * Silent no-op if the package is not installed.
   */
  private async loadKeytar(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      // Dynamic import so that startup doesn't fail if keytar isn't installed
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error optional peer dep — no type declarations bundled
      this.keytar = (await import("keytar")) as KeytarLike
      log.debug("keytar loaded")
    } catch {
      log.warn("keytar not available — OS keychain support disabled")
      this.keytar = null
    }
  }

  /**
   * Retrieve the vault passphrase for `account` from the OS keychain.
   *
   * @param account - Account name (default: "default")
   * @returns Passphrase string, or `null` if not found or keytar unavailable
   */
  async getPassphrase(account = "default"): Promise<string | null> {
    await this.loadKeytar()
    if (!this.keytar) return null
    try {
      return await this.keytar.getPassword(SERVICE_NAME, account)
    } catch (err) {
      log.warn("keychain.getPassphrase failed", { account, err })
      return null
    }
  }

  /**
   * Store the vault passphrase in the OS keychain.
   *
   * @param passphrase - Passphrase to store
   * @param account    - Account name (default: "default")
   * @returns `true` on success, `false` if keytar unavailable or error
   */
  async storePassphrase(passphrase: string, account = "default"): Promise<boolean> {
    await this.loadKeytar()
    if (!this.keytar) return false
    try {
      await this.keytar.setPassword(SERVICE_NAME, account, passphrase)
      log.info("passphrase stored in keychain", { account })
      return true
    } catch (err) {
      log.warn("keychain.storePassphrase failed", { account, err })
      return false
    }
  }

  /**
   * Delete the vault passphrase from the OS keychain.
   *
   * @param account - Account name (default: "default")
   * @returns `true` if deleted, `false` if not found or keytar unavailable
   */
  async deletePassphrase(account = "default"): Promise<boolean> {
    await this.loadKeytar()
    if (!this.keytar) return false
    try {
      return await this.keytar.deletePassword(SERVICE_NAME, account)
    } catch (err) {
      log.warn("keychain.deletePassphrase failed", { account, err })
      return false
    }
  }

  /**
   * List all accounts with stored passphrases (for multi-user setups).
   *
   * @returns Array of account names, or empty array if keytar unavailable
   */
  async listAccounts(): Promise<string[]> {
    await this.loadKeytar()
    if (!this.keytar) return []
    try {
      const creds = await this.keytar.findCredentials(SERVICE_NAME)
      return creds.map(c => c.account)
    } catch (err) {
      log.warn("keychain.listAccounts failed", { err })
      return []
    }
  }

  /**
   * Whether the OS keychain is available on this platform.
   */
  async isAvailable(): Promise<boolean> {
    await this.loadKeytar()
    return this.keytar !== null
  }
}

/** Singleton keychain bridge */
export const keychain = new KeychainBridge()
