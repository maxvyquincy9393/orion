# Contributing to EDITH

Thank you for your interest in contributing to EDITH — a persistent AI companion built on TypeScript, Prisma, and Python sidecars.

---

## Table of Contents

1. [Project Setup](#project-setup)
2. [Code Standards](#code-standards)
3. [Testing](#testing)
4. [Git Workflow](#git-workflow)
5. [Phase Implementation Process](#phase-implementation-process)
6. [Pull Request Guidelines](#pull-request-guidelines)

---

## Project Setup

**Requirements:**
- Node.js >= 20
- Python >= 3.10 (for sidecars)
- pnpm >= 9 — **do not use npm or yarn**

```bash
# 1. Clone the repo
git clone https://github.com/maxvyquincy9393/orion.git
cd orion

# 2. Install dependencies
pnpm install

# 3. Copy env file and fill in your secrets
cp .env.example .env

# 4. Generate Prisma client and run migrations
npx prisma generate
npx prisma migrate dev

# 5. Start EDITH in dev mode
pnpm dev
```

**Optional:** Install Python dependencies for voice/vision sidecars:

```bash
pip install -r python/requirements.txt
```

---

## Code Standards

All contributions **must** follow these standards. PRs that do not will be asked to revise.

### 1. File-level JSDoc (required on every new file)

```typescript
/**
 * @file my-module.ts
 * @description One clear sentence about what this file does.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Describe relationships with other files here.
 *
 * PAPER BASIS (if applicable):
 *   - Paper Name: arXiv:XXXX.XXXXX — contribution to this implementation
 */
```

### 2. JSDoc on every class, method, and constant

```typescript
/** Maximum retry attempts before circuit breaker activates. */
private static readonly MAX_RETRIES = 3

/**
 * Builds the persona fragment for this user.
 * @param userId - User identifier
 * @returns Persona fragment string for injection into system prompt
 */
async buildPersonaFragment(userId: string): Promise<string>
```

### 3. TypeScript strict — no `any`, no untyped returns

```typescript
// BAD
async function getData(id) { return fetch(...) }

// GOOD
async function getData(id: string): Promise<UserData | null> { ... }
```

### 4. Logger — always use `createLogger`, never `console.log`

```typescript
import { createLogger } from "../logger.js"
const log = createLogger("module.submodule")

log.debug("detail info", { userId, data })
log.info("operation complete", { count })
log.warn("non-fatal issue", { error })
log.error("fatal error", { userId, error })
```

### 5. Error handling — never leave Promises floating

```typescript
// Fire-and-forget (MUST use void + catch)
void someAsyncFn(userId)
  .catch(err => log.warn("operation failed", { userId, err }))

// Awaited
try {
  await someAsyncFn()
} catch (err) {
  log.error("critical failure", { err })
  throw err
}
```

### 6. ESM imports — always use `.js` extension

```typescript
import { createLogger } from "../logger.js"   // correct
import { createLogger } from "../logger"       // wrong
```

### 7. Singleton pattern for service classes

```typescript
class MyService { ... }
export const myService = new MyService()
```

---

## Testing

```bash
# Run all tests
pnpm test

# Run a specific test directory
pnpm vitest run src/memory/__tests__/

# TypeScript type check (must be clean before committing)
pnpm typecheck

# Run health check
pnpm run doctor
```

**Test file convention:** `src/[module]/__tests__/[file].test.ts`

**Minimal test structure:**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('MyService', () => {
  it('does the thing correctly', async () => {
    // arrange
    const input = 'test'
    // act
    const result = await myService.process(input)
    // assert
    expect(result).toBe('expected')
  })
})
```

**Rules:**
- Write tests alongside or before the code (not after)
- `pnpm typecheck` must pass before pushing
- Do not commit if tests are failing

---

## Git Workflow

**Active branch:** `design`

We use [Conventional Commits](https://www.conventionalcommits.org/):

```bash
# Format: type(scope): description
git commit -m "feat(memory): add UserPreferenceEngine with CIPHER preference inference"
git push origin design

# Types
feat      # new feature
fix       # bug fix
docs      # documentation
refactor  # code change without feature/fix
test      # adding or updating tests
chore     # maintenance, deps, tooling

# Scopes
memory | core | voice | channels | background | engines | security | daemon | gateway
```

**Never commit:**
- `.env` files
- `node_modules/`
- `*.db` files
- `logs/`
- `coverage/`

---

## Phase Implementation Process

EDITH is built in phases. Each phase has a specification document in `docs/plans/`.

1. **Read the plan first:** `docs/plans/PHASE-[N]-[NAME].md`
2. **Understand dependencies:** What does Phase N need from previous phases?
3. **Check existing files:** Use `Read` before creating — extend, don't replace
4. **Implement per Atom:** Each atom in the spec = one focused change
5. **Commit each Atom:** 1 atom = 1 commit with a clear message
6. **Write tests:** Write them alongside the code
7. **Typecheck:** `pnpm typecheck` must be green before pushing

---

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Reference the phase number in the title if applicable (e.g., `feat(daemon): Phase 44 — ...`)
- Fill out the PR template completely
- All tests must pass (`pnpm test`)
- TypeScript must be clean (`pnpm typecheck`)
- New public APIs need JSDoc
- New files need file-level JSDoc

---

## Questions?

Open a discussion or issue on GitHub. For security issues, see [SECURITY.md](SECURITY.md).
