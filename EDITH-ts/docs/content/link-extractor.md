# Link Extractor

File: `src/link-understanding/extractor.ts`

## Responsibilities
- Detect URLs from free-form text.
- Filter blocked domains and internal targets.
- Fetch webpage content with timeout and size cap.
- Strip noisy HTML sections.
- Cache results in memory for one hour.

## Rules
- Timeout: 10 seconds.
- Max content: 10,000 chars.
- Max URLs processed per message: bounded.
- Blocked targets include localhost and private ranges.

## Return Shape
`{ title, text, url } | null`

## Failure Handling
- Invalid URL: skip.
- Non-200 response: log warn and return null.
- Fetch errors: log error and return null.

## Security Notes
- URL rechecked with guard before fetch.
- Content is text-only for downstream summarization.
