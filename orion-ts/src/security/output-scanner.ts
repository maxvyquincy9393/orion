import { createLogger } from "../logger.js"

const log = createLogger("security.output-scanner")

export interface OutputScanResult {
  safe: boolean
  issues: string[]
  sanitized: string
}

const SENSITIVE_OUTPUT_PATTERNS = [
  {
    pattern: /sk-[a-zA-Z0-9]{32,}/g,
    replace: "[API_KEY_REDACTED]",
    issue: "API key in output",
  },
  {
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
    replace: "[GITHUB_TOKEN_REDACTED]",
    issue: "GitHub token in output",
  },
  {
    pattern: /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/g,
    replace: "[JWT_REDACTED]",
    issue: "JWT token in output",
  },
  {
    pattern: /password\s*[:=]\s*["']?[^\s"']{8,}/gi,
    replace: "password: [REDACTED]",
    issue: "Password in output",
  },
]

const WARNING_PATTERNS = [
  /step\s*\d+.*\b(kill|harm|attack|steal)\b/gi,
  /\b(instructions|steps|guide)\b.*\b(hack|exploit|bypass)\b/gi,
]

export class OutputScanner {
  scan(output: string): OutputScanResult {
    const start = Date.now()
    let sanitized = output
    const issues: string[] = []

    for (const rule of SENSITIVE_OUTPUT_PATTERNS) {
      if (rule.pattern.test(sanitized)) {
        issues.push(rule.issue)
        rule.pattern.lastIndex = 0
        sanitized = sanitized.replace(rule.pattern, rule.replace)
      }
      rule.pattern.lastIndex = 0
    }

    for (const pattern of WARNING_PATTERNS) {
      if (pattern.test(sanitized)) {
        issues.push("Potentially harmful instructions in output")
      }
      pattern.lastIndex = 0
    }

    if (issues.length > 0) {
      log.warn("Output scan found issues", {
        count: issues.length,
        issues,
        scanMs: Date.now() - start,
      })
    } else {
      log.debug("Output scan passed", { scanMs: Date.now() - start })
    }

    return {
      safe: issues.length === 0,
      issues,
      sanitized,
    }
  }
}

export const outputScanner = new OutputScanner()
