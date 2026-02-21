# Operations Runbook

## Daily Checks
1. Run `pnpm doctor`.
2. Inspect logs for security warnings and channel errors.
3. Verify daemon health endpoint via gateway.

## Startup Procedure
1. Ensure env and credentials loaded.
2. Apply migrations if schema changed.
3. Start Orion in target mode.
4. Validate connected channels list.

## Incident Handling
- Follow `docs/security/incident-runbook.md`.
- Disable risky channels/tools first.
- Preserve logs and DB snapshot before remediation.

## Maintenance Tasks
- Rotate API credentials on schedule.
- Review pairing approvals and revoke stale users.
- Check memory maintenance execution cadence.
- Validate plugin inventory and versions.

## Deployment Checklist
- `pnpm typecheck` clean.
- Migration status current.
- Doctor output has zero errors.
- Smoke test for each enabled channel.
- Voice fallback validated in environment.

## Recovery
- Restore DB backup if migration/data corruption occurs.
- Revert to previous release tag if critical regression detected.
- Re-run post-recovery validation checks.
