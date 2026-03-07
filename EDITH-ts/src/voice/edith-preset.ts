/**
 * edith-preset.ts — EDITH voice configuration.
 *
 * Defines voice parameters and DSP settings to achieve a EDITH-like voice:
 * warm, natural, confident, measured cadence, with subtle AI character.
 *
 * Part of EDITH — Persistent AI Companion System.
 */

/**
 * Edge TTS voice settings tuned for EDITH personality.
 *
 * EDITH is NOT a heavy-robotic voice — he's a warm, confident AI
 * with dry wit and measured delivery (voiced by Bill Irwin).
 */
export const EDITH_VOICE = {
    /** Microsoft Edge neural voice — calm, professional male */
    voice: "en-US-GuyNeural",
    /** Slightly slower for measured EDITH cadence */
    rate: "-8%",
    /** Slightly lower pitch — authoritative */
    pitch: "-5Hz",
    /** Normal volume */
    volume: "+0%",
} as const

/**
 * Alternative voices to A/B test for EDITH character:
 * - "en-US-DavisNeural"  → deeper, more serious
 * - "en-US-JasonNeural"  → conversational, warm
 * - "en-US-TonyNeural"   → friendly, approachable
 * - "en-US-BrandonNeural" → younger, crisp
 */
export const EDITH_ALT_VOICES = [
    "en-US-DavisNeural",
    "en-US-JasonNeural",
    "en-US-TonyNeural",
    "en-US-BrandonNeural",
] as const

/** DSP post-processing preset for adding subtle AI character. */
export interface DSPPreset {
    /** Mid-frequency EQ center (Hz) — metallic clarity */
    eqMidFreqHz: number
    /** Mid-frequency EQ gain (dB) */
    eqMidGainDb: number
    /** EQ Q factor (bandwidth) */
    eqQ: number
    /** High-shelf EQ gain (dB) — presence boost */
    eqHighShelfDb: number
    /** High-shelf corner frequency (Hz) */
    eqHighShelfHz: number
    /** Compression ratio */
    compressionRatio: number
    /** Compression threshold (dB) */
    compressionThresholdDb: number
    /** Reverb wet/dry mix (0-1) */
    reverbMix: number
    /** Reverb decay time (seconds) */
    reverbDecayS: number
}

/** EDITH DSP preset — subtle, warm, slightly metallic. */
export const EDITH_DSP: DSPPreset = {
    eqMidFreqHz: 3200,
    eqMidGainDb: 2,
    eqQ: 1.5,
    eqHighShelfDb: 1.5,
    eqHighShelfHz: 6000,
    compressionRatio: 1.8,
    compressionThresholdDb: -18,
    reverbMix: 0.02,
    reverbDecayS: 0.15,
}

/** No DSP — clean pass-through. */
export const CLEAN_DSP: DSPPreset = {
    eqMidFreqHz: 3200,
    eqMidGainDb: 0,
    eqQ: 1,
    eqHighShelfDb: 0,
    eqHighShelfHz: 6000,
    compressionRatio: 1,
    compressionThresholdDb: 0,
    reverbMix: 0,
    reverbDecayS: 0,
}
