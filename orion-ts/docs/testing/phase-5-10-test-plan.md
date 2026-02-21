# Phase 5-10 Test Plan

## Security Tests (Phase 5)
- Prompt filter detection and sanitization vectors.
- Tool guard command/path/url positive and negative cases.
- Pairing lifecycle and revocation tests.
- Provenance tagging presence in persisted metadata.

## Memory Tests (Phase 6)
- Temporal complexity routing and level filters.
- Consolidation at 50 raw nodes and expiry checks.
- Profiler extraction/merge confidence behavior.
- Session summarizer threshold and context replacement.
- ProMem iterative rounds and verification fallback.
- Causal graph edge/hyper-edge updates and hybrid retrieval.

## Content Tests (Phase 7)
- URL extraction edge cases.
- Timeout and max content clipping behavior.
- Summarizer enrichment fallback path.
- Markdown conversion snapshots per channel.

## Platform Tests (Phase 8)
- Hook ordering and abort semantics.
- Plugin loader directory scan and invalid plugin handling.
- ACP signature validation and state transition enforcement.
- Doctor command outputs and exit codes.

## Channel Tests (Phase 9)
- Start/stop behavior with missing config.
- send() success/fail per transport.
- chunk splitting and long message behavior.
- sendWithConfirm timeout and confirmation parse.

## Voice Tests (Phase 10)
- Backend selection with and without qwen3 package.
- speak() backward compatibility.
- speak_streaming callback chunk sequence.
- TS bridge base64 chunk decode path.

## Commands
```bash
pnpm typecheck
pnpm test
pnpm doctor
python -m compileall delivery/voice.py
```
