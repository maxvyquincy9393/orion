# Voice Troubleshooting

## Qwen3 Not Detected
- Symptom: backend logs show `xtts`.
- Action: verify `qwen3_tts` install in active Python env.

## Python Bridge Fails
- Symptom: `speak failed` or `speakStreaming failed`.
- Action: verify `PYTHON_PATH`, import dependencies, run manual python command.

## No Audio Playback
- Symptom: synthesis succeeds but no audible output.
- Action: check audio device, permissions, and sounddevice installation.

## Streaming Chunks Missing
- Symptom: no `onChunk` callbacks.
- Action: verify python callback emits lines and flushes stdout.

## Voice Profile Not Applied
- Symptom: default voice used unexpectedly.
- Action: verify profile path contains `reference.wav`.

## Recommended Diagnostics
- `pnpm doctor`
- `python -m compileall delivery/voice.py`
- direct one-line python invocation for VoicePipeline methods
