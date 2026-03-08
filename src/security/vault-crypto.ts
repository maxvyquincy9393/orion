/**
 * @file vault-crypto.ts
 * @description Low-level AES-256-GCM encryption helpers and scrypt key derivation
 * for the EDITH secrets vault.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Used exclusively by `vault.ts`. All crypto primitives live here so they
 *   can be tested in isolation without touching the filesystem.
 *
 * SECURITY DECISIONS:
 *   - AES-256-GCM for authenticated encryption (integrity + secrecy in one pass)
 *   - scrypt for KDF: memory-hard, GPU-resistant, standardised in Node.js crypto
 *   - 32-byte random salt stored plaintext alongside encrypted data (safe by design)
 *   - 12-byte random IV per encryption (GCM recommendation)
 *   - 16-byte GCM auth tag validates ciphertext integrity before decryption
 *   - Keys wiped with `Buffer.fill(0)` after use when possible
 *
 * PAPER BASIS:
 *   - NIST SP 800-132: PBKDF guidelines (iterations, salt, key derivation)
 *   - OWASP ASVS v4.0 §9.2: Authenticated encryption requirements
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scrypt as _scrypt,
} from "node:crypto"
import { promisify } from "node:util"

const scrypt = promisify(_scrypt) as (
  password: Buffer | string,
  salt: Buffer | string,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>

// ── Constants ─────────────────────────────────────────────────────────────────

/** scrypt parameters — NIST SP 800-132 compliant */
export const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1 } as const // ~100ms on modern CPU

/** AES-GCM IV length (12 bytes is NIST recommended for GCM) */
export const AES_IV_LENGTH = 12

/** AES-GCM auth tag length */
export const AES_TAG_LENGTH = 16

/** Derived key length for AES-256 */
export const KEY_LENGTH = 32

/** Salt length for scrypt */
export const SALT_LENGTH = 32

// ── Types ─────────────────────────────────────────────────────────────────────

/** Encrypted blob structure — all fields are hex-encoded strings for JSON storage */
export interface EncryptedBlob {
  /** IV (12 bytes hex) */
  iv: string
  /** GCM auth tag (16 bytes hex) */
  tag: string
  /** Ciphertext (hex) */
  data: string
}

/** Vault metadata stored in plaintext alongside the encrypted vault file */
export interface VaultMeta {
  /** scrypt salt (hex) */
  salt: string
  /** scrypt params snapshot */
  params: typeof SCRYPT_PARAMS
  /** Schema version for future migrations */
  version: number
}

// ── Key Derivation ────────────────────────────────────────────────────────────

/**
 * Derive a 256-bit encryption key from `passphrase` using scrypt.
 *
 * @param passphrase - User's master passphrase (UTF-8 string)
 * @param saltHex    - Hex-encoded 32-byte salt
 * @returns 32-byte `Buffer` (must be wiped after use)
 */
export async function deriveKey(passphrase: string, saltHex: string): Promise<Buffer> {
  const salt = Buffer.from(saltHex, "hex")
  return (await scrypt(passphrase, salt, KEY_LENGTH, SCRYPT_PARAMS)) as Buffer
}

/**
 * Generate a fresh random salt for key derivation.
 * @returns Hex-encoded 32-byte salt
 */
export function generateSalt(): string {
  return randomBytes(SALT_LENGTH).toString("hex")
}

// ── AES-256-GCM Encryption ────────────────────────────────────────────────────

/**
 * Encrypt `plaintext` using AES-256-GCM with the provided `key`.
 *
 * @param plaintext - UTF-8 string to encrypt
 * @param key       - 32-byte AES key (from `deriveKey`)
 * @returns Encrypted blob (IV + auth tag + ciphertext, all hex-encoded)
 */
export function encrypt(plaintext: string, key: Buffer): EncryptedBlob {
  const iv = randomBytes(AES_IV_LENGTH)
  const cipher = createCipheriv("aes-256-gcm", key, iv)

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("hex"),
  }
}

/**
 * Decrypt `blob` using AES-256-GCM with the provided `key`.
 * Throws `Error("Decryption failed")` when the auth tag check fails
 * (wrong key, corrupted data, or tampering detected).
 *
 * @param blob - Encrypted blob from `encrypt()`
 * @param key  - 32-byte AES key identical to the one used for encryption
 * @returns Decrypted UTF-8 string
 */
export function decrypt(blob: EncryptedBlob, key: Buffer): string {
  const iv = Buffer.from(blob.iv, "hex")
  const tag = Buffer.from(blob.tag, "hex")
  const data = Buffer.from(blob.data, "hex")

  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(tag)

  try {
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
    return decrypted.toString("utf8")
  } catch {
    throw new Error("Decryption failed: wrong passphrase or data tampered")
  }
}

// ── HMAC Helpers (used by audit-log.ts) ──────────────────────────────────────

/**
 * Compute HMAC-SHA256 of `data` using `secret`.
 *
 * @param data   - String to sign
 * @param secret - HMAC secret (hex string)
 * @returns Hex-encoded HMAC digest
 */
export function hmacSha256(data: string, secret: string): string {
  return createHmac("sha256", Buffer.from(secret, "hex")).update(data).digest("hex")
}

/**
 * Compute SHA-256 of `data`.
 *
 * @param data - String to hash
 * @returns Hex-encoded SHA-256 digest
 */
export function sha256(data: string): string {
  const { createHash } = require("node:crypto") as typeof import("node:crypto")
  return createHash("sha256").update(data, "utf8").digest("hex")
}
