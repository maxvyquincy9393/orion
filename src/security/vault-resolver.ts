/**
 * @file vault-resolver.ts
 * @description Resolves `$vault:KEY` reference strings by fetching values
 * from the SecureVault. Used to allow config values to reference secrets
 * without embedding them in plaintext config files.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Consumed by `src/core/startup.ts` and any module that accepts user-facing
 *     configuration that might contain vault references
 *   - Requires the vault to be unlocked first; returns the placeholder string
 *     unchanged if the vault is locked (safe fallback)
 *
 * USAGE:
 *   ```ts
 *   // In .env or edith.json:
 *   OPENAI_API_KEY=$vault:OPENAI_KEY
 *
 *   // At startup:
 *   const resolved = await resolveVaultRef(process.env.OPENAI_API_KEY)
 *   // → "sk-abc123..."
 *   ```
 */

import { createLogger } from "../logger.js"
import { vault } from "./vault.js"

const log = createLogger("security.vault-resolver")

/** Prefix that marks a value as a vault reference */
const VAULT_PREFIX = "$vault:" as const

/**
 * Resolve a single value. If it starts with `$vault:`, the remainder is
 * treated as the vault key. If the vault is locked or the key is not found,
 * the original string is returned and a warning is logged.
 *
 * @param value - Raw config value (may or may not be a vault reference)
 * @returns Resolved secret string, or the original value if not a vault ref
 */
export async function resolveVaultRef(value: string): Promise<string> {
  if (!value.startsWith(VAULT_PREFIX)) return value

  const vaultKey = value.slice(VAULT_PREFIX.length)

  if (!vault.isUnlocked()) {
    log.warn("vault is locked — cannot resolve vault ref, returning placeholder", { vaultKey })
    return value
  }

  const secret = await vault.get(vaultKey)
  if (secret === undefined) {
    log.warn("vault ref not found", { vaultKey })
    return value
  }

  log.debug("vault ref resolved", { vaultKey })
  return secret
}

/**
 * Recursively resolve all `$vault:KEY` references in a string-valued record.
 * Non-string values are left untouched; nested objects are NOT traversed
 * (use `resolveAllDeep` for that).
 *
 * @param obj - Key-value map (e.g. `process.env` subset)
 * @returns New object with all vault refs resolved
 */
export async function resolveAll(
  obj: Record<string, string | undefined>,
): Promise<Record<string, string | undefined>> {
  const result: Record<string, string | undefined> = {}
  await Promise.all(
    Object.entries(obj).map(async ([k, v]) => {
      result[k] = v ? await resolveVaultRef(v) : v
    }),
  )
  return result
}

/**
 * Check whether a value is a vault reference.
 *
 * @param value - String to check
 */
export function isVaultRef(value: string): boolean {
  return value.startsWith(VAULT_PREFIX)
}

/**
 * Extract the vault key from a vault reference string.
 * Returns `null` if the value is not a vault reference.
 *
 * @param value - String like `$vault:MY_KEY`
 */
export function extractVaultKey(value: string): string | null {
  if (!isVaultRef(value)) return null
  return value.slice(VAULT_PREFIX.length)
}
