/**
 * @file dangerous-tools.ts
 * @description Blocklist of tool names and command patterns considered dangerous.
 *
 * ARCHITECTURE:
 *   Referenced by camel-guard.ts and audit.ts for risk classification.
 *   Used by message-pipeline.ts to validate tool calls before execution.
 */

/** Tool names that require elevated confirmation before execution. */
export const DANGEROUS_TOOL_NAMES = new Set([
  'shell_exec', 'eval_code', 'file_delete', 'db_query',
  'network_scan', 'process_kill', 'registry_write',
])

/** Command substrings that are always blocked regardless of context. */
export const BLOCKED_COMMAND_PATTERNS = [
  /rm\s+-rf\s+[\/~]/i,
  /format\s+c:/i,
  /mkfs\./i,
  /dd\s+if=.*of=\/dev\/sd/i,
  />\s*\/dev\/sda/i,
  /shutdown\s+-h\s+now/i,
  /halt\b/i,
]

/**
 * Check whether a command string contains a blocked pattern.
 * @param command - Command string to check
 * @returns True if the command is blocked
 */
export function isCommandBlocked(command: string): boolean {
  return BLOCKED_COMMAND_PATTERNS.some(p => p.test(command))
}
