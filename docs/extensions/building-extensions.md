# Building Extensions for EDITH

EDITH supports two types of extensions:

- **Channel extensions** — add new messaging channels (e.g., Slack, SMS, custom webhook)
- **Tool extensions** — add new skills/tools that EDITH can call during conversations

Extensions live in `src/plugin-sdk/` and follow a standard interface.

---

## Extension Structure

```
packages/my-extension/
├── package.json
├── src/
│   ├── index.ts          ← exports the extension class
│   └── __tests__/
│       └── my-extension.test.ts
└── README.md
```

Or as a local module directly in `src/`:

```
src/channels/my-channel.ts
src/skills/my-skill/
```

---

## Building a Channel Extension

Implement `BaseChannel` from `src/channels/base.ts`:

```typescript
/**
 * @file my-channel.ts
 * @description My custom channel implementation.
 */
import type { BaseChannel, InboundMessage, OutboundMessage } from '../channels/base.js'
import { createLogger } from '../logger.js'

const log = createLogger('channels.mychannel')

export class MyChannel implements BaseChannel {
  readonly id = 'mychannel'
  readonly displayName = 'My Channel'

  /** Start listening for inbound messages. */
  async start(): Promise<void> {
    log.info('My channel started')
    // Set up your listener here
    // When a message arrives, call this.onMessage(msg)
  }

  /** Send an outbound message to the channel. */
  async send(message: OutboundMessage): Promise<void> {
    log.info('Sending message', { to: message.userId })
    // Your send logic here
  }

  /** Stop the channel. */
  async stop(): Promise<void> {
    log.info('My channel stopped')
  }
}

export const myChannel = new MyChannel()
```

Register it in `src/channels/manager.ts`:

```typescript
import { myChannel } from './my-channel.js'
channelManager.register(myChannel)
```

---

## Building a Tool Extension

Tool extensions add new capabilities that the LLM can invoke. Create a skill directory under `src/skills/` with a `SKILL.md` descriptor:

```
src/skills/my-tool/
├── SKILL.md
└── handler.ts
```

See [building-skills.md](../skills/building-skills.md) for the SKILL.md format.

For programmatic tools that need TypeScript logic, implement them in `handler.ts` and register with the skills loader in `src/skills/loader.ts`.

---

## BaseChannelExtension Interface (Plugin SDK)

For packaged extensions via the plugin SDK:

```typescript
import type { BaseChannelExtension } from '../plugin-sdk/index.js'

export class MyChannelExtension implements BaseChannelExtension {
  readonly type = 'channel' as const
  readonly id = 'mychannel'
  readonly version = '1.0.0'

  /** Called when the extension is loaded. */
  async onLoad(): Promise<void> { ... }

  /** Called when the extension is unloaded. */
  async onUnload(): Promise<void> { ... }
}
```

---

## BaseToolExtension Interface

```typescript
import type { BaseToolExtension } from '../plugin-sdk/index.js'

export class MyToolExtension implements BaseToolExtension {
  readonly type = 'tool' as const
  readonly id = 'my-tool'
  readonly version = '1.0.0'

  /** Tool name exposed to the LLM. */
  readonly toolName = 'my_tool'

  /** Tool description for the LLM function call spec. */
  readonly toolDescription = 'Does something useful'

  /** JSON schema for the tool parameters. */
  readonly toolParameterSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The query to process' },
    },
    required: ['query'],
  }

  /** Execute the tool. */
  async execute(params: { query: string }): Promise<string> {
    return `Result for: ${params.query}`
  }

  async onLoad(): Promise<void> {}
  async onUnload(): Promise<void> {}
}
```

---

## Publishing Extensions

For internal use, add your extension directly under `src/`. For shareable extensions:

1. Create a separate npm package under `packages/plugin-<name>/`
2. Add it to `pnpm-workspace.yaml`
3. Export from `packages/plugin-<name>/src/index.ts`
4. Register in the main app via `src/core/startup.ts`

For public distribution, publish to npm with the naming convention `edith-plugin-<name>`.

---

## Code Standards for Extensions

All extension code must follow the same standards as the main codebase:

- File-level JSDoc on every file
- JSDoc on every class, method, and constant
- TypeScript strict — no `any`, no untyped returns
- `createLogger("channels.<id>")` — not `console.log`
- `.js` extension on all ESM imports
- Tests in `__tests__/<name>.test.ts`
