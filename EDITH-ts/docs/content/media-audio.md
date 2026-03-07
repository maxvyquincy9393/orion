# Media Understanding: Audio

File: `src/media-understanding/audio.ts`

## Objective
Transcribe external audio source through voice bridge.

## Flow
1. Audio source passed to transcriber.
2. Delegates to `voice.transcribe(audioSource)`.
3. Python bridge invokes voice pipeline transcription.

## Error Handling
- Empty/failed transcription returns safe fallback string.
- Bridge errors are logged.

## Extension Points
- Add content-type validation for source.
- Add chunked streaming transcription for long files.
