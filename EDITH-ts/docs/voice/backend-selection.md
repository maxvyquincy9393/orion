# Voice Backend Selection

File: `delivery/voice.py`

## Selection Logic
1. Try import `qwen3_tts`.
2. If available, set `TTS_BACKEND=qwen3`.
3. Else set `TTS_BACKEND=xtts`.

## Speak Path
- Preferred: `_qwen3_generate()`
- Fallback: `_xtts_generate()`

## Streaming Path
- Preferred: `_qwen3_stream()`
- Fallback: emit one XTTS full-audio chunk

## Voice Profiles
- Non-default profile resolves to reference wav if present.
- Missing profile reference falls back to default voice behavior.

## Observability
Startup logs include selected backend and mode.
