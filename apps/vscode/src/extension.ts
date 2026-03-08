/**
 * @file extension.ts
 * @description VS Code extension entry point for EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Registers all commands, activates the sidebar WebviewViewProvider,
 *   and establishes a WebSocket connection to the EDITH gateway
 *   (src/gateway/). Commands collect editor context via ContextCollector
 *   and forward requests to the EDITH server via EdithClient.
 */

import * as vscode from "vscode"
import { EdithClient } from "./edith-client"
import { SidebarProvider } from "./sidebar-provider"
import { ContextCollector } from "./context-collector"

/** Extension output channel for surfacing logs in VS Code. */
let outputChannel: vscode.OutputChannel

/** Singleton WebSocket client connected to the EDITH gateway. */
let client: EdithClient

/**
 * Called by VS Code when the extension is activated.
 * Registers all commands and the sidebar view.
 */
export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("EDITH")
  outputChannel.appendLine("EDITH extension activating…")

  const config = vscode.workspace.getConfiguration("edith")
  const host = config.get<string>("serverHost", "localhost")
  const port = config.get<number>("serverPort", 18789)

  client = new EdithClient(`ws://${host}:${port}/ws`, outputChannel)
  client.connect()

  const sidebarProvider = new SidebarProvider(context.extensionUri, client)

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("edith.chatView", sidebarProvider),
    registerCommand("edith.reviewCode", () => handleReviewCode()),
    registerCommand("edith.generateDocs", () => handleGenerateDocs()),
    registerCommand("edith.generateTests", () => handleGenerateTests()),
    registerCommand("edith.explainCode", () => handleExplain()),
    registerCommand("edith.reviewPR", () => handleReviewPR()),
    registerCommand("edith.suggestCommitMessage", () => handleSuggestCommit()),
    registerCommand("edith.chat", () => handleOpenChat()),
    outputChannel,
    client,
  )

  outputChannel.appendLine("EDITH extension activated.")
}

/** Called when the extension is deactivated. */
export function deactivate(): void {
  client?.dispose()
  outputChannel?.appendLine("EDITH extension deactivated.")
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wraps command registration with error boundary + output channel logging.
 * @param id - Command identifier
 * @param handler - Async command handler
 */
function registerCommand(id: string, handler: () => Promise<void>): vscode.Disposable {
  return vscode.commands.registerCommand(id, async () => {
    try {
      await handler()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      outputChannel.appendLine(`[error] ${id}: ${msg}`)
      void vscode.window.showErrorMessage(`EDITH: ${msg}`)
    }
  })
}

/**
 * Sends selected code to EDITH for a code review and shows the result.
 */
async function handleReviewCode(): Promise<void> {
  const ctx = ContextCollector.collect()
  if (!ctx.selection) {
    void vscode.window.showWarningMessage("EDITH: Select some code first.")
    return
  }
  const result = await client.request("code/review", {
    code: ctx.selection,
    language: ctx.language,
    file: ctx.file,
  })
  showResultDocument(result, "EDITH Code Review")
}

/**
 * Generates documentation for the selected code and shows it.
 */
async function handleGenerateDocs(): Promise<void> {
  const ctx = ContextCollector.collect()
  if (!ctx.selection) {
    void vscode.window.showWarningMessage("EDITH: Select a function or class first.")
    return
  }
  const result = await client.request("code/docs", {
    code: ctx.selection,
    language: ctx.language,
    file: ctx.file,
  })
  showResultDocument(result, "EDITH Docs")
}

/**
 * Generates Vitest unit tests for the selected code.
 */
async function handleGenerateTests(): Promise<void> {
  const ctx = ContextCollector.collect()
  if (!ctx.selection) {
    void vscode.window.showWarningMessage("EDITH: Select a function or class first.")
    return
  }
  const result = await client.request("code/tests", {
    code: ctx.selection,
    language: ctx.language,
    file: ctx.file,
  })
  showResultDocument(result, "EDITH Tests")
}

/**
 * Explains the selected code in plain language.
 */
async function handleExplain(): Promise<void> {
  const ctx = ContextCollector.collect()
  if (!ctx.selection) {
    void vscode.window.showWarningMessage("EDITH: Select some code to explain.")
    return
  }
  const result = await client.request("code/explain", {
    code: ctx.selection,
    language: ctx.language,
    file: ctx.file,
  })
  showResultDocument(result, "EDITH Explanation")
}

/**
 * Requests a PR review based on the current git diff.
 */
async function handleReviewPR(): Promise<void> {
  const result = await client.request("git/review-pr", {
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
  })
  showResultDocument(result, "EDITH PR Review")
}

/**
 * Suggests a conventional commit message based on git diff --staged.
 */
async function handleSuggestCommit(): Promise<void> {
  const result = await client.request("git/suggest-commit", {
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
  })
  void vscode.window.showInputBox({
    prompt: "EDITH suggested commit message (edit if needed):",
    value: result,
    ignoreFocusOut: true,
  })
}

/**
 * Opens (focuses) the EDITH sidebar chat view.
 */
async function handleOpenChat(): Promise<void> {
  await vscode.commands.executeCommand("workbench.view.extension.edith-sidebar")
}

/**
 * Opens a new untitled text document and fills it with `content`.
 * @param content - Markdown or plain text response from EDITH
 * @param title - Label shown in the output channel
 */
function showResultDocument(content: string, title: string): void {
  outputChannel.appendLine(`[${title}] received ${content.length} chars`)
  void vscode.workspace
    .openTextDocument({ content, language: "markdown" })
    .then(doc => vscode.window.showTextDocument(doc, { preview: true }))
}
