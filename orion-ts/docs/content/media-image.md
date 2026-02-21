# Media Understanding: Image

File: `src/media-understanding/image.ts`

## Objective
Analyze images by routing to multimodal-capable engine.

## Source Detection
- URL source (`http/https`).
- Base64 data URL source.
- Unknown source rejected.

## Behavior
1. Detect source type.
2. Build analysis prompt.
3. Route via `orchestrator.route("multimodal")`.
4. Return generated description or error-safe fallback text.

## Notes
- Current implementation sends reference text context to multimodal provider adapter.
- Engine-specific binary upload handling can be extended later.
