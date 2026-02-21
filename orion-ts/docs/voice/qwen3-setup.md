# Qwen3 Setup

## Install
```bash
python -m pip install git+https://github.com/QwenLM/Qwen3-TTS
```

## Environment
```env
VOICE_ENABLED=true
PYTHON_PATH=python
QWEN3_MODE=latency
```

## Backend Selection
- If `qwen3_tts` import succeeds, backend is `qwen3`.
- Else backend is `xtts`.

## Verification
1. Run Python import check.
2. Run Orion voice test call.
3. Confirm logs show selected backend.

## Notes
- Keep XTTS dependencies installed if fallback is desired.
- Tune mode per deployment profile.
