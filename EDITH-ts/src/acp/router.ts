import crypto from "node:crypto"

import { saveMessage } from "../database/index.js"
import { createLogger } from "../logger.js"
import { filterToolResult } from "../security/prompt-filter.js"
import { provenanceToMetadata, tagProvenance } from "../sessions/input-provenance.js"
import {
  signMessage,
  verifyMessage,
  type ACPMessage,
  type ACPState,
  type AgentCredential,
  STATE_TRANSITIONS,
} from "./protocol.js"

const log = createLogger("acp.router")

type AgentHandler = (msg: ACPMessage) => Promise<ACPMessage | void>

interface RegisteredAgent {
  credential: AgentCredential
  handler: AgentHandler
}

function canTransition(from: ACPState, to: ACPState): boolean {
  return STATE_TRANSITIONS[from]?.includes(to) ?? false
}

function actionAllowed(capabilities: string[], action: string): boolean {
  if (capabilities.includes("*")) {
    return true
  }

  if (capabilities.includes(action)) {
    return true
  }

  return capabilities.some((item) => action.startsWith(`${item}.`))
}

export class ACPRouter {
  private readonly agents = new Map<string, RegisteredAgent>()
  private readonly stateByFlow = new Map<string, ACPState>()

  registerAgent(
    id: string,
    capabilities: string[],
    handler: (msg: ACPMessage) => Promise<ACPMessage | void>,
  ): AgentCredential {
    const credential: AgentCredential = {
      agentId: id,
      secret: crypto.randomBytes(32).toString("hex"),
      capabilities: [...new Set(capabilities)],
    }

    this.agents.set(id, { credential, handler })
    log.info("ACP agent registered", { id, capabilities: credential.capabilities })

    return credential
  }

  async send(message: ACPMessage, senderSecret: string): Promise<ACPMessage | null> {
    const fromAgent = this.agents.get(message.from)
    const toAgent = this.agents.get(message.to)

    if (!fromAgent || !toAgent) {
      log.warn("ACP rejected: unknown agent", { from: message.from, to: message.to })
      return null
    }

    if (fromAgent.credential.secret !== senderSecret) {
      log.warn("ACP rejected: sender secret mismatch", { from: message.from })
      return null
    }

    if (!verifyMessage(message, senderSecret)) {
      log.warn("ACP rejected: invalid signature", { id: message.id, from: message.from })
      return null
    }

    const payloadScan = filterToolResult(JSON.stringify(message.payload ?? {}))
    if (!payloadScan.safe) {
      log.warn("ACP payload flagged", {
        id: message.id,
        from: message.from,
        reason: payloadScan.reason,
      })
      return null
    }

    if (!actionAllowed(fromAgent.credential.capabilities, message.action)) {
      log.warn("ACP rejected: capability denied", {
        from: message.from,
        action: message.action,
      })
      return null
    }

    const flowId = message.correlationId ?? message.id
    const flowKey = `${message.from}->${message.to}:${flowId}`
    const previousState = this.stateByFlow.get(flowKey) ?? "idle"

    if (!canTransition(previousState, message.state)) {
      log.warn("ACP rejected: invalid state transition", {
        flow: flowKey,
        from: previousState,
        to: message.state,
      })
      return null
    }

    this.stateByFlow.set(flowKey, message.state)
    await this.auditTransition(message, previousState, message.state)

    try {
      const response = await toAgent.handler(message)
      if (!response) {
        return null
      }

      this.stateByFlow.set(flowKey, response.state)
      await this.auditTransition(response, message.state, response.state)

      return response
    } catch (error) {
      log.error("ACP handler failed", { to: message.to, action: message.action, error })
      return null
    }
  }

  async request(
    from: string,
    to: string,
    action: string,
    payload: unknown,
    senderSecret: string,
    timeoutMs = 10_000,
  ): Promise<ACPMessage> {
    const now = Date.now()
    const msgNoSignature = {
      id: crypto.randomUUID(),
      from,
      to,
      type: "request" as const,
      action,
      payload,
      timestamp: now,
      state: "requested" as const,
    }

    const request: ACPMessage = {
      ...msgNoSignature,
      signature: signMessage(msgNoSignature, senderSecret),
    }

    const task = this.send(request, senderSecret)
    const timeout = new Promise<ACPMessage | null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs)
    })

    const result = await Promise.race([task, timeout])
    if (!result) {
      throw new Error(`ACP request timed out: ${from} -> ${to} (${action})`)
    }

    return result
  }

  getCapabilities(agentId: string): string[] {
    return this.agents.get(agentId)?.credential.capabilities ?? []
  }

  findAgentByCapability(capability: string): string[] {
    const matches: string[] = []
    for (const [id, agent] of this.agents) {
      if (actionAllowed(agent.credential.capabilities, capability)) {
        matches.push(id)
      }
    }
    return matches
  }

  private async auditTransition(message: ACPMessage, fromState: ACPState, toState: ACPState): Promise<void> {
    const provenanceMsg = tagProvenance(
      `acp:${message.from}->${message.to}:${message.action}:${fromState}->${toState}`,
      "tool_result",
      {
        transport: "acp",
        messageId: message.id,
        correlationId: message.correlationId,
        acpState: toState,
      },
    )

    const metadata = {
      ...provenanceToMetadata(provenanceMsg.provenance),
      acp: {
        id: message.id,
        from: message.from,
        to: message.to,
        action: message.action,
        type: message.type,
        fromState,
        toState,
      },
    }

    await saveMessage(message.to, "system", `ACP transition ${fromState} -> ${toState}`, "acp", metadata)
  }
}

export const acpRouter = new ACPRouter()
