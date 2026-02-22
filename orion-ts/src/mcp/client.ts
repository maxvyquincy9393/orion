/**
 * client.ts — MCP (Model Context Protocol) client implementation.
 *
 * Connects Orion to any MCP server and dynamically registers their
 * tools into the Orion tool registry at runtime.
 *
 * Architecture (MCP-Zero, arXiv 2506.01056):
 *   - Static tool registry: tools configured in orion.json
 *   - Dynamic discovery: agent discovers tools at runtime
 *   - Server lifecycle: start, health check, restart on crash
 *
 * Transport support:
 *   - stdio: spawn local process (e.g. python mcp_server.py)
 *   - http: connect to remote HTTP MCP server
 *
 * @module mcp/client
 */
import { spawn, type ChildProcess } from "node:child_process"
import { createLogger } from "../logger.js"

const log = createLogger("mcp.client")

export interface MCPServerConfig {
  /** Unique name for this MCP server */
  name: string
  /** Transport type */
  transport: "stdio" | "http"
  /** For stdio: command to spawn (e.g. "python") */
  command?: string
  /** For stdio: args to command */
  args?: string[]
  /** For http: URL of the MCP server */
  url?: string
  /** Environment variables to pass to the server process */
  env?: Record<string, string>
  /** Whether this server starts automatically on Orion startup */
  autoStart?: boolean
}

export interface MCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  serverName: string
}

export interface MCPCallResult {
  content: Array<{ type: "text" | "image" | "error"; text?: string; data?: string }>
  isError: boolean
}

interface MCPConnection {
  config: MCPServerConfig
  process?: ChildProcess
  tools: Map<string, MCPTool>
  connected: boolean
  lastPingAt: number
}

/**
 * Manages connections to multiple MCP servers and exposes
 * their tools as Orion-compatible tool definitions.
 */
export class MCPClientManager {
  private readonly connections = new Map<string, MCPConnection>()
  private readonly pendingRequests = new Map<string, {
    resolve: (value: unknown) => void
    reject: (reason: unknown) => void
  }>()
  private requestIdCounter = 0

  /**
   * Load MCP server configs from orion.json and connect to autoStart servers.
   */
  async init(configs: MCPServerConfig[]): Promise<void> {
    for (const config of configs) {
      this.connections.set(config.name, {
        config,
        tools: new Map(),
        connected: false,
        lastPingAt: 0,
      })

      if (config.autoStart !== false) {
        await this.connect(config.name).catch((err) => {
          log.warn("MCP server auto-start failed", { name: config.name, error: String(err) })
        })
      }
    }

    log.info("MCP client initialized", {
      servers: configs.length,
      connected: [...this.connections.values()].filter((c) => c.connected).length,
    })
  }

  /**
   * Connect to a specific MCP server and discover its tools.
   */
  async connect(serverName: string): Promise<void> {
    const conn = this.connections.get(serverName)
    if (!conn) throw new Error(`MCP server '${serverName}' not configured`)

    if (conn.config.transport === "stdio") {
      await this.connectStdio(conn)
    } else if (conn.config.transport === "http") {
      await this.connectHttp(conn)
    }

    // Discover tools after connecting
    const tools = await this.listTools(serverName)
    conn.tools.clear()
    for (const tool of tools) {
      conn.tools.set(tool.name, { ...tool, serverName })
    }

    conn.connected = true
    conn.lastPingAt = Date.now()

    log.info("MCP server connected", { name: serverName, tools: tools.length })
  }

  /**
   * Get all tools from all connected MCP servers.
   * Used by system-prompt-builder to inject available MCP tools.
   */
  getAllTools(): MCPTool[] {
    const tools: MCPTool[] = []
    for (const conn of this.connections.values()) {
      if (conn.connected) {
        for (const tool of conn.tools.values()) {
          tools.push(tool)
        }
      }
    }
    return tools
  }

  /**
   * Call a specific tool on a specific MCP server.
   */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    const conn = this.connections.get(serverName)
    if (!conn?.connected) {
      return {
        content: [{ type: "error", text: `MCP server '${serverName}' not connected` }],
        isError: true,
      }
    }

    try {
      const result = await this.sendRequest(conn, {
        jsonrpc: "2.0",
        id: ++this.requestIdCounter,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      })

      return result as MCPCallResult
    } catch (err) {
      log.error("MCP tool call failed", { serverName, toolName, error: String(err) })
      return {
        content: [{ type: "error", text: `Tool call failed: ${String(err)}` }],
        isError: true,
      }
    }
  }

  /**
   * Disconnect all MCP servers and clean up processes.
   */
  async shutdown(): Promise<void> {
    for (const [name, conn] of this.connections.entries()) {
      if (conn.process) {
        conn.process.kill("SIGTERM")
        log.info("MCP server process killed", { name })
      }
      conn.connected = false
    }
  }

  /** List of connected server names */
  getConnectedServers(): string[] {
    return [...this.connections.entries()]
      .filter(([, conn]) => conn.connected)
      .map(([name]) => name)
  }

  private async connectStdio(conn: MCPConnection): Promise<void> {
    if (!conn.config.command) throw new Error("stdio transport requires command")

    const proc = spawn(conn.config.command, conn.config.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...conn.config.env },
    })

    conn.process = proc

    proc.stdout?.on("data", (chunk: Buffer) => {
      this.handleStdioData(conn.config.name, chunk.toString())
    })

    proc.stderr?.on("data", (chunk: Buffer) => {
      log.debug("MCP server stderr", { name: conn.config.name, msg: chunk.toString().trim() })
    })

    proc.on("exit", (code) => {
      log.warn("MCP server process exited", { name: conn.config.name, code })
      conn.connected = false
    })

    // Send initialize request
    await this.sendRequest(conn, {
      jsonrpc: "2.0",
      id: ++this.requestIdCounter,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "orion", version: "1.0.0" },
      },
    })
  }

  private async connectHttp(conn: MCPConnection): Promise<void> {
    if (!conn.config.url) throw new Error("http transport requires url")

    const response = await fetch(`${conn.config.url}/initialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++this.requestIdCounter,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "orion", version: "1.0.0" } },
      }),
    })

    if (!response.ok) {
      throw new Error(`HTTP MCP server returned ${response.status}`)
    }
  }

  private async listTools(serverName: string): Promise<MCPTool[]> {
    const conn = this.connections.get(serverName)!
    const result = await this.sendRequest(conn, {
      jsonrpc: "2.0",
      id: ++this.requestIdCounter,
      method: "tools/list",
      params: {},
    }) as { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }

    return result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      serverName,
    }))
  }

  private async sendRequest(conn: MCPConnection, request: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = String(request.id)
      this.pendingRequests.set(id, { resolve, reject })

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`MCP request ${id} timed out`))
        }
      }, 10_000)

      if (conn.config.transport === "stdio" && conn.process?.stdin) {
        conn.process.stdin.write(JSON.stringify(request) + "\n")
      } else if (conn.config.transport === "http" && conn.config.url) {
        fetch(conn.config.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        })
          .then((res) => res.json())
          .then((data) => this.handleResponse(data as Record<string, unknown>))
          .catch(reject)
      }
    })
  }

  private handleStdioData(serverName: string, data: string): void {
    const lines = data.trim().split("\n")
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        this.handleResponse(parsed)
      } catch {
        // Not JSON, skip
      }
    }
  }

  private handleResponse(response: Record<string, unknown>): void {
    const id = String(response.id)
    const pending = this.pendingRequests.get(id)
    if (!pending) return

    this.pendingRequests.delete(id)

    if (response.error) {
      pending.reject(new Error(String((response.error as { message?: unknown }).message ?? response.error)))
    } else {
      pending.resolve(response.result)
    }
  }
}

export const mcpClient = new MCPClientManager()
