# Testing Guide

EDITH uses [Vitest](https://vitest.dev/) as its test runner. All tests are co-located with source files in `__tests__/` subdirectories.

---

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm vitest

# Run a specific test directory
pnpm vitest run src/memory/__tests__/

# Run a specific file
pnpm vitest run src/channels/__tests__/outbox.test.ts

# TypeScript type check (must be clean before committing)
pnpm typecheck
```

---

## Test Configurations

EDITH ships with three Vitest configs for different scopes:

| Config | Command | Purpose |
|--------|---------|---------|
| `vitest.config.ts` | `pnpm test` | All tests |
| `vitest.unit.config.ts` | `pnpm test:unit` | Unit tests only (no I/O) |
| `vitest.integration.config.ts` | `pnpm test:integration` | Integration tests (may need env vars) |

---

## Writing New Tests

**File location convention:**

```
src/[module]/__tests__/[file].test.ts
```

**Minimal test structure:**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('MyService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does the thing correctly', async () => {
    // arrange
    const input = 'test-input'

    // act
    const result = await myService.process(input)

    // assert
    expect(result).toBe('expected-output')
  })

  it('handles errors gracefully', async () => {
    await expect(myService.process('')).rejects.toThrow('Invalid input')
  })
})
```

---

## Mock Patterns

### Mocking Prisma

```typescript
import { vi } from 'vitest'

vi.mock('../../database/index.js', () => ({
  db: {
    userPreference: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}))
```

### Mocking the LLM Orchestrator

```typescript
vi.mock('../../engines/orchestrator.js', () => ({
  orchestrator: {
    generate: vi.fn().mockResolvedValue({ content: 'mocked response' }),
    getLastUsedEngine: vi.fn().mockReturnValue('groq'),
  },
}))
```

### Mocking the Logger

```typescript
vi.mock('../../logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))
```

### Mocking Time (for time-sensitive tests)

```typescript
import { vi, beforeEach, afterEach } from 'vitest'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})
```

---

## Testing Async / Fire-and-Forget

For services that use fire-and-forget patterns, flush the microtask queue explicitly:

```typescript
import { flushPromises } from '@vue/test-utils'
// or just:
await Promise.resolve()
// or for multiple async layers:
await new Promise(resolve => setTimeout(resolve, 0))
```

---

## Coverage

```bash
pnpm vitest run --coverage
```

Coverage reports are written to `coverage/`. The `coverage/` directory is gitignored.

---

## Test File Examples

| File | What it tests |
|------|--------------|
| `src/memory/__tests__/store.test.ts` | LanceDB vector store operations |
| `src/channels/__tests__/outbox.test.ts` | Transactional outbox retry/dead-letter |
| `src/security/__tests__/camel-guard.test.ts` | CaMeL taint tracking |
| `src/agents/legion/__tests__/legion.test.ts` | Iron Legion auth, routing, CRDT |
| `src/simulation/__tests__/simulation.test.ts` | Action classifier, VirtualFS, snapshots |
| `src/sessions/__tests__/cross-device.test.ts` | PresenceManager, ConversationSync |

---

## Rules

- Write tests alongside or before the code — not after
- `pnpm typecheck` must pass before pushing
- Do not commit if tests are failing
- Mock all external I/O (database, network, filesystem) in unit tests
- Integration tests may use the real SQLite database via a test-specific `DATABASE_URL`
