export function getCliConfigDir(): string
export function getCliConfigPath(): string
export function getProfilesRootDir(): string
export function getDefaultProfileDir(): string
export function getProfilePaths(profileDir: string): {
  profileDir: string
  envPath: string
  workspaceDir: string
  stateDir: string
}

export function parseOrionCliArgs(argv: string[]): {
  repoOverride: string | null
  profileOverride: string | null
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
