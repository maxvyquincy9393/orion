# Phase 10 Voice Upgrade

## Goal
Upgrade TTS stack for low-latency streaming while preserving backward compatibility.

## Changes
- Python voice pipeline supports Qwen3-TTS when available.
- Automatic fallback to XTTS-v2 if Qwen3 unavailable or runtime failure.
- New streaming API in Python: `speak_streaming(text, voice_profile, callback)`.
- TypeScript bridge adds `speakStreaming()` to process chunked audio.

## Compatibility
- Existing `VoicePipeline().speak(text, voice_profile)` remains available.
- Existing non-streaming flows continue to function.

## Latency Modes
- `QWEN3_MODE=latency` for faster first chunk.
- `QWEN3_MODE=quality` for better synthesis quality.

## Safety and Resilience
- Runtime fallback prevents hard failure on missing backend.
- Streaming chunk decode errors are logged and skipped.
