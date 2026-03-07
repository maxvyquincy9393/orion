/**
 * edge-engine.ts — Microsoft Edge TTS engine for EDITH.
 *
 * Uses msedge-tts to access Microsoft Edge's free neural voice service.
 * No API key required. No model download. No GPU. TypeScript native.
 *
 * Part of EDITH — Persistent AI Companion System.
 */

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts"
import { createLogger } from "../logger.js"

const log = createLogger("voice:edge")

export interface EdgeVoiceOptions {
    voice?: string
    rate?: string | number
    pitch?: string
    volume?: string
}

/**
 * EdgeEngine — Free neural TTS via Microsoft Edge's Read Aloud service.
 *
 * Features:
 * - 300+ neural voices, 40+ languages
 * - Rate, pitch, volume control via SSML prosody
 * - Streaming audio support
 * - Zero cost, zero GPU, zero API key
 */
export class EdgeEngine {
    private tts: MsEdgeTTS | null = null
    private currentVoice = ""

    private async ensureReady(voice: string): Promise<MsEdgeTTS> {
        if (this.tts && this.currentVoice === voice) {
            return this.tts
        }

        this.tts = new MsEdgeTTS()
        await this.tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
        this.currentVoice = voice
        log.info("edge tts initialized", { voice })
        return this.tts
    }

    /**
     * Generate speech audio as a Buffer.
     *
     * @param text - Text to speak.
     * @param options - Voice, rate, pitch, volume overrides.
     * @returns Buffer containing MP3 audio.
     */
    async generate(text: string, options: EdgeVoiceOptions = {}): Promise<Buffer> {
        const voice = options.voice ?? "en-US-GuyNeural"
        const tts = await this.ensureReady(voice)

        return new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = []

            const { audioStream } = tts.toStream(text, {
                rate: options.rate ?? "-8%",
                pitch: options.pitch ?? "-5Hz",
                volume: options.volume ?? "+0%",
            })

            audioStream.on("data", (chunk: Buffer) => {
                chunks.push(chunk)
            })

            audioStream.on("end", () => {
                const buffer = Buffer.concat(chunks)
                log.info("generated audio", { bytes: buffer.length, text: text.slice(0, 50) })
                resolve(buffer)
            })

            audioStream.on("error", (err: Error) => {
                log.error("stream error", err)
                reject(err)
            })
        })
    }

    /**
     * Stream speech audio chunks via callback.
     *
     * @param text - Text to speak.
     * @param onChunk - Called with each audio chunk.
     * @param options - Voice, rate, pitch, volume overrides.
     */
    async stream(
        text: string,
        onChunk: (chunk: Buffer) => void,
        options: EdgeVoiceOptions = {},
    ): Promise<void> {
        const voice = options.voice ?? "en-US-GuyNeural"
        const tts = await this.ensureReady(voice)

        return new Promise<void>((resolve, reject) => {
            const { audioStream } = tts.toStream(text, {
                rate: options.rate ?? "-8%",
                pitch: options.pitch ?? "-5Hz",
                volume: options.volume ?? "+0%",
            })

            audioStream.on("data", (chunk: Buffer) => {
                onChunk(chunk)
            })

            audioStream.on("end", () => {
                resolve()
            })

            audioStream.on("error", (err: Error) => {
                log.error("streaming error", err)
                reject(err)
            })
        })
    }

    /**
     * List all available voices from Microsoft Edge TTS.
     *
     * @returns Array of voice metadata objects.
     */
    async listVoices(): Promise<Array<{ Name: string; ShortName: string; Gender: string; Locale: string }>> {
        const tts = new MsEdgeTTS()
        const voices = await tts.getVoices()
        return voices
    }
}
