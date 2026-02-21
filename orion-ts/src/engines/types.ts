export interface GenerateOptions {
  prompt: string
  context?: Array<{ role: "user" | "assistant"; content: string }>
  maxTokens?: number
  temperature?: number
  model?: string
}

export interface Engine {
  readonly name: string
  readonly provider: string
  isAvailable(): boolean | Promise<boolean>
  generate(options: GenerateOptions): Promise<string>
}

export type TaskType = "reasoning" | "code" | "fast" | "multimodal" | "local"

export interface EngineRoute {
  task: TaskType
  priority: string[]
}
