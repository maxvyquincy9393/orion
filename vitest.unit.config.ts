/**
 * @file vitest.unit.config.ts
 * @description Fast unit test config — excludes channels and gateway integration tests.
 */

import path from "path"
import { defineConfig } from "vitest/config"
import type { Plugin } from "vite"

const stripShebangPlugin: Plugin = {
  name: "strip-shebang",
  enforce: "pre",
  transform(code) {
    if (code.charCodeAt(0) === 35 && code.charCodeAt(1) === 33) {
      const newlineIdx = code.indexOf("\n")
      if (newlineIdx === -1) return { code: "" }
      return { code: `// (shebang stripped)\n${code.slice(newlineIdx + 1)}` }
    }
  },
}

export default defineConfig({
  plugins: [stripShebangPlugin],
  resolve: {
    alias: {
      "react-native": path.resolve(__dirname, "apps/mobile/__mocks__/react-native.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [
      "src/channels/**/*.test.ts",
      "src/gateway/**/*.test.ts",
      "src/**/*.e2e.test.ts",
      "src/**/*.live.test.ts",
    ],
  },
})
