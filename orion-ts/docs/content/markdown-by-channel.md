# Markdown By Channel

File: `src/markdown/processor.ts`

## Channel Mapping
- discord: pass-through markdown.
- telegram: convert markdown-like markers to HTML tags.
- slack: normalize to `*bold*`, `_italic_`, and slack-compatible style.
- whatsapp: same style as slack-like conversion.
- webchat: pass-through.
- cli: strip formatting to plain text.
- signal/line/matrix/teams/imessage: currently use slack-like conversion path.

## Processor Contract
`process(markdown, channel) -> string`

## Integration
Called in channel `send()` before delivery.

## Safety Notes
- Formatting conversion should not modify semantic content.
- Code block conversion should preserve readability.
