# PR Checklist

## Pre-flight
- [ ] No debug/console.log statements left
- [ ] No hardcoded secrets/keys
- [ ] No TODO/FIXME without issue reference

## Quality Gates
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes (if configured)
- [ ] No unused imports/variables

## Testing
- [ ] Unit tests pass (if applicable)
- [ ] Integration tests pass (if applicable)
- [ ] Manual smoke test for critical paths

## Documentation
- [ ] Workspace docs updated (if behavior changed)
- [ ] Commit message follows conventional format

## Review
- [ ] Self-reviewed changes
- [ ] No unrelated file changes in same PR
- [ ] PR scope is focused (one concern per PR)

## Migration (if schema changed)
- [ ] Database migration created
- [ ] Rollback note added
- [ ] Migration tested locally
