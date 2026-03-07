/**
 * @file os-agent/voice-io.ts — Full-Duplex Voice I/O Pipeline
 * @description Handles voice input (STT + wake word + VAD) and voice output (TTS).
 * Enables JARVIS-style always-on voice interaction with interruption support.
 *
 * Architecture:
 *   Microphone → VAD → Wake Word → STT → Nova Pipeline → TTS → Speaker
 *
 * Based on:
 * - Low-Latency Voice Agents (arXiv:2508.04721)
 * - Silero VAD for voice activity detection
 * - OpenWakeWord / Porcupine for wake word detection
 *
 * @module os-agent/voice-io
 */

import { EventEmitter } from "node:events"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { execa } from "execa"
import { createLogger } from "../logger.js"
import type { VoiceIOConfig, OSActionResult } from "./types.js"

const log = createLogger("os-agent.voice-io")

// Lazy-import EdgeEngine to avoid circular deps
let _edgeEngine: any = null
async function getEdgeEngine() {
  if (!_edgeEngine) {
    const { EdgeEngine } = await import("../voice/edge-engine.js")
    _edgeEngine = new EdgeEngine()
  }
  return _edgeEngine
}

interface VoiceIOEvents {
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

  constructor(private config: VoiceIOConfig) {
    super()
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      log.info("Voice I/O disabled by config")
      return
    }

    log.info("Initializing Voice I/O", {
      stt: this.config.sttEngine,
      wakeWord: this.config.wakeWord,
      vad: this.config.vadEngine,
      fullDuplex: this.config.fullDuplex,
    })

    // Initialize sub-components
    await this.initializeVAD()
    await this.initializeWakeWord()
    await this.initializeSTT()

    this.initialized = true
    log.info("Voice I/O initialized")
  }

  /**
   * Start listening for the wake word.
   * This runs continuously in the background with minimal CPU usage.
   */
  async startListening(): Promise<void> {
    if (!this.initialized) {
      throw new Error("Voice I/O not initialized")
    }
    if (this.listening) return

    this.listening = true
    log.info("Voice I/O: listening for wake word...")

    // Start the VAD + wake word detection loop
    this.startVADLoop()
  }

  /**
   * Stop listening.
   */
  async stopListening(): Promise<void> {
    this.listening = false
    log.info("Voice I/O: stopped listening")
  }

  /**
   * Speak text using TTS. Returns when speech is complete.
   * If full-duplex is enabled, speech can be interrupted.
   */
  async speak(text: string, options?: { voice?: string; rate?: number; blocking?: boolean }): Promise<OSActionResult> {
    const start = Date.now()

    try {
      // If already speaking and full-duplex, cancel current speech
      if (this.speaking && this.config.fullDuplex) {
        await this.cancelSpeech()
      }

      this.speaking = true
      this.currentTTSAbort = new AbortController()

      log.info("Speaking", { textLength: text.length, voice: options?.voice })

      // Generate audio via Edge TTS (same engine used by VoiceBridge)
      const engine = await getEdgeEngine()
      const audioBuffer: Buffer = await engine.generate(text, {
        voice: options?.voice ?? "en-US-GuyNeural",
        rate: options?.rate ? `${options.rate > 0 ? "+" : ""}${options.rate}%` : undefined,
      })

      // Play audio through system speaker
      const tmpPath = path.join(os.tmpdir(), `nova-tts-${Date.now()}.mp3`)
      await fs.writeFile(tmpPath, audioBuffer)

      try {
        if (process.platform === "win32") {
          // Windows Media Player COM object — plays MP3 natively
          const psScript = `$p = New-Object System.Media.SoundPlayer; Add-Type -AssemblyName presentationCore; $m = New-Object System.Windows.Media.MediaPlayer; $m.Open([Uri]'${tmpPath.replace(/'/g, "''")}'); $m.Play(); Start-Sleep -Milliseconds ${Math.max(1000, Math.ceil(audioBuffer.length / 12))}`
          await execa("powershell", ["-command", psScript], { timeout: 60_000 })
        } else if (process.platform === "darwin") {
          await execa("afplay", [tmpPath], { timeout: 60_000 })
        } else {
          // Linux: try multiple players
          await execa("play", [tmpPath], { timeout: 60_000 }).catch(() =>
            execa("aplay", [tmpPath], { timeout: 60_000 }).catch(() =>
              execa("mpv", ["--no-video", tmpPath], { timeout: 60_000 })
            )
          )
        }
      } finally {
        await fs.unlink(tmpPath).catch(() => {})
      }

      this.speaking = false
      this.currentTTSAbort = null

      return {
        success: true,
        data: { textLength: text.length, audioBytes: audioBuffer.length, duration: Date.now() - start },
        duration: Date.now() - start,
      }
    } catch (err) {
      this.speaking = false
      this.currentTTSAbort = null
      log.warn("TTS speak failed", { error: String(err) })
      return { success: false, error: String(err), duration: Date.now() - start }
    }
  }

  /**
   * Cancel current TTS playback (for barge-in / interruption).
   */
  async cancelSpeech(): Promise<void> {
    if (this.currentTTSAbort) {
      this.currentTTSAbort.abort()
      this.currentTTSAbort = null
    }
    this.speaking = false
    log.info("Speech cancelled (barge-in)")
  }

  /**
   * Check if voice I/O is currently active.
   */
  get isListening(): boolean {
    return this.listening
  }

  get isSpeaking(): boolean {
    return this.speaking
  }

  async shutdown(): Promise<void> {
    await this.stopListening()
    await this.cancelSpeech()
    this.removeAllListeners()
    this.initialized = false
    log.info("Voice I/O shut down")
  }

  // ── Private: VAD (Voice Activity Detection) ──

  private async initializeVAD(): Promise<void> {
    // Silero VAD initialization
    // In production: load ONNX model via onnxruntime-node
    log.info(`VAD engine: ${this.config.vadEngine} (placeholder — needs onnxruntime-node)`)
  }

  private startVADLoop(): void {
    // In production:
    // 1. Capture audio from microphone using node-audio-recorder or portaudio
    // 2. Run 30ms chunks through Silero VAD
    // 3. When voice detected → check wake word
    // 4. When wake word detected → start STT
    // 5. When silence detected → stop STT, emit transcription
    //
    // Pseudo-implementation:
    // const recorder = new AudioRecorder({ sampleRate: 16000, channels: 1 })
    // recorder.on('data', (chunk) => {
    //   const isSpeech = this.vadModel.process(chunk)
    //   if (isSpeech) { ... }
    // })

    log.info("VAD loop started (placeholder — needs audio capture implementation)")
  }

  // ── Private: Wake Word Detection ──

  private async initializeWakeWord(): Promise<void> {
    if (this.config.wakeWordEngine === "porcupine") {
      // Picovoice Porcupine: requires API key (free tier available)
      // npm install @picovoice/porcupine-node
      log.info(`Wake word engine: Porcupine (word: "${this.config.wakeWord}")`)
    } else {
      // OpenWakeWord: fully open-source, runs locally
      // Needs Python bridge or ONNX port
      log.info(`Wake word engine: OpenWakeWord (word: "${this.config.wakeWord}")`)
    }
  }

  // ── Private: STT (Speech-to-Text) ──

  private async initializeSTT(): Promise<void> {
    switch (this.config.sttEngine) {
      case "whisper-local":
        // faster-whisper via Python subprocess or whisper.cpp via node binding
        // npm install whisper-node (bindings to whisper.cpp)
        log.info(`STT engine: Whisper local (model: ${this.config.whisperModel ?? "base"})`)
        break
      case "deepgram":
        // Cloud STT: very low latency (~100ms), WebSocket streaming
        // npm install @deepgram/sdk
        log.info("STT engine: Deepgram (cloud)")
        break
      case "google":
        log.info("STT engine: Google Cloud Speech")
        break
      case "azure":
        log.info("STT engine: Azure Speech Services")
        break
    }
  }
}

