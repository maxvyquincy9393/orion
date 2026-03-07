import fs from "node:fs"

import { execa } from "execa"

import {
  VOICE_PYTHON_CWD,
  VOICE_REQUIREMENTS_PATH,
  VOICE_VENV_DIR,
  getVoicePythonCandidates,
  getVoiceVenvPythonPath,
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
      stdio: "pipe",
    })
    return true
  } catch {
    return false
  }
}

async function resolveBootstrapPython(): Promise<string> {
  for (const candidate of getVoicePythonCandidates()) {
    if (await isUsablePython(candidate)) {
      return candidate
    }
  }

  throw new Error("No usable Python interpreter found for voice dependency setup")
}

async function runPython(command: string, args: string[], stdio: "inherit" | "pipe" = "inherit") {
  const resolvedArgs = command.toLowerCase() === "py"
    ? ["-3", ...args]
    : args
  return execa(command, resolvedArgs, {
    cwd: VOICE_PYTHON_CWD,
    windowsHide: true,
    stdio,
  })
}

async function ensureVenv(bootstrapPython: string): Promise<string> {
  const venvPython = getVoiceVenvPythonPath()
  if (!fs.existsSync(venvPython)) {
    await runPython(bootstrapPython, ["-m", "venv", VOICE_VENV_DIR])
  }

  return venvPython
}

async function inspectDependencies(venvPython: string): Promise<PythonDependencyStatus> {
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

  const { stdout } = await execa(venvPython, ["-c", pythonCode], {
    cwd: VOICE_PYTHON_CWD,
    windowsHide: true,
  })
  return JSON.parse(stdout) as PythonDependencyStatus
}

async function main(): Promise<void> {
  const bootstrapPython = await resolveBootstrapPython()
  const venvPython = await ensureVenv(bootstrapPython)

  await execa(venvPython, ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], {
    cwd: VOICE_PYTHON_CWD,
    windowsHide: true,
    stdio: "inherit",
  })
  await execa(venvPython, ["-m", "pip", "install", "-r", VOICE_REQUIREMENTS_PATH], {
    cwd: VOICE_PYTHON_CWD,
    windowsHide: true,
    stdio: "inherit",
  })

  const dependencies = await inspectDependencies(venvPython)
  const missing = Object.entries(dependencies)
    .filter(([key, value]) => key !== "pythonAvailable" && !value)
    .map(([key]) => key)

  console.log(JSON.stringify({
    ok: missing.length === 0,
    python: venvPython,
    venv: VOICE_VENV_DIR,
    cwd: VOICE_PYTHON_CWD,
    dependencies,
  }, null, 2))

  if (missing.length > 0) {
    throw new Error(`Voice dependency setup incomplete; missing imports: ${missing.join(", ")}`)
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
