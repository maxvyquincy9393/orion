# Phase 5 Security Overview

## Scope
Phase 5 hardens inbound prompts, tool execution, memory injection, sender trust, and per-session messaging behavior.

## Threat Model
- Direct prompt injection in user message.
- Indirect prompt injection from tool/web output.
- Unsafe tool arguments (command injection, path traversal, SSRF).
- Unauthorized sender attempts through external channels.
- Excessive message flooding that degrades availability.
- Poisoned memory entries reintroduced into LLM context.

## Security Layers
1. Pairing check
- Unknown sender must be approved by owner.
- Pairing code is time-bound and one-time approval path.

2. Session send policy
- Per user and channel request throttling.
- Length caps to reduce abuse and accidental overload.

3. Prompt filtering
- Pattern scan for direct jailbreak and role hijack.
- Sanitization instead of hard-block by default.

4. Memory validation
- Memory snippets scanned before context assembly.
- Suspicious snippets dropped from prompt context.

5. Tool guard
- Terminal command deny patterns.
- File path guard against sensitive paths and traversal.
- URL guard against internal network SSRF targets.

6. Result filtering
- Tool output scanned to reduce second-order injection.

## Core Data Flow
1. Channel receives message.
2. Pairing and rate policy checked.
3. Prompt filter sanitizes message.
4. Memory/context assembled with validation.
5. LLM response and optional tool calls.
6. Tool guard checks each tool input.
7. Tool output passes result filter.
8. Response sent and persisted with metadata.

## Logging and Observability
- All blocks/warnings logged with component namespace.
- Metadata includes userId, channel, and reason.
- Non-fatal filtering events remain auditable.

## Non-Goals
- Full malware sandboxing.
- Human-authored policy language for every tool edge case.
- Perfect semantic detection of all jailbreak variants.

## Residual Risks
- Novel injection patterns may bypass regex-only detection.
- External channel identity assumptions may vary by provider.
- Tool wrappers rely on strict usage path; bypasses must be code-reviewed.

## Required Validation
- Prompt filter unit tests for known payload classes.
- Tool guard tests for command/path/url policy.
- End-to-end tests with malicious link summary payloads.
- Pairing approval lifecycle tests.
