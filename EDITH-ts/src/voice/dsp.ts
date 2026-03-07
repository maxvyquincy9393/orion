/**
 * dsp.ts — Lightweight audio DSP for EDITH voice character.
 *
 * Pure TypeScript audio processing on raw PCM Float32 samples.
 * No external dependencies — just math on arrays.
 *
 * Effects: parametric EQ, compression, micro-reverb.
 * Designed to add subtle AI character without sounding robotic.
 *
 * Part of EDITH — Persistent AI Companion System.
 */

import type { DSPPreset } from "./edith-preset.js"

/**
 * AudioDSP — Applies post-processing effects to audio buffers.
 *
 * Usage:
 *   const dsp = new AudioDSP(24000)
 *   const processed = dsp.apply(rawPcm, EDITH_DSP)
 */
export class AudioDSP {
    private sampleRate: number

    constructor(sampleRate = 24000) {
        this.sampleRate = sampleRate
    }

    /**
     * Apply full DSP preset to audio samples.
     *
     * Pipeline: EQ → Compression → Reverb
     */
    apply(samples: Float32Array, preset: DSPPreset): Float32Array {
        let audio: Float32Array = Float32Array.from(samples)

        // 1. Parametric EQ — mid-frequency boost for metallic clarity
        if (preset.eqMidGainDb !== 0) {
            audio = this.peakingEQ(audio, preset.eqMidFreqHz, preset.eqMidGainDb, preset.eqQ)
        }

        // 2. High-shelf EQ — presence boost
        if (preset.eqHighShelfDb !== 0) {
            audio = this.highShelf(audio, preset.eqHighShelfHz, preset.eqHighShelfDb)
        }

        // 3. Compression — even, controlled delivery
        if (preset.compressionRatio > 1) {
            audio = this.compress(audio, preset.compressionRatio, preset.compressionThresholdDb)
        }

        // 4. Micro-reverb — faint "inside a machine" feel
        if (preset.reverbMix > 0) {
            audio = this.reverb(audio, preset.reverbMix, preset.reverbDecayS)
        }

        return audio
    }

    /**
     * Peaking EQ filter (biquad).
     *
     * Boosts or cuts a narrow band of frequencies.
     */
    private peakingEQ(
        samples: Float32Array,
        centerFreq: number,
        gainDb: number,
        Q: number,
    ): Float32Array {
        const A = Math.pow(10, gainDb / 40)
        const w0 = (2 * Math.PI * centerFreq) / this.sampleRate
        const sinW0 = Math.sin(w0)
        const cosW0 = Math.cos(w0)
        const alpha = sinW0 / (2 * Q)

        const b0 = 1 + alpha * A
        const b1 = -2 * cosW0
        const b2 = 1 - alpha * A
        const a0 = 1 + alpha / A
        const a1 = -2 * cosW0
        const a2 = 1 - alpha / A

        return this.biquad(samples, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    /**
     * High-shelf filter (biquad).
     *
     * Boosts or cuts frequencies above a corner frequency.
     */
    private highShelf(
        samples: Float32Array,
        cornerFreq: number,
        gainDb: number,
    ): Float32Array {
        const A = Math.pow(10, gainDb / 40)
        const w0 = (2 * Math.PI * cornerFreq) / this.sampleRate
        const sinW0 = Math.sin(w0)
        const cosW0 = Math.cos(w0)
        const alpha = (sinW0 / 2) * Math.sqrt(2)

        const sqrtA = Math.sqrt(A)
        const b0 = A * ((A + 1) + (A - 1) * cosW0 + 2 * sqrtA * alpha)
        const b1 = -2 * A * ((A - 1) + (A + 1) * cosW0)
        const b2 = A * ((A + 1) + (A - 1) * cosW0 - 2 * sqrtA * alpha)
        const a0 = (A + 1) - (A - 1) * cosW0 + 2 * sqrtA * alpha
        const a1 = 2 * ((A - 1) - (A + 1) * cosW0)
        const a2 = (A + 1) - (A - 1) * cosW0 - 2 * sqrtA * alpha

        return this.biquad(samples, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    /**
     * Apply a biquad filter to samples.
     *
     * Direct Form I implementation.
     */
    private biquad(
        samples: Float32Array,
        b0: number,
        b1: number,
        b2: number,
        a1: number,
        a2: number,
    ): Float32Array {
        const output = new Float32Array(samples.length)
        let x1 = 0
        let x2 = 0
        let y1 = 0
        let y2 = 0

        for (let i = 0; i < samples.length; i++) {
            const x0 = samples[i]
            const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            output[i] = y0

            x2 = x1
            x1 = x0
            y2 = y1
            y1 = y0
        }

        return output
    }

    /**
     * Simple dynamic range compression.
     *
     * Reduces volume of parts above threshold to create even delivery.
     */
    private compress(
        samples: Float32Array,
        ratio: number,
        thresholdDb: number,
    ): Float32Array {
        const output = new Float32Array(samples.length)
        const threshold = Math.pow(10, thresholdDb / 20)

        for (let i = 0; i < samples.length; i++) {
            const sample = samples[i]
            const abs = Math.abs(sample)

            if (abs > threshold) {
                const over = abs - threshold
                const compressed = threshold + over / ratio
                output[i] = sample > 0 ? compressed : -compressed
            } else {
                output[i] = sample
            }
        }

        // Makeup gain to compensate for volume reduction
        const makeupGain = Math.pow(ratio, 0.3)
        for (let i = 0; i < output.length; i++) {
            output[i] *= makeupGain
        }

        return output
    }

    /**
     * Simple reverb via comb filter.
     *
     * Creates a faint room effect — "inside a machine" feel.
     */
    private reverb(
        samples: Float32Array,
        mix: number,
        decayS: number,
    ): Float32Array {
        const output = new Float32Array(samples.length)
        const delaySamples = Math.floor(decayS * this.sampleRate)
        const feedback = 0.3 // Short, tight reverb tail

        // Simple comb filter reverb
        const delayBuffer = new Float32Array(delaySamples).fill(0)
        let writePos = 0

        for (let i = 0; i < samples.length; i++) {
            const delayed = delayBuffer[writePos]
            const wet = delayed * feedback
            delayBuffer[writePos] = samples[i] + wet
            writePos = (writePos + 1) % delaySamples

            // Mix dry and wet signal
            output[i] = samples[i] * (1 - mix) + delayed * mix
        }

        return output
    }
}
