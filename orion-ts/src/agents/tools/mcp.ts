/**
 * mcpTools.ts — MCP tools for agent to discover and invoke MCP servers.
 *
 * Allows the agent to dynamically discover and call any tool from
 * any connected MCP server without needing separate tool definitions
 * for each MCP tool.
 *
 * Research: arXiv 2506.01056 — MCP-Zero active tool discovery
 *
 * @module agents/tools/mcp
 */
import { tool } from "ai"
import { z } from "zod"
import { mcpClient } from "../../mcp/client.js"

export const mcpCallTool = tool({
  description: `Call any tool from any connected MCP server.
First use mcpListTool to see available servers and tools, then call this with serverName and toolName.
Use for: GitHub, Notion, Slack, databases, any MCP-compatible service.`,
  inputSchema: z.object({
    serverName: z.string().describe("Name of the MCP server (from mcpListTool)"),
    toolName: z.string().describe("Name of the tool to call"),
    args: z.record(z.string(), z.unknown()).default({}).describe("Tool arguments as key-value pairs"),
  }),
  execute: async ({ serverName, toolName, args }) => {
    const result = await mcpClient.callTool(serverName, toolName, args)

    if (result.isError) {
      return `MCP error: ${result.content.map((c) => c.text).join("\n")}`
    }

    return result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .slice(0, 8_000)
  },
})

export const mcpListTool = tool({
  description: `List all tools available from connected MCP servers.
Returns server names, tool names, and descriptions.
Use this first before calling mcpCallTool.`,
  inputSchema: z.object({}),
  execute: async () => {
    const servers = mcpClient.getConnectedServers()
    if (servers.length === 0) {
      return "No MCP servers connected. Add MCP server configs to orion.json under 'mcp.servers'."
    }

    const tools = mcpClient.getAllTools()
    const grouped = tools.reduce((acc, tool) => {
      if (!acc[tool.serverName]) acc[tool.serverName] = []
      acc[tool.serverName].push(`  - ${tool.name}: ${tool.description}`)
      return acc
    }, {} as Record<string, string[]>)

    return Object.entries(grouped)
      .map(([server, toolList]) => `[${server}]\n${toolList.join("\n")}`)
      .join("\n\n")
  },
})
