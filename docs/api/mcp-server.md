# MCP Server Guide

EDITH implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) so it can be used as a tool server by Claude Desktop, Claude Code, and any other MCP-compatible LLM client.

---

## Starting the MCP Server

```bash
edith mcp serve
# or in dev mode:
pnpm dev -- --mode mcp
```

The MCP server starts on `stdio` transport by default (used by Claude Desktop and Claude Code).

For HTTP transport (useful for debugging):

```bash
edith mcp serve --transport http --port 3001
```

---

## Available Tools

### `ask_edith`

Ask EDITH a question or give it a task. The response goes through EDITH's full pipeline — memory retrieval, LLM routing, persona — and returns the assistant's reply.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | Yes | The message or question to send |
| `userId` | string | No | User ID for memory context (default: `mcp-user`) |
| `taskType` | string | No | LLM task type: `fast` / `reasoning` / `code` / `multimodal` |

**Example:**

```json
{
  "name": "ask_edith",
  "arguments": {
    "message": "Summarize what I was working on yesterday",
    "userId": "alice"
  }
}
```

**Response:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Yesterday you were working on the Phase 44 daemon manager implementation..."
    }
  ]
}
```

---

### `search_memory`

Search EDITH's vector memory for relevant context about a topic or query.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query |
| `userId` | string | No | User ID to scope the search |
| `limit` | number | No | Max results (default: 5) |

**Example:**

```json
{
  "name": "search_memory",
  "arguments": {
    "query": "TypeScript async error handling patterns",
    "userId": "alice",
    "limit": 3
  }
}
```

**Response:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Found 3 memory entries:\n\n1. [2026-02-15] Discussion about void+catch pattern for fire-and-forget...\n2. [2026-01-20] Code review notes on try/catch in message pipeline...\n3. ..."
    }
  ]
}
```

---

## Configuration in Claude Desktop

Add EDITH to your Claude Desktop MCP config at:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "edith": {
      "command": "node",
      "args": ["/path/to/edith/dist/main.js", "--mode", "mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "DATABASE_URL": "file:/path/to/edith/prisma/edith.db"
      }
    }
  }
}
```

Or if you have the `edith` CLI installed globally:

```json
{
  "mcpServers": {
    "edith": {
      "command": "edith",
      "args": ["mcp", "serve"]
    }
  }
}
```

---

## Configuration in Claude Code

Add to your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "edith": {
      "command": "edith",
      "args": ["mcp", "serve"],
      "env": {
        "DATABASE_URL": "file:./prisma/edith.db"
      }
    }
  }
}
```

---

## Testing the MCP Server

Use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) for interactive testing:

```bash
npx @modelcontextprotocol/inspector edith mcp serve
```

This opens a web UI where you can call tools and inspect responses.

---

## Adding New MCP Tools

New tools are registered in `src/mcp/server.ts`. Each tool needs:

1. A name and description
2. A JSON schema for input parameters
3. A handler function

```typescript
server.tool('my_tool', 'Description of what it does', {
  query: z.string().describe('The query parameter'),
}, async ({ query }) => {
  const result = await myService.process(query)
  return { content: [{ type: 'text', text: result }] }
})
```
