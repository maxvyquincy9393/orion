/**
 * @file skill-scanner.ts
 * @description Security scanner for skills — detects prompt injection, dangerous commands, exfiltration.
 *
 * ARCHITECTURE:
 *   Called by skills/loader.ts before loading any skill.
 *   Pattern-based scanning — no LLM needed for speed.
 */
import { createLogger } from '../logger.js'

const log = createLogger('security.skill-scanner')

export type RiskType = 'prompt_injection' | 'dangerous_command' | 'exfiltration' | 'social_engineering'

export interface SkillRisk {
  type: RiskType
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  matchedPattern: string
}

export interface ScanResult {
  safe: boolean
  risks: SkillRisk[]
  scannedAt: Date
}

export interface SkillToScan {
  name: string
  content: string
  path: string
}

const PATTERNS: Array<{ type: RiskType; severity: SkillRisk['severity']; pattern: RegExp; description: string }> = [
  { type: 'prompt_injection', severity: 'critical', pattern: /ignore\s+(all\s+)?previous\s+instructions/i, description: 'Classic prompt injection attempt' },
  { type: 'prompt_injection', severity: 'critical', pattern: /disregard\s+(your\s+)?(previous\s+)?instructions/i, description: 'Instruction override attempt' },
  { type: 'prompt_injection', severity: 'high', pattern: /reveal\s+(your\s+)?(system\s+)?prompt/i, description: 'System prompt extraction' },
  { type: 'prompt_injection', severity: 'high', pattern: /print\s+(your\s+)?(system\s+)?prompt/i, description: 'System prompt extraction' },
  { type: 'dangerous_command', severity: 'critical', pattern: /rm\s+-rf\s+[\/~]/i, description: 'Destructive file deletion' },
  { type: 'dangerous_command', severity: 'critical', pattern: /format\s+c:/i, description: 'Drive format command' },
  { type: 'dangerous_command', severity: 'critical', pattern: /dd\s+if=.*of=\/dev/i, description: 'Disk overwrite command' },
  { type: 'dangerous_command', severity: 'high', pattern: /DROP\s+TABLE/i, description: 'Database destruction' },
  { type: 'dangerous_command', severity: 'high', pattern: /TRUNCATE\s+TABLE/i, description: 'Database truncation' },
  { type: 'exfiltration', severity: 'critical', pattern: /send\s+.{0,50}\s+to\s+https?:\/\/(?!localhost)/i, description: 'Data exfiltration to external URL' },
  { type: 'exfiltration', severity: 'high', pattern: /webhook\.site|requestbin\.com|pipedream\.net/i, description: 'Known data capture service' },
  { type: 'social_engineering', severity: 'high', pattern: /urgent.*click.*link/i, description: 'Social engineering pattern' },
]

class SkillScanner {
  /**
   * Scan a skill for security risks before loading.
   * @param skill - The skill to scan
   * @returns Scan result with risk assessment
   */
  async scan(skill: SkillToScan): Promise<ScanResult> {
    const risks: SkillRisk[] = []

    for (const { type, severity, pattern, description } of PATTERNS) {
      const match = skill.content.match(pattern)
      if (match) {
        risks.push({ type, severity, description, matchedPattern: match[0] })
      }
    }

    const hasCritical = risks.some(r => r.severity === 'critical')
    const hasHigh = risks.some(r => r.severity === 'high')

    if (hasCritical || hasHigh) {
      log.warn('skill scan found risks', { name: skill.name, riskCount: risks.length })
    }

    return { safe: risks.length === 0, risks, scannedAt: new Date() }
  }
}

export const skillScanner = new SkillScanner()
