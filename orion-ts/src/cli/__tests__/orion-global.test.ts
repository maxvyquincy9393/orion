import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  buildWhatsAppSelfTestChecks,
  parseOrionCliArgs,
  parseEnvContentLoose,
  findOrionRepoUpwards,
  getProfilePaths,
  isOrionRepoDir,
} from "../../../bin/orion.js"

describe("global orion CLI helpers", () => {
  it("parses repo override and positionals", () => {
    const parsed = parseOrionCliArgs([
      "--repo",
      "C:\\repo\\orion-ts",
      "--profile",
      "C:\\Users\\me\\.orion\\profiles\\test",
      "wa",
      "scan",
    ])

    expect(parsed).toEqual({
      repoOverride: "C:\\repo\\orion-ts",
      profileOverride: "C:\\Users\\me\\.orion\\profiles\\test",
      positionals: ["wa", "scan"],
      help: false,
    })
  })

  it("detects help flag early", () => {
    expect(parseOrionCliArgs(["--help"])).toEqual({
      repoOverride: null,
      profileOverride: null,
      positionals: [],
      help: true,
    })
  })

  it("builds profile-relative env/workspace/state paths", () => {
    const paths = getProfilePaths("C:\\Users\\me\\.orion\\profiles\\default")
    expect(paths.envPath).toContain(`${path.sep}.env`)
    expect(paths.workspaceDir).toContain(`${path.sep}workspace`)
    expect(paths.stateDir).toContain(`${path.sep}.orion`)
  })

  it("parses dotenv-like content for profile env checks", () => {
    const parsed = parseEnvContentLoose([
      "# comment",
      "WHATSAPP_ENABLED=true",
      "WHATSAPP_MODE=baileys",
      "DATABASE_URL=\"file:C:/Users/test profile/orion.db\"",
      "",
    ].join("\n"))

    expect(parsed).toMatchObject({
      WHATSAPP_ENABLED: "true",
      WHATSAPP_MODE: "baileys",
      DATABASE_URL: "file:C:/Users/test profile/orion.db",
    })
  })

  it("reports WhatsApp Cloud config errors when required keys are missing", () => {
    const checks = buildWhatsAppSelfTestChecks(
      {
        WHATSAPP_ENABLED: "true",
        WHATSAPP_MODE: "cloud",
        WHATSAPP_CLOUD_PHONE_NUMBER_ID: "123",
      },
      getProfilePaths("C:\\Users\\me\\.orion\\profiles\\default"),
    )

    expect(checks.some((check) => check.level === "error" && /WHATSAPP_CLOUD_ACCESS_TOKEN/.test(check.detail))).toBe(true)
  })

  it("reports WhatsApp QR scan mode as ready without Cloud API requirements", () => {
    const checks = buildWhatsAppSelfTestChecks(
      {
        WHATSAPP_ENABLED: "true",
        WHATSAPP_MODE: "baileys",
      },
      getProfilePaths("C:\\Users\\me\\.orion\\profiles\\default"),
    )

    expect(checks.find((check) => check.label === "WhatsApp Mode")?.detail).toContain("QR Scan")
    expect(checks.some((check) => check.label === "WhatsApp Cloud Config")).toBe(false)
  })

  it("validates Orion repo by package name", async () => {
    const fsMock = {
      readFile: vi.fn(async (filePath: string) => {
        if (filePath.endsWith(`${path.sep}package.json`)) {
          return JSON.stringify({ name: "orion" })
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      }),
    }

    await expect(isOrionRepoDir("C:\\repo\\orion-ts", fsMock as any)).resolves.toBe(true)
  })

  it("finds nested orion-ts repo while walking upward", async () => {
    const validDirs = new Set([
      path.resolve("C:\\work\\mono\\orion-ts"),
    ])

    const fsMock = {
      readFile: vi.fn(async (filePath: string) => {
        const dir = path.dirname(filePath)
        if (path.basename(filePath) === "package.json" && validDirs.has(dir)) {
          return JSON.stringify({ name: "orion" })
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      }),
    }

    const found = await findOrionRepoUpwards("C:\\work\\mono\\apps\\demo", fsMock as any)
    expect(found).toBe(path.resolve("C:\\work\\mono\\orion-ts"))
  })
})
