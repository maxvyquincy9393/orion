# Phase 7 Content Intelligence

## Scope
Add structured understanding for links, image/audio input, and channel-aware markdown rendering.

## Components
- `link-understanding/extractor.ts`
- `link-understanding/summarizer.ts`
- `media-understanding/image.ts`
- `media-understanding/audio.ts`
- `markdown/processor.ts`

## Main Flow
1. Gateway receives user message.
2. URL extractor finds candidate links.
3. Fetch + sanitize link content with limits.
4. Summarizer produces short context for each link.
5. Enriched prompt sent to orchestrator.
6. Response rendered per destination channel markdown format.

## Constraints
- Network timeouts for fetch operations.
- Max fetched content size.
- Domain/IP guards to reduce SSRF risk.
- Channel formatting fallback to plain text on conversion edge cases.
