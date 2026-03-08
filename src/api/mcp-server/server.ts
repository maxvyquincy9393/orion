/**
 * @file server.ts
 * @description EDITH as an MCP (Model Context Protocol) server.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Exposes EDITH's capabilities as MCP resources + tools.
 *   Launched via: edith --mode mcp (handled in main.ts).
 *   Tools: ask_edith, search_memory.
 *   Uses stdio JSON-RPC transport (no SDK dependency).
 */
import { createLogger } from '../../logger.js'
import config from '../../config.js'

const log = createLogger('api.mcp-server')

/** MCP tool definition. */
export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** MCP tool result. */
export interface McpToolResult {
  content: Array<{ type: string; text: string }>
}

/** Available MCP tools exposed by EDITH. */
export const MCP_TOOLS: McpTool[] = [
  {
    name: 'ask_edith',
    description:
      'Ask EDITH anything — she will use her full AI pipeline including memory, persona, and multi-modal reasoning.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'The message to send to EDITH' } },
      required: ['message'],
    },
  },
  {
    name: 'search_memory',
    description: "Search EDITH's persistent memory for relevant context.",
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The search query' } },
      required: ['query'],
    },
  },
]

/**
 * Handle an MCP tool call.
 * @param name - Tool name
 * @param args - Tool arguments
 * @returns Tool result with text content
 */
export async function handleMcpToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  switch (name) {
    case 'ask_edith': {
      const { processMessage } = await import('../../core/message-pipeline.js')
      const message = String(args.message ?? '')
      const result = await processMessage('mcp-client', message, { channel: 'mcp' })
      const text = typeof result === 'string' ? result : (result as { response: string }).response
      return { content: [{ type: 'text', text }] }
    }
    case 'search_memory': {
      const { memory } = await import('../../memory/store.js')
      const query = String(args.query ?? '')
      const context = await memory.buildContext('mcp-client', query)
      return { content: [{ type: 'text', text: context.systemContext }] }
    }
    default:
      throw new Error(`Unknown MCP tool: ${name}`)
  }
}

/**
 * Start EDITH in MCP server mode (stdio transport).
 * Used when launched as: node dist/main.js --mode mcp
 */
export async function startMcpServer(): Promise<void> {
  if (config.MCP_SERVER_ENABLED !== 'true') {
    log.debug('MCP server disabled')
    return
  }

  log.info('starting MCP server mode (stdio)')

  process.stdin.setEncoding('utf8')
  let buffer = ''

  process.stdin.on('data', (chunk: string) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue
      void handleMcpLine(line).catch(err => log.error('mcp handler error', { err }))
    }
  })

  process.stdin.on('end', () => {
    log.info('MCP stdio closed, shutting down')
    process.exit(0)
  })
}

/** Handle a single JSON-RPC line from stdin. */
async function handleMcpLine(line: string): Promise<void> {
  let req: Record<string, unknown>
  try {
    req = JSON.parse(line) as Record<string, unknown>
  } catch {
    return
  }

  const id = req.id
  const method = req.method as string

  let result: unknown
  try {
    switch (method) {
      case 'tools/list':
        result = { tools: MCP_TOOLS }
        break
      case 'tools/call': {
        const params = req.params as { name: string; arguments: Record<string, unknown> }
        result = await handleMcpToolCall(params.name, params.arguments ?? {})
        break
      }
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'edith', version: '1.0.0' },
        }
        break
      default:
        result = { error: { code: -32601, message: `Method not found: ${method}` } }
    }
  } catch (err) {
    result = { error: { code: -32603, message: String(err) } }
  }

  const response = JSON.stringify({ jsonrpc: '2.0', id, result })
  process.stdout.write(response + '\n')
}
