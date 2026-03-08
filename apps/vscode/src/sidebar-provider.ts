/**
 * @file sidebar-provider.ts
 * @description VS Code WebviewViewProvider that renders the EDITH chat sidebar.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Registered in extension.ts via `vscode.window.registerWebviewViewProvider`.
 *   Communicates bidirectionally with the webview via postMessage; forwards
 *   user messages to EdithClient and streams EDITH responses back to the UI.
 */

import * as vscode from "vscode"
import { EdithClient } from "./edith-client"

/** Message shape sent from the webview to the extension host. */
interface WebviewMessage {
  type: "send" | "ready"
  text?: string
}

/**
 * Provides the EDITH chat panel rendered inside the activity bar sidebar.
 * The webview renders a minimal HTML chat UI; all LLM calls are proxied
 * through EdithClient so the UI stays thin.
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
  /** Injected view handle once VS Code calls resolveWebviewView. */
  private view?: vscode.WebviewView

  /**
   * @param extensionUri - Extension root URI (used to build CSP nonces)
   * @param client - Connected EdithClient instance
   */
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: EdithClient,
  ) {}

  /**
   * Called by VS Code when the sidebar webview becomes visible.
   * Sets up HTML content and message dispatch.
   */
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    webviewView.webview.html = this.buildHtml(webviewView.webview)

    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      void this.handleWebviewMessage(msg)
    })
  }

  /**
   * Pushes a message object to the webview's JavaScript context.
   * @param type - Message type (`"response"` | `"error"` | `"status"`)
   * @param payload - Content to send
   */
  postToWebview(type: string, payload: unknown): void {
    void this.view?.webview.postMessage({ type, payload })
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Handles messages posted from the webview to the extension host.
   * @param msg - Typed webview message
   */
  private async handleWebviewMessage(msg: WebviewMessage): Promise<void> {
    if (msg.type === "ready") {
      this.postToWebview("status", { connected: this.client.isConnected() })
      return
    }

    if (msg.type === "send" && msg.text) {
      try {
        this.postToWebview("status", { thinking: true })
        const result = await this.client.request("chat", { message: msg.text })
        this.postToWebview("response", { text: result })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error"
        this.postToWebview("error", { message })
      } finally {
        this.postToWebview("status", { thinking: false })
      }
    }
  }

  /**
   * Generates the webview HTML. Uses a strict Content Security Policy —
   * only inline scripts bearing the nonce are allowed.
   * @param webview - The webview instance (used to generate the nonce)
   * @returns Full HTML document string
   */
  private buildHtml(webview: vscode.Webview): string {
    // Generate a random nonce for CSP
    const nonce = Array.from({ length: 16 }, () =>
      Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, "0"),
    ).join("")

    const csp = [
      `default-src 'none'`,
      `style-src 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ")

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EDITH</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .msg {
      padding: 6px 10px;
      border-radius: 6px;
      max-width: 90%;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 12px;
      line-height: 1.5;
    }
    .msg.user {
      align-self: flex-end;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .msg.edith {
      align-self: flex-start;
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    .msg.error {
      align-self: flex-start;
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
    }
    #status-bar {
      padding: 2px 8px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      height: 18px;
    }
    #input-row {
      display: flex;
      gap: 6px;
      padding: 8px;
      border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
    }
    #input {
      flex: 1;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      padding: 4px 8px;
      font-family: inherit;
      font-size: inherit;
      resize: none;
      height: 60px;
    }
    #send-btn {
      align-self: flex-end;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      padding: 4px 12px;
      cursor: pointer;
      font-family: inherit;
    }
    #send-btn:disabled { opacity: 0.5; cursor: default; }
  </style>
</head>
<body>
  <div id="messages"><div class="msg edith">Hello. I'm EDITH. How can I help?</div></div>
  <div id="status-bar"></div>
  <div id="input-row">
    <textarea id="input" placeholder="Ask EDITH anything…" rows="2"></textarea>
    <button id="send-btn">Send</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messages = document.getElementById('messages');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    const statusBar = document.getElementById('status-bar');

    function appendMsg(text, role) {
      const div = document.createElement('div');
      div.className = 'msg ' + role;
      div.textContent = text;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    function setThinking(on) {
      sendBtn.disabled = on;
      statusBar.textContent = on ? 'EDITH is thinking…' : '';
    }

    sendBtn.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) return;
      appendMsg(text, 'user');
      input.value = '';
      vscode.postMessage({ type: 'send', text });
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });

    window.addEventListener('message', (event) => {
      const { type, payload } = event.data;
      if (type === 'response') {
        appendMsg(payload.text, 'edith');
      } else if (type === 'error') {
        appendMsg('Error: ' + payload.message, 'error');
      } else if (type === 'status') {
        if (payload.thinking !== undefined) setThinking(payload.thinking);
        if (payload.connected !== undefined) {
          statusBar.textContent = payload.connected ? '' : 'Disconnected from EDITH server.';
        }
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`
  }
}
