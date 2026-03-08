/**
 * @file external-content.ts
 * @description Analyze external URLs for security risks before fetching.
 *
 * ARCHITECTURE:
 *   Called before any external URL is fetched by agents or skills.
 *   Blocks private IPs, dangerous file types, known exfiltration domains.
 */
import { createLogger } from '../logger.js'

const log = createLogger('security.external-content')

export interface ContentRiskResult {
  safe: boolean
  reason?: string
  risk: 'none' | 'low' | 'medium' | 'high' | 'blocked'
}

/** Known malicious or data-capture domains. */
const BLOCKED_DOMAINS = new Set([
  'webhook.site', 'requestbin.com', 'pipedream.net',
  'canarytokens.org', 'interactsh.com', 'burpcollaborator.net',
])

/** File extensions that should never be fetched. */
const BLOCKED_EXTENSIONS = new Set(['.exe', '.msi', '.bat', '.cmd', '.ps1', '.sh', '.dmg', '.pkg'])

/**
 * Analyze a URL for security risks before fetching.
 * @param rawUrl - URL to analyze
 * @returns Risk assessment result
 */
export function analyzeUrl(rawUrl: string): ContentRiskResult {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { safe: false, risk: 'blocked', reason: 'Invalid URL format' }
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return { safe: false, risk: 'blocked', reason: `Protocol not allowed: ${url.protocol}` }
  }

  const host = url.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') ||
      host.startsWith('10.') || host.startsWith('172.16.')) {
    return { safe: false, risk: 'blocked', reason: 'Private network address blocked' }
  }

  const domain = host.replace(/^www\./, '')
  if (BLOCKED_DOMAINS.has(domain)) {
    log.warn('blocked domain detected', { domain })
    return { safe: false, risk: 'blocked', reason: `Domain on blocklist: ${domain}` }
  }

  const lastDot = url.pathname.lastIndexOf('.')
  if (lastDot !== -1) {
    const ext = url.pathname.slice(lastDot).toLowerCase()
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return { safe: false, risk: 'high', reason: `Executable file type blocked: ${ext}` }
    }
  }

  return { safe: true, risk: 'none' }
}
