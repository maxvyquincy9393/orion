# Phase 11: EDITH Voice (Legacy TARS Preset)

Upgrade from Python-bridge TTS to a native TypeScript voice engine branded as EDITH voice, currently powered by the legacy TARS preset.

## Architecture

```
BEFORE:  bridge.ts → execa("python") → voice.py → audio
AFTER:   bridge.ts → EdgeEngine (msedge-tts) → DSP → audio
```

## Components

| File | Purpose |
|---|---|
| `src/voice/edge-engine.ts` | Microsoft Edge neural TTS (free, no API key, no GPU) |
| `src/voice/dsp.ts` | Audio post-processing (EQ, compression, reverb) |
| `src/voice/tars-preset.ts` | TARS voice config + DSP preset |
| `src/voice/bridge.ts` | Orchestrator (Edge primary, Python fallback) |

## TARS Voice Design

TARS isn't a heavy-robotic voice — he's warm, confident, with dry wit:

- **Voice:** `en-US-GuyNeural` (calm, professional male)
- **Rate:** `-8%` (slightly measured pacing)
- **Pitch:** `-5Hz` (slightly lower, authoritative)
- **DSP:** subtle metallic EQ, light compression, micro-reverb

## Configuration (`.env`)

```env
VOICE_ENABLED=true
VOICE_TTS_BACKEND=edge           # "edge" (native TS) or "python" (legacy)
VOICE_EDGE_VOICE=en-US-GuyNeural # Any Edge neural voice
VOICE_EDGE_RATE=-8%              # SSML rate adjustment
VOICE_EDGE_PITCH=-5Hz            # SSML pitch adjustment
VOICE_DSP_ENABLED=true           # Apply TARS DSP effects
VOICE_DSP_PRESET=tars            # "tars" or "clean"
```

## Alternative Voices

Test these for best TARS match:
- `en-US-DavisNeural` — deeper, more serious
- `en-US-JasonNeural` — conversational
- `en-US-TonyNeural` — warm, friendly

## Research References

- arXiv 2508.04721 — Low-Latency Voice Agents (concurrent pipeline)
- arXiv 2509.15969 — VoXtream streaming TTS (first-packet latency)
