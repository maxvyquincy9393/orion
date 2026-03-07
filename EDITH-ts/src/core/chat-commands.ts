/**
 * chat-commands.ts - Slash commands for the EDITH chat interface.
 *
 * Intercepts user messages starting with "/" and handles them as commands
 * instead of sending them through the LLM pipeline. Returns the command
 * response text.
 *
 * Supported commands:
 *   /model [engine/model]  - Switch to a specific engine or model
 *   /models                - List available engines and models
 *   /status                - Show current engine, model, memory stats
 *   /help                  - Show all available commands
 *   /reset                 - Reset model preference to auto
 *
 * @module core/chat-commands
 */

import { orchestrator } from "../engines/orchestrator.js"
import { modelPreferences, ENGINE_MODEL_CATALOG } from "../engines/model-preferences.js"
import { createLogger } from "../logger.js"

const log = createLogger("core.chat-commands")

export interface CommandResult {
  /** True if the message was a valid command and was handled */
  handled: boolean
  /** Response text to send back to the user */
  response: string
}

const NOT_COMMAND: CommandResult = { handled: false, response: "" }

/**
 * Try to intercept a message as a chat command.
 * Returns { handled: false } if it's not a command.
 */
export function handleChatCommand(userId: string, message: string): CommandResult {
  const trimmed = message.trim()
  if (!trimmed.startsWith("/")) {
    return NOT_COMMAND
  }

  const parts = trimmed.slice(1).split(/\s+/)
  const command = parts[0]?.toLowerCase()
  const args = parts.slice(1)

  switch (command) {
    case "model":
    case "engine":
      return handleModelCommand(userId, args)
    case "models":
    case "engines":
      return handleModelsListCommand()
    case "status":
    case "info":
      return handleStatusCommand(userId)
    case "reset":
      return handleResetCommand(userId)
    case "help":
      return handleHelpCommand()
    default:
      log.debug("unknown slash command, passing through", { command, userId })
      return NOT_COMMAND
  }
}

function handleModelCommand(userId: string, args: string[]): CommandResult {
  if (args.length === 0) {
    const current = modelPreferences.get(userId)
    if (!current || (!current.engine && !current.model)) {
      return {
        handled: true,
        response: [
          "**Current mode:** Auto (EDITH picks the best engine).",
          "",
          "Usage: `/model <engine>` or `/model <engine>/<model>`",
          "Example: `/model gemini` or `/model openai/gpt-4o-mini`",
          "",
          "Use `/models` to see all available options.",
        ].join("\n"),
      }
    }

    return {
      handled: true,
      response: `**Current model:** ${current.engine ?? "auto"}${current.model ? ` / ${current.model}` : " (engine default)"}\n\nUse \`/model auto\` to switch back to automatic selection.`,
    }
  }

  const input = args.join(" ").toLowerCase()

  if (input === "auto" || input === "reset") {
    modelPreferences.reset(userId)
    return {
      handled: true,
      response: "**Switched to Auto mode.** EDITH will pick the best engine for each request.",
    }
  }

  if (input.includes("/")) {
    const [enginePart, ...modelParts] = input.split("/")
    const engineName = enginePart.trim()
    const modelName = [enginePart, ...modelParts].join("/").trim()

    const available = orchestrator.getAvailableEngines()
    if (available.includes(engineName)) {
      const model = modelParts.join("/").trim()
      modelPreferences.setModel(userId, engineName, model)
      return {
        handled: true,
        response: `**Engine:** ${engineName}\n**Model:** ${model}\n\nAll your messages will now use this model. Use \`/model auto\` to go back.`,
      }
    }

    if (available.includes("openrouter")) {
      modelPreferences.setModel(userId, "openrouter", modelName)
      return {
        handled: true,
        response: `**Engine:** OpenRouter\n**Model:** ${modelName}\n\nAll your messages will now use this model via OpenRouter.`,
      }
    }

    return {
      handled: true,
      response: `Engine \`${engineName}\` is not available. Available: ${available.join(", ")}\n\nUse \`/models\` to see all options.`,
    }
  }

  const available = orchestrator.getAvailableEngines()
  if (available.includes(input)) {
    modelPreferences.setEngine(userId, input)
    const catalog = ENGINE_MODEL_CATALOG[input]
    const modelList = catalog ? catalog.models.slice(0, 3).join(", ") : "default"
    return {
      handled: true,
      response: `**Switched to ${catalog?.displayName ?? input}**\nDefault model will be used.\n\nAvailable models: ${modelList}\nTo pick a specific model: \`/model ${input}/<model-name>\``,
    }
  }

  const resolvedEngine = modelPreferences.resolveEngineFromModel(input)
  if (resolvedEngine && available.includes(resolvedEngine)) {
    modelPreferences.setModel(userId, resolvedEngine, input)
    return {
      handled: true,
      response: `**Engine:** ${resolvedEngine}\n**Model:** ${input}\n\nAll your messages will now use this model.`,
    }
  }

  return {
    handled: true,
    response: [
      `Unknown engine or model: \`${input}\``,
      "",
      `**Available engines:** ${available.join(", ")}`,
      "",
      "Use `/models` to see all options, or try:",
      "- `/model gemini`",
      "- `/model openai/gpt-4o-mini`",
      "- `/model claude-sonnet-4-20250514`",
    ].join("\n"),
  }
}

function handleModelsListCommand(): CommandResult {
  const available = orchestrator.getAvailableEngines()
  const sections: string[] = ["# Available Engines and Models", ""]

  for (const engineName of available) {
    const catalog = ENGINE_MODEL_CATALOG[engineName]
    if (!catalog) {
      sections.push(`### ${engineName}`)
      sections.push("_No model catalog_")
      sections.push("")
      continue
    }

    const modelLines = catalog.models
      .map((modelName, index) => `  ${index === 0 ? "*" : "-"} \`${modelName}\``)
      .join("\n")
    sections.push(`### ${catalog.displayName} (\`${engineName}\`)`)
    sections.push(modelLines)
    sections.push("")
  }

  if (available.length === 0) {
    sections.push("No engines available. Set at least one API key in `.env`.")
    sections.push("")
  }

  sections.push("---")
  sections.push("**Usage:** `/model <engine>` or `/model <engine>/<model>`")
  sections.push("**Reset:** `/model auto`")

  return { handled: true, response: sections.join("\n") }
}

function handleStatusCommand(userId: string): CommandResult {
  const available = orchestrator.getAvailableEngines()
  const lastUsed = orchestrator.getLastUsedEngine()
  const pref = modelPreferences.get(userId)

  const lines = [
    "# EDITH Status",
    "",
    `**Available engines:** ${available.length > 0 ? available.join(", ") : "none"}`,
    `**Last used:** ${lastUsed ? `${lastUsed.provider} / ${lastUsed.model}` : "none yet"}`,
    `**Your preference:** ${pref?.engine ? `${pref.engine}${pref.model ? ` / ${pref.model}` : ""}` : "Auto"}`,
  ]

  return { handled: true, response: lines.join("\n") }
}

function handleResetCommand(userId: string): CommandResult {
  modelPreferences.reset(userId)
  return {
    handled: true,
    response: "**All preferences reset.** Model selection is now automatic.",
  }
}

function handleHelpCommand(): CommandResult {
  const lines = [
    "# EDITH Commands",
    "",
    "| Command | Description |",
    "|---|---|",
    "| `/model <name>` | Switch engine (e.g. `/model gemini`) |",
    "| `/model <engine>/<model>` | Switch to specific model |",
    "| `/model auto` | Reset to automatic selection |",
    "| `/models` | List all available engines and models |",
    "| `/status` | Show current engine and preferences |",
    "| `/reset` | Reset all preferences |",
    "| `/help` | Show this help message |",
  ]

  return { handled: true, response: lines.join("\n") }
}
