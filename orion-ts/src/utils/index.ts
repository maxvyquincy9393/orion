/**
 * utils/index.ts — Barrel export for shared utility functions.
 *
 * Import from "utils" rather than individual files to keep import paths stable
 * if utilities are ever reorganized internally.
 *
 * @example
 *   import { sanitizeUserId, clamp, parseJsonSafe } from "../utils/index.js"
 */

export { sanitizeUserId, clamp, parseJsonSafe } from "./string.js"
