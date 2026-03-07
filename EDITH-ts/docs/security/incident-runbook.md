# Security Incident Runbook

## Trigger Conditions
- Repeated prompt injection detections.
- Unexpected tool guard blocks from trusted user path.
- ACP signature failures or invalid state transitions.
- Suspicious memory entries repeatedly flagged.

## Immediate Actions
1. Preserve logs and stop auto-cleanup where possible.
2. Switch daemon proactive actions to safe mode.
3. Disable high-risk tools (terminal/write) temporarily.
4. Review recent inbound content and tool outputs.

## Investigation Steps
1. Collect timeline
- gateway events
- prompt filter warnings
- tool guard blocks
- ACP audit entries

2. Trace provenance
- identify source type of suspicious payload.
- verify whether payload originated from tool/webhook.

3. Validate credentials and sender identity
- pairing approvals
- channel auth settings
- token rotation status

## Containment Options
- Revoke affected channel users.
- Rotate external API credentials.
- Disable plugin loading if plugin compromise suspected.

## Recovery
- Patch detection/guard rules.
- Re-enable components gradually.
- Run targeted regression tests.

## Postmortem Template
- incident summary
- root cause
- blast radius
- mitigations
- follow-up actions with owners
