export interface GenerateOptions {
  prompt: string
  context?: Array<{ role: "user" | "assistant"; content: string }>
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
  model?: string
}

export interface Engine {
  readonly name: string
  readonly provider: string
  /** Default model identifier used by this engine (e.g., "llama-3.3-70b-versatile") */
  readonly defaultModel?: string
  isAvailable(): boolean | Promise<boolean>
  generate(options: GenerateOptions): Promise<string>
}

export type TaskType = "reasoning" | "code" | "fast" | "multimodal" | "local"

export interface EngineRoute {
  task: TaskType
  priority: string[]
}
