import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/channels/**/__tests__/**/*.test.ts'],
    testTimeout: 30000,
  },
})
