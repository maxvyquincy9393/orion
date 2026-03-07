import fs from "node:fs"
import path from "node:path"

import { execa } from "execa"

import { VOICE_PROJECT_ROOT, VOICE_PYTHON_CWD, resolveVoicePythonCommand } from "./python-runtime.js"

const PY = resolveVoicePythonCommand()

export const OPENWAKEWORD_MODEL_NAMES = [
  "alexa",
  "hey_jarvis",
  "hey_mycroft",
  "hey_rhasspy",
  "timer",
  "weather",
] as const

export type OpenWakeWordModelName = (typeof OPENWAKEWORD_MODEL_NAMES)[number]

export const DEFAULT_OPENWAKEWORD_MODEL: OpenWakeWordModelName = "hey_mycroft"
export const WAKEWORD_MODELS_DIR = path.join(VOICE_PROJECT_ROOT, "models", "wakewords")
export const OPENWAKEWORD_MODELS_DIR = path.join(WAKEWORD_MODELS_DIR, "openwakeword")
export const PORCUPINE_MODELS_DIR = path.join(WAKEWORD_MODELS_DIR, "porcupine")

const OPENWAKEWORD_MODEL_NAME_SET = new Set<string>(OPENWAKEWORD_MODEL_NAMES)
const OPENWAKEWORD_MODEL_PHRASES: Record<OpenWakeWordModelName, string> = {
  alexa: "alexa",
  hey_jarvis: "hey jarvis",
  hey_mycroft: "hey mycroft",
  hey_rhasspy: "hey rhasspy",
  timer: "timer",
  weather: "weather",
}

export interface OpenWakeWordInferenceAssets {
  format: "onnx" | "tflite"
  modelPath: string
  melspectrogramPath: string
  embeddingModelPath: string
}

export interface PreparedWakeModel {
  engine: "openwakeword"
  modelName: OpenWakeWordModelName
  keyword: string
  modelDirectory: string
  modelPath: string
  melspectrogramPath: string
  embeddingModelPath: string
}

function normalizeWakeWordValue(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
}

export function normalizeOpenWakeWordModelName(value?: string): OpenWakeWordModelName {
  const normalized = normalizeWakeWordValue(value)
  if (!normalized) {
    return DEFAULT_OPENWAKEWORD_MODEL
  }

  const exactName = normalized.replace(/\s+/g, "_")
  if (OPENWAKEWORD_MODEL_NAME_SET.has(exactName)) {
    return exactName as OpenWakeWordModelName
  }

  const matchedPhrase = Object.entries(OPENWAKEWORD_MODEL_PHRASES).find(([, phrase]) => phrase === normalized)
  return matchedPhrase?.[0] as OpenWakeWordModelName | undefined ?? DEFAULT_OPENWAKEWORD_MODEL
}

export function getOpenWakeWordPhrase(modelName: OpenWakeWordModelName): string {
  return OPENWAKEWORD_MODEL_PHRASES[modelName]
}

function getOpenWakeWordTargetPath(modelName: OpenWakeWordModelName, extension: ".onnx" | ".tflite"): string {
  return path.join(OPENWAKEWORD_MODELS_DIR, `${modelName}${extension}`)
}

function getOpenWakeWordSupportPath(format: OpenWakeWordInferenceAssets["format"], baseName: "melspectrogram" | "embedding_model"): string {
  return path.join(OPENWAKEWORD_MODELS_DIR, `${baseName}.${format}`)
}

function findPreparedModelFile(
  modelName: OpenWakeWordModelName,
  extension: ".onnx" | ".tflite",
): string | null {
  if (!fs.existsSync(OPENWAKEWORD_MODELS_DIR)) {
    return null
  }

  const directPath = getOpenWakeWordTargetPath(modelName, extension)
  if (fs.existsSync(directPath)) {
    return directPath
  }

  const prefix = `${modelName}_`
  const match = fs.readdirSync(OPENWAKEWORD_MODELS_DIR)
    .filter((entry) => entry.toLowerCase().endsWith(extension))
    .find((entry) => entry === `${modelName}${extension}` || entry.startsWith(prefix))

  return match ? path.join(OPENWAKEWORD_MODELS_DIR, match) : null
}

export function resolveOpenWakeWordInferenceAssets(
  configuredModelPath: string,
  hasFile: (assetPath: string) => boolean = (assetPath) => fs.existsSync(assetPath),
): OpenWakeWordInferenceAssets {
  const trimmed = configuredModelPath.trim()
  if (!trimmed) {
    throw new Error("openwakeword model path is required")
  }

  const parsed = path.parse(trimmed)
  const hasSiblingOnnx = hasFile(path.join(parsed.dir, `${parsed.name}.onnx`))
  const format = parsed.ext.toLowerCase() === ".tflite" && !hasSiblingOnnx ? "tflite" : "onnx"
  const modelPath = format === "onnx"
    ? path.join(parsed.dir, `${parsed.name}.onnx`)
    : path.join(parsed.dir, `${parsed.name}.tflite`)

  return {
    format,
    modelPath,
    melspectrogramPath: path.join(parsed.dir, `melspectrogram.${format}`),
    embeddingModelPath: path.join(parsed.dir, `embedding_model.${format}`),
  }
}

export async function prepareOpenWakeWordModel(options: {
  modelName?: string
} = {}): Promise<PreparedWakeModel> {
  const modelName = normalizeOpenWakeWordModelName(options.modelName)
  await fs.promises.mkdir(OPENWAKEWORD_MODELS_DIR, { recursive: true })

  const pythonCode = `
import json
import os
import sys

from openwakeword.utils import download_models

model_name = sys.argv[1]
target_directory = sys.argv[2]

download_models([model_name], target_directory=target_directory)

model_matches = sorted([
    os.path.join(target_directory, filename)
    for filename in os.listdir(target_directory)
    if filename.startswith(model_name) and filename.endswith(".onnx")
])

if not model_matches:
    raise FileNotFoundError(model_name)

model_path = model_matches[0]
melspec_path = os.path.join(target_directory, "melspectrogram.onnx")
embedding_path = os.path.join(target_directory, "embedding_model.onnx")

missing = [path for path in [model_path, melspec_path, embedding_path] if not os.path.exists(path)]
if missing:
    raise FileNotFoundError(", ".join(missing))

print(json.dumps({
    "modelPath": model_path,
    "melspectrogramPath": melspec_path,
    "embeddingModelPath": embedding_path,
}))
`.trim()

  const { stdout } = await execa(PY, ["-c", pythonCode, modelName, OPENWAKEWORD_MODELS_DIR], {
    cwd: VOICE_PYTHON_CWD,
    windowsHide: true,
  })

  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const payload = JSON.parse(lines.at(-1) ?? "{}") as {
    modelPath?: string
    melspectrogramPath?: string
    embeddingModelPath?: string
  }

  if (!payload.modelPath || !payload.melspectrogramPath || !payload.embeddingModelPath) {
    throw new Error("wake model preparation did not return the expected asset paths")
  }

  return {
    engine: "openwakeword",
    modelName,
    keyword: getOpenWakeWordPhrase(modelName),
    modelDirectory: OPENWAKEWORD_MODELS_DIR,
    modelPath: payload.modelPath,
    melspectrogramPath: payload.melspectrogramPath,
    embeddingModelPath: payload.embeddingModelPath,
  }
}

export function getPreparedOpenWakeWordModel(modelName?: string): PreparedWakeModel | null {
  const normalized = normalizeOpenWakeWordModelName(modelName)
  const modelPath = findPreparedModelFile(normalized, ".onnx")
  const melspectrogramPath = getOpenWakeWordSupportPath("onnx", "melspectrogram")
  const embeddingModelPath = getOpenWakeWordSupportPath("onnx", "embedding_model")

  if (!modelPath || !fs.existsSync(melspectrogramPath) || !fs.existsSync(embeddingModelPath)) {
    return null
  }

  return {
    engine: "openwakeword",
    modelName: normalized,
    keyword: getOpenWakeWordPhrase(normalized),
    modelDirectory: OPENWAKEWORD_MODELS_DIR,
    modelPath,
    melspectrogramPath,
    embeddingModelPath,
  }
}
