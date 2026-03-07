import { describe, expect, it } from "vitest"

import {
  guardTerminal,
  guardFilePath,
  guardUrl,
} from "../tool-guard.js"

// ─────────────────────────────────────────────────────────────────────────────
// guardTerminal
// ─────────────────────────────────────────────────────────────────────────────

describe("guardTerminal", () => {
  it("allows safe commands", () => {
    expect(guardTerminal("ls -la", "u1").allowed).toBe(true)
    expect(guardTerminal("echo hello", "u1").allowed).toBe(true)
    expect(guardTerminal("cat file.txt", "u1").allowed).toBe(true)
    expect(guardTerminal("node index.js", "u1").allowed).toBe(true)
    expect(guardTerminal("npm install express", "u1").allowed).toBe(true)
  })

  it("blocks destructive rm commands", () => {
    expect(guardTerminal("rm -rf /", "u1").allowed).toBe(false)
    expect(guardTerminal("rm -rf /*", "u1").allowed).toBe(false)
    expect(guardTerminal("sudo rm -rf /home", "u1").allowed).toBe(false)
  })

  it("blocks fork bombs", () => {
    // The exact BLOCKED_COMMANDS entry is ":(){:|:&};:"
    const result = guardTerminal(":(){:|:&};:", "u1")
    expect(result.allowed).toBe(false)
  })

  it("blocks dangerous dd commands", () => {
    expect(guardTerminal("dd if=/dev/zero of=/dev/sda", "u1").allowed).toBe(false)
    expect(guardTerminal("dd if=/dev/urandom of=disk.img", "u1").allowed).toBe(false)
  })

  it("blocks dangerous command chains", () => {
    expect(guardTerminal("echo test | rm -rf /", "u1").allowed).toBe(false)
    expect(guardTerminal("ls && shutdown now", "u1").allowed).toBe(false)
    expect(guardTerminal("foo; rm -rf /", "u1").allowed).toBe(false)
  })

  it("blocks command substitution patterns", () => {
    expect(guardTerminal("echo $(cat /etc/passwd)", "u1").allowed).toBe(false)
    expect(guardTerminal("echo `whoami`", "u1").allowed).toBe(false)
  })

  it("blocks excessive path traversal", () => {
    expect(guardTerminal("cat ../../../etc/passwd", "u1").allowed).toBe(false)
  })

  it("allows minor path traversal (less than 3)", () => {
    expect(guardTerminal("cat ../file.txt", "u1").allowed).toBe(true)
    expect(guardTerminal("cat ../../dir/file.txt", "u1").allowed).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// guardFilePath
// ─────────────────────────────────────────────────────────────────────────────

describe("guardFilePath", () => {
  it("allows normal file paths", () => {
    expect(guardFilePath("/home/user/project/file.ts", "read", "u1").allowed).toBe(true)
    expect(guardFilePath("/tmp/data.json", "write", "u1").allowed).toBe(true)
  })

  it("blocks access to system directories", () => {
    expect(guardFilePath("/etc/passwd", "read", "u1").allowed).toBe(false)
    expect(guardFilePath("/sys/kernel", "read", "u1").allowed).toBe(false)
    expect(guardFilePath("/boot/grub", "read", "u1").allowed).toBe(false)
    expect(guardFilePath("/proc/self", "read", "u1").allowed).toBe(false)
  })

  it("blocks access to Windows system directories", () => {
    expect(guardFilePath("C:\\Windows\\System32", "read", "u1").allowed).toBe(false)
    expect(guardFilePath("C:\\Program Files\\app", "write", "u1").allowed).toBe(false)
  })

  it("blocks sensitive files", () => {
    expect(guardFilePath("/home/user/.env", "read", "u1").allowed).toBe(false)
    expect(guardFilePath("/home/user/.ssh", "read", "u1").allowed).toBe(false)
    expect(guardFilePath("/app/credentials.json", "read", "u1").allowed).toBe(false)
    expect(guardFilePath("/home/.aws/credentials", "read", "u1").allowed).toBe(false)
  })

  it("blocks excessive path traversal", () => {
    expect(guardFilePath("../../../etc/passwd", "read", "u1").allowed).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// guardUrl
// ─────────────────────────────────────────────────────────────────────────────

describe("guardUrl", () => {
  it("allows standard external URLs", () => {
    expect(guardUrl("https://example.com").allowed).toBe(true)
    expect(guardUrl("https://api.openai.com/v1/chat").allowed).toBe(true)
    expect(guardUrl("http://external-service.io/data").allowed).toBe(true)
  })

  it("blocks file protocol", () => {
    const result = guardUrl("file:///etc/passwd")
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("file://")
  })

  it("blocks localhost SSRF", () => {
    expect(guardUrl("http://localhost:8080/admin").allowed).toBe(false)
    expect(guardUrl("http://127.0.0.1:3000").allowed).toBe(false)
    expect(guardUrl("http://0.0.0.0:80").allowed).toBe(false)
  })

  it("blocks internal network IPs", () => {
    expect(guardUrl("http://10.0.0.1/internal").allowed).toBe(false)
    expect(guardUrl("http://192.168.1.1").allowed).toBe(false)
    expect(guardUrl("http://172.16.0.1").allowed).toBe(false)
  })

  it("blocks link-local addresses", () => {
    expect(guardUrl("http://169.254.169.254/metadata").allowed).toBe(false)
  })

  it("returns error for invalid URLs", () => {
    const result = guardUrl("not a url")
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Invalid URL")
  })
})
