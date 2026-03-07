# Voice Bridge Streaming Protocol

Files:
- `src/voice/bridge.ts`
- `delivery/voice.py`

## TS API
`voice.speakStreaming(text, voiceProfile, onChunk)`

## Transport
- Bridge spawns Python process.
- Python callback emits base64 per chunk on stdout.
- TS reads stdout line-by-line and decodes each chunk to `Buffer`.

## Protocol Requirements
- One base64 audio chunk per line.
- Flush stdout after each emitted chunk.
- Empty lines ignored.

## Error Handling
- Decode errors logged and skipped.
- Process-level failure logs `speakStreaming failed`.

## Consumer Contract
`onChunk` must be non-blocking to avoid backpressure bottleneck.
