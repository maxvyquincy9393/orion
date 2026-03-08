# Contributing to EDITH

Thank you for your interest in contributing to EDITH — the JARVIS-grade AI companion.

## Development Setup

```bash
git clone <repo>
cd EDITH
pnpm install
cp .env.example .env
# Edit .env with your API keys
pnpm dev
```

## Code Standards

- TypeScript strict mode — no `any`, explicit return types
- Every file: file-level JSDoc header + `createLogger`
- Imports: `.js` extension required (ESM)
- Tests: write before or alongside implementation

## Pull Request Process

1. Fork the repo and create a feature branch
2. Write tests for your changes
3. Run `pnpm typecheck && pnpm test` — both must pass
4. Submit PR with a clear description

## Commit Convention

```
feat(scope): add new feature
fix(scope): fix a bug
docs: update documentation
refactor(scope): refactor code
test(scope): add tests
chore: maintenance tasks
```

Scopes: `memory | core | voice | channels | background | engines | security | api`

## Architecture Overview

See `CLAUDE.md` for the full architecture guide.
