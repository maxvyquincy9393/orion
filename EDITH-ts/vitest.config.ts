import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      exclude: [
        "src/channels/**",
        "src/config.ts",
        "src/mcp/**",
        "src/voice/**",
      ],
      thresholds: {
        lines: 35,
      },
    },
  },
})
