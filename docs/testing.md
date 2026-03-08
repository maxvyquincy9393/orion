# Testing Guide

## Running Tests

```bash
# Run all tests
pnpm test

# Run a specific module
pnpm vitest run src/memory/__tests__/

# Run with watch mode
pnpm vitest

# TypeScript type check (must pass before commit)
pnpm typecheck
```

## Test File Convention

`src/[module]/__tests__/[file].test.ts`

## Minimal Test Structure

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('MyService', () => {
  it('does the thing correctly', async () => {
    // arrange → act → assert
  })
})
```

## Mocking Prisma

```typescript
vi.mock('../../database/index.js', () => ({
  prisma: {
    myModel: {
      create: vi.fn().mockResolvedValue({ id: 'test-id' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))
```

## CI Requirements

Both `pnpm typecheck` and `pnpm test` must pass with 0 errors before merging.
