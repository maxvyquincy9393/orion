import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import config from "../config.js"

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const DEFAULT_PYTHON_COMMANDS = new Set(["python", "python.exe", "python3", "python3.exe"])

export const VOICE_PROJECT_ROOT = PROJECT_ROOT
export const VOICE_PYTHON_CWD = path.join(PROJECT_ROOT, "python")
export const VOICE_VENV_DIR = path.join(PROJECT_ROOT, ".venv-voice")
export const VOICE_REQUIREMENTS_PATH = path.join(PROJECT_ROOT, "requirements-voice.txt")

function normalizeConfiguredPythonPath(): string | undefined {
  const trimmed = config.PYTHON_PATH?.trim()
  return trimmed ? trimmed : undefined
}

function isDefaultPythonCommand(command: string | undefined): boolean {
  return Boolean(command && DEFAULT_PYTHON_COMMANDS.has(command.trim().toLowerCase()))
}

export function getVoiceVenvPythonPath(platform = process.platform): string {
  if (platform === "win32") {
    return path.join(VOICE_VENV_DIR, "Scripts", "python.exe")
  }

  return path.join(VOICE_VENV_DIR, "bin", "python")
}

export function hasVoiceVenvPython(platform = process.platform): boolean {
  return fs.existsSync(getVoiceVenvPythonPath(platform))
}

export function resolveVoicePythonCommand(): string {
  const configured = normalizeConfiguredPythonPath()
  if (configured && !isDefaultPythonCommand(configured)) {
    return configured
  }

  if (hasVoiceVenvPython()) {
    return getVoiceVenvPythonPath()
  }

  if (configured) {
    return configured
  }

  return "python"
}

export function getVoicePythonCandidates(platform = process.platform): string[] {
  const configured = normalizeConfiguredPythonPath()
  const candidates = [
    configured && !isDefaultPythonCommand(configured) ? configured : undefined,
    getVoiceVenvPythonPath(platform),
    configured,
    platform === "win32" ? "py" : "python3",
    "python",
  ]

  return Array.from(new Set(candidates.filter((value): value is string => Boolean(value))))
}
