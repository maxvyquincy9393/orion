import { orchestrator } from "../engines/orchestrator.js"
import type { AgentType } from "./task-planner.js"

export interface AgentConfig {
  systemPrompt: string
  preferredTaskType: "reasoning" | "code" | "fast"
  maxTokenHint: number
}

const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  researcher: {
    systemPrompt:
      "You are a research specialist. Your job is to gather, synthesize, and summarize information accurately. Always cite what you know vs what you infer. Be comprehensive but concise.",
    preferredTaskType: "reasoning",
    maxTokenHint: 1500,
  },
  coder: {
    systemPrompt:
      "You are a senior software engineer. Write clean, working code. Always include error handling. If fixing a bug, explain what was wrong. Output only the code + brief explanation, no filler.",
    preferredTaskType: "code",
    maxTokenHint: 2000,
  },
  writer: {
    systemPrompt:
      "You are a skilled writer. Write clear, engaging content. Match the required tone and format. Be direct. No unnecessary padding.",
    preferredTaskType: "fast",
    maxTokenHint: 1500,
  },
  analyst: {
    systemPrompt:
      "You are an analytical thinker. Break down problems, compare options, identify patterns. Be objective. Show your reasoning. Conclude with clear recommendations.",
    preferredTaskType: "reasoning",
    maxTokenHint: 1500,
  },
  executor: {
    systemPrompt:
      "You are a task executor. Your role is to plan and describe concrete action steps. Be precise about what needs to be done, in what order, and what success looks like.",
    preferredTaskType: "fast",
    maxTokenHint: 1000,
  },
  reviewer: {
    systemPrompt:
      "You are a quality reviewer. Check the work done for accuracy, completeness, and quality. Be specific about issues found. Rate quality 1-10. Suggest improvements.",
    preferredTaskType: "fast",
    maxTokenHint: 800,
  },
}

export async function runSpecializedAgent(
  agentType: AgentType,
  task: string,
  context?: string,
): Promise<string> {
  const config = AGENT_CONFIGS[agentType]
  const fullPrompt = context
    ? `${config.systemPrompt}\n\nContext from previous tasks:\n${context}\n\nYour task: ${task}`
    : `${config.systemPrompt}\n\nYour task: ${task}`

  return orchestrator.generate(config.preferredTaskType, { prompt: fullPrompt })
}
