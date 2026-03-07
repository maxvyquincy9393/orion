# Phase 8 Developer Platform

## Scope
Provide extension and automation platform with secure inter-agent communication.

## Components
- Hook registry and pipeline.
- Plugin SDK and loader.
- ACP protocol and router with signing/state checks.
- CLI doctor diagnostics.

## Design Principles
- Strong defaults for security-sensitive paths.
- Explicit extension lifecycle.
- Auditable inter-agent state transitions.
- Clear operator diagnostics.

## Integration Points
- Gateway runs message hooks.
- Main bootstraps plugin loading.
- Runner and daemon register as ACP agents.
