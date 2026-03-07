import { EventEmitter } from "node:events"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { execa } from "execa"

import { createLogger } from "../logger.js"
import { createTurnSttProvider, type TurnSttProvider } from "../voice/providers.js"
import { VOICE_PYTHON_CWD, resolveVoicePythonCommand } from "../voice/python-runtime.js"
import type { RuntimeVoiceConfig } from "../voice/runtime-config.js"
import { resolveOpenWakeWordInferenceAssets } from "../voice/wake-model-assets.js"
import { resolveWakeWordConfig, type ResolvedWakeWordConfig } from "../voice/wake-word.js"
import { resolveVoiceRuntimePlan, type PythonVoiceDependencies, type VoiceRuntimePlan } from "./voice-plan.js"
import type { OSActionResult, VoiceIOConfig } from "./types.js"

const log = createLogger("os-agent.voice-io")
const PY = resolveVoicePythonCommand()
const PYTHON_CWD = VOICE_PYTHON_CWD
const WAKE_WORD_TURN_TIMEOUT_MS = 8_000

let edgeEngine: any = null

async function getEdgeEngine() {
  if (!edgeEngine) {
    const { EdgeEngine } = await import("../voice/edge-engine.js")
    edgeEngine = new EdgeEngine()
  }
  return edgeEngine
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function buildWakeWordPattern(keyword: string): RegExp {
  const tokens = keyword
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(escapeRegExp)

  if (tokens.length === 0) {
    return /\bedith\b/i
  }

  return new RegExp(`\\b${tokens.join("[-\\s]+")}\\b`, "i")
}

function toRuntimeVoiceConfig(config: VoiceIOConfig): RuntimeVoiceConfig {
  return {
    enabled: config.enabled,
    mode: config.mode,
    stt: {
      engine: config.sttEngine,
      language: config.language,
      whisperModel: config.whisperModel ?? "base",
      providers: {
        deepgram: {
          apiKey: config.providers?.deepgram?.apiKey,
        },
      },
    },
    tts: {
      engine: "edge",
      voice: config.ttsVoice ?? "en-US-GuyNeural",
    },
    wake: {
      engine: config.wakeWordEngine,
      keyword: config.wakeWord,
      modelPath: config.wakeWordModelPath,
      providers: {
        picovoice: {
          accessKey: config.providers?.picovoice?.accessKey,
        },
      },
    },
    vad: {
      engine: config.vadEngine,
    },
  }
}

async function inspectPythonVoiceDependencies(): Promise<PythonVoiceDependencies> {
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

  try {
    const { stdout } = await execa(PY, ["-c", pythonCode], {
      cwd: PYTHON_CWD,
      windowsHide: true,
    })
    return JSON.parse(stdout) as PythonVoiceDependencies
  } catch (error) {
    log.warn("voice python dependency preflight failed", { error: String(error) })
    return {
      pythonAvailable: false,
      dotenv: false,
      sounddevice: false,
      soundfile: false,
      whisper: false,
      pvporcupine: false,
      openwakeword: false,
      onnxruntime: false,
    }
  }
}

function buildCapturePythonCode(
  voiceConfig: VoiceIOConfig,
  wakeConfig: ResolvedWakeWordConfig,
  runtimePlan: VoiceRuntimePlan,
): string {
  const openWakeWordAssets = wakeConfig.keywordAssetKind === "openwakeword" && wakeConfig.keywordAssetPath
    ? resolveOpenWakeWordInferenceAssets(wakeConfig.keywordAssetPath)
    : null
  const pythonConfig = {
    wakeMode: runtimePlan.wakeWordImplementation,
    keywordAssetPath: wakeConfig.keywordAssetPath ?? "",
    openwakewordModelPath: openWakeWordAssets?.modelPath ?? "",
    openwakewordMelspectrogramPath: openWakeWordAssets?.melspectrogramPath ?? "",
    openwakewordEmbeddingPath: openWakeWordAssets?.embeddingModelPath ?? "",
    picovoiceAccessKey: voiceConfig.providers?.picovoice?.accessKey ?? "",
  }

  return `
import base64
import io
import json
import queue
import threading
import wave

import numpy as np
import sounddevice as sd

import sys
sys.path.insert(0, ".")

from delivery.streaming_voice import VADSegmenter

CONFIG = ${JSON.stringify(pythonConfig)}
SAMPLE_RATE = 16000
CHUNK_SIZE = int(SAMPLE_RATE * 0.1)

def to_wav_bytes(segment):
    pcm = np.clip(segment, -1.0, 1.0)
    pcm16 = (pcm * 32767).astype(np.int16)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(pcm16.tobytes())
    return buffer.getvalue()

def chunk_to_pcm16_bytes(chunk):
    pcm = np.clip(chunk, -1.0, 1.0)
    return (pcm * 32767).astype(np.int16).tobytes()

audio_queue = queue.Queue()
speech_queue = queue.Queue()
vad = VADSegmenter(sample_rate=SAMPLE_RATE)

segments = vad.segment_stream(speech_queue)
armed = CONFIG["wakeMode"] == "transcript-keyword"
wake_buffer = bytearray()
wake_detector = None
wake_frame_bytes = 0

if CONFIG["wakeMode"] == "porcupine-native":
    import pvporcupine

    wake_detector = pvporcupine.create(
        access_key=CONFIG["picovoiceAccessKey"],
        keyword_paths=[CONFIG["keywordAssetPath"]],
    )
    wake_frame_bytes = wake_detector.frame_length * 2
elif CONFIG["wakeMode"] == "openwakeword-native":
    from openwakeword.model import Model

    wake_detector = Model(
        wakeword_models=[CONFIG["openwakewordModelPath"]],
        inference_framework="onnx",
        melspec_model_path=CONFIG["openwakewordMelspectrogramPath"],
        embedding_model_path=CONFIG["openwakewordEmbeddingPath"],
    )
    wake_frame_bytes = int(SAMPLE_RATE * 0.08) * 2

def capture():
    with sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype=np.float32,
        blocksize=CHUNK_SIZE,
    ) as stream:
        while True:
            chunk, _ = stream.read(CHUNK_SIZE)
            audio_queue.put(chunk.flatten())

def segment_worker():
    global armed
    while True:
        segment = segments.get()
        if segment is None:
            break
        payload = base64.b64encode(to_wav_bytes(segment)).decode("ascii")
        print("SEGMENT:" + json.dumps(payload), flush=True)
        if CONFIG["wakeMode"] != "transcript-keyword":
            armed = False

def detect_porpcupine(pcm_bytes):
    global wake_buffer
    wake_buffer.extend(pcm_bytes)

    while len(wake_buffer) >= wake_frame_bytes:
        frame = bytes(wake_buffer[:wake_frame_bytes])
        del wake_buffer[:wake_frame_bytes]
        pcm = np.frombuffer(frame, dtype=np.int16)
        if wake_detector.process(pcm) >= 0:
            return True
    return False

def detect_openwakeword(pcm_bytes):
    global wake_buffer
    wake_buffer.extend(pcm_bytes)

    while len(wake_buffer) >= wake_frame_bytes:
        frame = bytes(wake_buffer[:wake_frame_bytes])
        del wake_buffer[:wake_frame_bytes]
        pcm = np.frombuffer(frame, dtype=np.int16)
        prediction = wake_detector.predict(pcm)
        if any(float(score) >= 0.5 for score in prediction.values()):
            return True
    return False

threading.Thread(target=capture, daemon=True).start()
threading.Thread(target=segment_worker, daemon=True).start()

while True:
    chunk = audio_queue.get()
    if chunk is None:
        speech_queue.put(None)
        break

    if armed:
        speech_queue.put(chunk)
        continue

    if wake_detector is None:
        speech_queue.put(chunk)
        continue

    pcm_bytes = chunk_to_pcm16_bytes(chunk)
    if CONFIG["wakeMode"] == "porcupine-native":
        wake_triggered = detect_porpcupine(pcm_bytes)
    else:
        wake_triggered = detect_openwakeword(pcm_bytes)

    if wake_triggered:
        print("WAKE", flush=True)
        armed = True
        speech_queue.put(chunk)
`.trim()
}

export interface VoiceIOEvents {
  wakeWord: () => void
  speechStart: () => void
  speechEnd: (transcription: string) => void
  transcription: (text: string, isFinal: boolean) => void
  error: (error: Error) => void
}

export class VoiceIO extends EventEmitter {
  private initialized = false
  private listening = false
  private speaking = false
  private currentTTSAbort: AbortController | null = null
  private runtimeConfig: RuntimeVoiceConfig
  private wakeConfig: ResolvedWakeWordConfig
  private sttProvider: TurnSttProvider | null = null
  private captureProcess: ReturnType<typeof execa> | null = null
  private pythonDependencies: PythonVoiceDependencies = {
    pythonAvailable: false,
    dotenv: false,
    sounddevice: false,
    soundfile: false,
    whisper: false,
    pvporcupine: false,
    openwakeword: false,
    onnxruntime: false,
  }
  private runtimePlan: VoiceRuntimePlan = {
    captureImplementation: "unavailable",
    vadImplementation: "unavailable",
    sttImplementation: "unavailable",
    wakeWordImplementation: "transcript-keyword",
    fallbackReasons: [],
  }
  private awaitingFollowupTurn = false
  private wakeWordTimer: ReturnType<typeof setTimeout> | null = null
  private audioLevelResetTimer: ReturnType<typeof setTimeout> | null = null
  private lastWakeWordAt = 0
  private lastTranscriptValue: string | undefined
  private currentAudioLevel = 0

  constructor(private config: VoiceIOConfig) {
    super()
    this.runtimeConfig = toRuntimeVoiceConfig(config)
    this.wakeConfig = resolveWakeWordConfig(this.runtimeConfig)
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      log.info("Voice I/O disabled by config")
      return
    }

    this.runtimeConfig = toRuntimeVoiceConfig(this.config)
    this.wakeConfig = resolveWakeWordConfig(this.runtimeConfig)
    this.pythonDependencies = await inspectPythonVoiceDependencies()
    this.runtimePlan = resolveVoiceRuntimePlan(this.config, this.wakeConfig, this.pythonDependencies)
    this.sttProvider = createTurnSttProvider(this.runtimeConfig)

    log.info("Initializing Voice I/O", {
      mode: this.config.mode,
      stt: this.config.sttEngine,
      wakeWord: this.config.wakeWordEngine,
      vad: this.config.vadEngine,
      fullDuplex: this.config.fullDuplex,
      runtimePlan: this.runtimePlan,
    })

    await this.initializeVAD()
    await this.initializeWakeWord()
    await this.initializeSTT()

    this.initialized = true
    log.info("Voice I/O initialized")
  }

  async startListening(): Promise<void> {
    if (!this.initialized) {
      throw new Error("Voice I/O not initialized")
    }
    if (this.config.mode !== "always-on" || this.listening) {
      return
    }

    if (this.runtimePlan.captureImplementation === "unavailable" || this.runtimePlan.sttImplementation === "unavailable") {
      this.emitVoiceError(new Error(`Always-on voice runtime unavailable: ${this.runtimePlan.fallbackReasons.join("; ") || "missing dependencies"}`))
      return
    }

    this.listening = true
    this.startCaptureLoop()
    log.info("Voice I/O listening for wake word")
  }

  async stopListening(): Promise<void> {
    this.listening = false
    this.awaitingFollowupTurn = false
    this.clearWakeWordTimer()
    this.clearAudioLevelTimer()

    const child = this.captureProcess
    this.captureProcess = null
    if (child) {
      child.kill("SIGTERM")
      await child.catch(() => undefined)
    }

    log.info("Voice I/O stopped listening")
  }

  async speak(text: string, options?: { voice?: string; rate?: number; blocking?: boolean }): Promise<OSActionResult> {
    const start = Date.now()
    const abortController = new AbortController()

    try {
      if (this.speaking && this.config.fullDuplex) {
        await this.cancelSpeech()
      }

      this.speaking = true
      this.currentTTSAbort = abortController

      const engine = await getEdgeEngine()
      const audioBuffer: Buffer = await engine.generate(text, {
        voice: options?.voice ?? this.config.ttsVoice ?? "en-US-GuyNeural",
        rate: options?.rate ? `${options.rate > 0 ? "+" : ""}${options.rate}%` : undefined,
      })

      const tmpPath = path.join(os.tmpdir(), `edith-tts-${Date.now()}.mp3`)
      await fs.writeFile(tmpPath, audioBuffer)

      try {
        const playbackOptions = {
          timeout: 60_000,
          signal: abortController.signal,
        }

        if (process.platform === "win32") {
          const psScript = `$m = New-Object System.Windows.Media.MediaPlayer; $m.Open([Uri]'${tmpPath.replace(/'/g, "''")}'); $m.Play(); Start-Sleep -Milliseconds ${Math.max(1000, Math.ceil(audioBuffer.length / 12))}`
          await execa("powershell", ["-command", psScript], playbackOptions)
        } else if (process.platform === "darwin") {
          await execa("afplay", [tmpPath], playbackOptions)
        } else {
          await execa("play", [tmpPath], playbackOptions).catch(() =>
            execa("aplay", [tmpPath], playbackOptions).catch(() =>
              execa("mpv", ["--no-video", tmpPath], playbackOptions)
            )
          )
        }
      } finally {
        await fs.unlink(tmpPath).catch(() => {})
      }

      return {
        success: true,
        data: { textLength: text.length, audioBytes: audioBuffer.length, duration: Date.now() - start },
        duration: Date.now() - start,
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        log.info("TTS playback interrupted")
        return {
          success: true,
          data: { interrupted: true },
          duration: Date.now() - start,
        }
      }

      log.warn("TTS speak failed", { error: String(error) })
      return { success: false, error: String(error), duration: Date.now() - start }
    } finally {
      if (this.currentTTSAbort === abortController) {
        this.currentTTSAbort = null
      }
      this.speaking = false
    }
  }

  async cancelSpeech(): Promise<void> {
    if (this.currentTTSAbort) {
      this.currentTTSAbort.abort()
      this.currentTTSAbort = null
    }
    this.speaking = false
    log.info("Speech cancelled")
  }

  get isListening(): boolean {
    return this.listening
  }

  get isSpeaking(): boolean {
    return this.speaking
  }

  get wakeWordDetected(): boolean {
    return Date.now() - this.lastWakeWordAt < 3_000
  }

  get audioLevel(): number {
    return this.currentAudioLevel
  }

  get lastTranscript(): string | undefined {
    return this.lastTranscriptValue
  }

  get implementationStatus(): VoiceRuntimePlan {
    return this.runtimePlan
  }

  async shutdown(): Promise<void> {
    await this.stopListening()
    await this.cancelSpeech()
    this.removeAllListeners()
    this.initialized = false
    log.info("Voice I/O shut down")
  }

  private async initializeVAD(): Promise<void> {
    log.info("Voice turn detection initialized", {
      requestedEngine: this.config.vadEngine,
      implementation: this.runtimePlan.vadImplementation,
    })
  }

  private async initializeWakeWord(): Promise<void> {
    log.info("Wake word initialized", {
      requestedEngine: this.wakeConfig.requestedEngine,
      effectiveEngine: this.wakeConfig.effectiveEngine,
      keyword: this.wakeConfig.keyword,
      keywordAssetPath: this.wakeConfig.keywordAssetPath,
      implementation: this.runtimePlan.wakeWordImplementation,
      fallbackReasons: this.runtimePlan.fallbackReasons,
    })
  }

  private async initializeSTT(): Promise<void> {
    log.info("Voice transcription initialized", {
      engine: this.config.sttEngine,
      implementation: this.runtimePlan.sttImplementation,
      language: this.config.language,
      whisperModel: this.config.whisperModel ?? "base",
      deepgramConfigured: Boolean(this.config.providers?.deepgram?.apiKey),
    })
  }

  private startCaptureLoop(): void {
    if (!this.listening || this.captureProcess) {
      return
    }

    if (this.runtimePlan.captureImplementation === "unavailable") {
      this.emitVoiceError(new Error(`Voice capture loop unavailable: ${this.runtimePlan.fallbackReasons.join("; ") || "missing dependencies"}`))
      return
    }

    const pythonCode = buildCapturePythonCode(this.config, this.wakeConfig, this.runtimePlan)

    const child = execa(PY, ["-c", pythonCode], {
      cwd: PYTHON_CWD,
      windowsHide: true,
    })

    this.captureProcess = child

    let stdoutBuffer = ""
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString()
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) {
          continue
        }

        if (trimmed === "WAKE") {
          void this.handleNativeWakeWordDetection()
          continue
        }

        if (!trimmed.startsWith("SEGMENT:")) {
          continue
        }

        const payload = trimmed.slice("SEGMENT:".length)
        void this.processAudioSegment(payload)
      }
    })

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString().trim()
      if (text) {
        log.warn("voice capture stderr", { text })
      }
    })

    void child.catch((error) => {
      if (this.listening) {
        this.emitVoiceError(error instanceof Error ? error : new Error(String(error)))
      }
    }).finally(() => {
      if (this.captureProcess === child) {
        this.captureProcess = null
      }
      if (this.listening) {
        log.warn("voice capture loop exited, restarting")
        const restartTimer = setTimeout(() => this.startCaptureLoop(), 1_000)
        restartTimer.unref?.()
      }
    })
  }

  private async processAudioSegment(rawPayload: string): Promise<void> {
    if (!this.sttProvider) {
      return
    }

    try {
      const audio = Buffer.from(JSON.parse(rawPayload), "base64")
      if (audio.length === 0) {
        return
      }

      this.currentAudioLevel = 1
      this.clearAudioLevelTimer()
      this.audioLevelResetTimer = setTimeout(() => {
        this.currentAudioLevel = 0
        this.audioLevelResetTimer = null
      }, 750)
      this.audioLevelResetTimer.unref?.()

      const transcriptResult = await this.sttProvider.transcribeTurn({
        audio,
        mimeType: "audio/wav",
        language: this.config.language,
      })

      const transcript = transcriptResult.text.trim()
      if (!transcript) {
        return
      }

      this.lastTranscriptValue = transcript
      await this.handleTranscriptTurn(transcript)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      log.warn("voice segment processing failed", { error: err.message })
      this.emitVoiceError(err)
    }
  }

  private async handleNativeWakeWordDetection(): Promise<void> {
    this.lastWakeWordAt = Date.now()
    this.awaitingFollowupTurn = true
    this.clearWakeWordTimer()
    this.emit("wakeWord")

    if (this.speaking && this.config.fullDuplex) {
      await this.cancelSpeech()
    }

    this.wakeWordTimer = setTimeout(() => {
      this.awaitingFollowupTurn = false
      this.wakeWordTimer = null
    }, WAKE_WORD_TURN_TIMEOUT_MS)
    this.wakeWordTimer.unref?.()
  }

  private async handleTranscriptTurn(transcript: string): Promise<void> {
    const wakeWordPattern = buildWakeWordPattern(this.wakeConfig.keyword)

    if (wakeWordPattern.test(transcript)) {
      this.lastWakeWordAt = Date.now()
      this.awaitingFollowupTurn = false
      this.clearWakeWordTimer()
      this.emit("wakeWord")

      if (this.speaking && this.config.fullDuplex) {
        await this.cancelSpeech()
      }

      const immediateTurn = transcript.replace(wakeWordPattern, "").replace(/^[\s,.:;-]+/, "").trim()
      if (immediateTurn) {
        this.emitSpeechTurn(immediateTurn)
        return
      }

      this.awaitingFollowupTurn = true
      this.wakeWordTimer = setTimeout(() => {
        this.awaitingFollowupTurn = false
        this.wakeWordTimer = null
      }, WAKE_WORD_TURN_TIMEOUT_MS)
      this.wakeWordTimer.unref?.()
      return
    }

    if (this.awaitingFollowupTurn) {
      this.awaitingFollowupTurn = false
      this.clearWakeWordTimer()
      this.emitSpeechTurn(transcript)
    }
  }

  private emitSpeechTurn(transcript: string): void {
    this.lastTranscriptValue = transcript
    this.emit("speechStart")
    this.emit("transcription", transcript, true)
    this.emit("speechEnd", transcript)
  }

  private clearWakeWordTimer(): void {
    if (this.wakeWordTimer) {
      clearTimeout(this.wakeWordTimer)
      this.wakeWordTimer = null
    }
  }

  private clearAudioLevelTimer(): void {
    if (this.audioLevelResetTimer) {
      clearTimeout(this.audioLevelResetTimer)
      this.audioLevelResetTimer = null
    }
    this.currentAudioLevel = 0
  }

  private emitVoiceError(error: Error): void {
    if (this.listenerCount("error") > 0) {
      this.emit("error", error)
      return
    }

    log.warn("voice error without listener", { error: error.message })
  }
}
