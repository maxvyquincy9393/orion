import { execa } from "execa"

import {
  VOICE_PYTHON_CWD,
  getVoicePythonCandidates,
  hasVoiceVenvPython,
  resolveVoicePythonCommand,
} from "../voice/python-runtime.js"

type PythonDependencyStatus = {
  pythonAvailable: boolean
  dotenv: boolean
  sounddevice: boolean
  soundfile: boolean
  whisper: boolean
  pvporcupine: boolean
  openwakeword: boolean
  onnxruntime: boolean
}

async function isUsablePython(command: string): Promise<boolean> {
  try {
    const args = command.toLowerCase() === "py" ? ["-3", "--version"] : ["--version"]
    await execa(command, args, {
      cwd: VOICE_PYTHON_CWD,
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}

async function resolveAvailablePython(): Promise<string | null> {
  const preferred = resolveVoicePythonCommand()
  if (await isUsablePython(preferred)) {
    return preferred
  }

  for (const candidate of getVoicePythonCandidates()) {
    if (await isUsablePython(candidate)) {
      return candidate
    }
  }

  return null
}

async function inspectDependencies(command: string): Promise<PythonDependencyStatus> {
  const commandArgs = command.toLowerCase() === "py"
    ? ["-3", "-c"]
    : ["-c"]
  const pythonCode = `
import importlib.util
import json

def has_module(name):
    return importlib.util.find_spec(name) is not None

print(json.dumps({
    "pythonAvailable": True,
    "dotenv": has_module("dotenv"),
    "sounddevice": has_module("sounddevice"),
    "soundfile": has_module("soundfile"),
    "whisper": has_module("whisper"),
    "pvporcupine": has_module("pvporcupine"),
    "openwakeword": has_module("openwakeword"),
    "onnxruntime": has_module("onnxruntime"),
}))
`.trim()

  const { stdout } = await execa(command, [...commandArgs, pythonCode], {
    cwd: VOICE_PYTHON_CWD,
    windowsHide: true,
  })

  return JSON.parse(stdout) as PythonDependencyStatus
}

async function main(): Promise<void> {
  const command = await resolveAvailablePython()
  if (!command) {
    console.error(JSON.stringify({
      ok: false,
      python: null,
      venv: hasVoiceVenvPython(),
      cwd: VOICE_PYTHON_CWD,
      error: "No usable Python interpreter found for voice runtime",
    }, null, 2))
    process.exitCode = 1
    return
  }

  const versionArgs = command.toLowerCase() === "py" ? ["-3", "--version"] : ["--version"]
  const { stdout, stderr } = await execa(command, versionArgs, {
    cwd: VOICE_PYTHON_CWD,
    windowsHide: true,
  })
  const dependencies = await inspectDependencies(command)

  console.log(JSON.stringify({
    ok: true,
    python: command,
    version: (stdout || stderr).trim(),
    venv: hasVoiceVenvPython(),
    cwd: VOICE_PYTHON_CWD,
    dependencies,
  }, null, 2))
}

void main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2))
  process.exitCode = 1
})
