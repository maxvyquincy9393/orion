## What does this PR do?

<!-- One paragraph description of the change. What problem does it solve? -->

## Changes

<!-- Bullet list of the main changes. Be specific. -->

-
-
-

## Phase / Feature

<!-- If this implements a phase from the roadmap, mention it. -->

Phase #: ___ — ___

## Testing

<!-- How was this tested? What commands were run? -->

```bash
pnpm test
pnpm typecheck
```

**Test results:**

- [ ] All existing tests pass (`pnpm test`)
- [ ] TypeScript is clean (`pnpm typecheck`)
- [ ] New tests added for new functionality (if applicable)

## Checklist

- [ ] Code follows project standards (file-level JSDoc, method JSDoc, `createLogger`, `.js` imports)
- [ ] No `any` types or untyped returns
- [ ] No `console.log` — using `createLogger` throughout
- [ ] Fire-and-forget patterns use `void fn().catch(...)`
- [ ] New Prisma models have a migration (`prisma migrate dev`)
- [ ] New environment variables added to `src/config.ts` ConfigSchema
- [ ] Documentation updated if needed
- [ ] No secrets or `.env` files committed

## Related Issues

<!-- Link related issues: Closes #123, Fixes #456 -->
