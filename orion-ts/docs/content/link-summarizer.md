# Link Summarizer

File: `src/link-understanding/summarizer.ts`

## Responsibilities
- Summarize fetched link content into concise context.
- Return enriched message payload with summaries attached.

## API
- `summarize({ title, text, url })`
- `processMessage(message)`

## Process
1. Extract URLs from message.
2. Fetch content for each URL (bounded count).
3. Summarize each document using fast model route.
4. Build `enrichedContext` by appending summary blocks.

## Output Contract
- `original`
- `linkSummaries[]`
- `enrichedContext`

## Integration
Gateway uses `enrichedContext` as model prompt input while preserving original user text persistence.

## Failure Behavior
If all fetch/summarize steps fail, returns original message unchanged.
