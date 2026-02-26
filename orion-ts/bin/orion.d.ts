export function getCliConfigDir(): string
export function getCliConfigPath(): string
export function getProfilesRootDir(): string
export function getDefaultProfileDir(): string
export function getNamedProfileDir(profileName: string): string
export function getPnpmCommand(platform?: string): string
export function shouldUseShellForCommand(command: string, platform?: string): boolean
export function shouldInvokeCli(importMetaUrl: string, argv1?: string | null, platform?: string): boolean
export function isLikelyProfileName(value: string): boolean
export function resolveProfileSelector(profileSelector: string, cwd?: string, homeDir?: string): string | null
export function normalizeChannelName(value: string): "telegram" | "discord" | "whatsapp" | "webchat" | null
export function normalizeWhatsAppLoginMode(value?: string | null): "scan" | "cloud" | null
export function parseChannelsArgs(argv: string[]): {
  channel: "telegram" | "discord" | "whatsapp" | "webchat" | null
  mode: string | null
  positionals: string[]
  help: boolean
}
export function parseSelfTestArgs(argv: string[]): {
  fix: boolean
  help: boolean
  positionals: string[]
}
export function getProfilePaths(profileDir: string): {
  profileDir: string
  envPath: string
  workspaceDir: string
  stateDir: string
}
export function parseEnvContentLoose(content: string): Record<string, string>
export function buildWhatsAppSelfTestChecks(
  envMap: Record<string, string>,
  profilePaths: { profileDir: string; envPath: string; workspaceDir: string; stateDir: string },
): Array<{ level: "ok" | "warn" | "error"; label: string; detail: string }>
export function buildTelegramSelfTestChecks(
  envMap: Record<string, string>,
): Array<{ level: "ok" | "warn" | "error"; label: string; detail: string }>
export function buildDiscordSelfTestChecks(
  envMap: Record<string, string>,
): Array<{ level: "ok" | "warn" | "error"; label: string; detail: string }>
export function buildWebchatSelfTestChecks(
  envMap: Record<string, string>,
): Array<{ level: "ok" | "warn" | "error"; label: string; detail: string }>

export function parseOrionCliArgs(argv: string[]): {
  repoOverride: string | null
  profileOverride: string | null
  dev: boolean
  positionals: string[]
  help: boolean
}

export function loadCliConfig(fsModule?: {
  readFile: (path: string, encoding: string) => Promise<string>
}): Promise<Record<string, unknown>>

export function saveCliConfig(
  config: Record<string, unknown>,
  fsModule?: {
    mkdir: (path: string, options?: { recursive?: boolean }) => Promise<unknown>
    writeFile: (path: string, content: string, encoding: string) => Promise<unknown>
  },
): Promise<void>

export function isOrionRepoDir(
  repoDir: string,
  fsModule?: { readFile: (path: string, encoding: string) => Promise<string> },
): Promise<boolean>

export function findOrionRepoUpwards(
  startDir: string,
  fsModule?: { readFile: (path: string, encoding: string) => Promise<string> },
): Promise<string | null>

export function ensureProfileBootstrap(repoDir: string, profileDir: string): Promise<{
  profileDir: string
  envPath: string
  workspaceDir: string
  stateDir: string
}>

export function main(argv?: string[]): Promise<void>
