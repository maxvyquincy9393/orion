# EDITH Stage 0 — Get It Running

## Project Context

EDITH is a personal AI companion (Jarvis-style) built in TypeScript/Node.js ESM with a pnpm monorepo. The codebase is architecturally complete but has never been verified to run end-to-end. Your job is to fix the blocking issues so `pnpm dev` works and EDITH replies to a message.

**Stack:** TypeScript (ESM) · Prisma (SQLite) · Fastify gateway · LanceDB vector memory · pnpm  
**Entry:** `src/main.ts` → `src/core/startup.ts` → `src/core/message-pipeline.ts`  
**Key config files:** `.env` (environment), `edith.json` (runtime config + credentials), `src/config.ts` (Zod schema), `src/config/edith-config.ts` (edith.json schema)

---

## Confirmed Blocking Issues

### ISSUE 1 — `permissions/permissions.yaml` does not exist

`src/permissions/sandbox.ts` → `load(filePath)` does `fs.readFile(absolutePath)`. If the file doesn't exist it catches the error and sets `this.config = {}`.

When `config = {}`, **every single `check()` call returns `false`** because:
```typescript
const section = this.config[sectionKey]
if (!section) {
  return false  // ← always hits this
}
```

This silently blocks: file read, file write, terminal, messaging, calendar, browser — every permission-gated tool returns false.

**Fix:** Create `permissions/permissions.yaml` at project root with sane defaults that enable the core tools EDITH needs to function. The sandbox loads it via the config value `PERMISSIONS_FILE=permissions/permissions.yaml` (default in `.env.example`).

The structure expected by `sandbox.ts` based on `ACTION_TO_SECTION` mapping:
```typescript
const ACTION_TO_SECTION = {
  "messaging.send":     "messaging",
  "proactive.message":  "proactive",
  "files.read":         "file_system",
  "files.write":        "file_system",
  "terminal.run":       "terminal",
  "calendar.read":      "calendar",
  "calendar.write":     "calendar",
  "browser.search":     "search",
  "browser.navigate":   "browsing",
}
```

And the `PermissionSection` interface:
```typescript
interface PermissionSection {
  enabled?: boolean
  require_confirm?: boolean
  read?: boolean
  write?: boolean
  blocked_paths?: string[]
  allowed_paths?: string[]
  blocked_commands?: string[]
  allowed_domains?: string[]
  blocked_domains?: string[]
  quiet_hours?: { start: string; end: string }
}
```

---

### ISSUE 2 — `edith.json` has no `credentials` section

`src/config.ts` calls `mergeEdithJsonCredentials()` at startup which reads `edithConfig.credentials`. The current `edith.json` only has `agents`, `computerUse`, and `channels` — **no `credentials` key**.

`src/config/edith-config.ts` defines `CredentialsSchema` with these keys:
```
GROQ_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY,
OPENROUTER_API_KEY, OLLAMA_BASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID, ...
```

Without a `credentials` section, `mergeEdithJsonCredentials()` finds no keys to overlay → silently falls back to `.env` values. This is fine IF the user has `.env` set up. But for desktop/open-source users relying on `edith.json`, credentials never load.

**Fix:** Add a `credentials` section to `edith.json` so users can put their API key there directly. The `mergeEdithJsonCredentials()` function already handles this — it just needs the section to exist with at least one key.

---

### ISSUE 3 — No API key = no engine = no response

`src/engines/orchestrator.ts` → `init()` checks `isAvailable()` per engine. If zero engines are available, startup logs `"no engines available"` and every `generate()` call throws or returns empty.

The easiest free key to get: **Groq** (free at console.groq.com) or **Gemini** (free at aistudio.google.com).

**Fix:** Ensure at least one API key is present either in:
- `.env` as `GROQ_API_KEY=gsk_xxx` 
- OR `edith.json` under `credentials.GROQ_API_KEY`

---

### ISSUE 4 — OOBE wizard doesn't persist credentials (desktop only)

`apps/desktop/renderer/onboarding.html` Step 3 (Credentials) calls `saveCredentials()` which currently only does `console.log` — the keys are **never written to `.env` or `edith.json`**.

This means users who go through the desktop setup wizard still have no credentials saved after completing it.

**Fix in `apps/desktop/main.js`:** Add IPC handler `oobe:save-credentials` that writes credentials to `edith.json` using `saveEDITHConfig({ credentials: {...} })` pattern.

**Fix in `apps/desktop/preload.js`:** Expose `saveCredentials` via `contextBridge`.

**Fix in `onboarding.html`:** Call `window.edith.saveCredentials(credentials)` instead of `console.log`.

---

## Your Tasks

### Task 1: Create `permissions/permissions.yaml`

Create this file at `permissions/permissions.yaml` (project root, same level as `package.json`).

Enable all core sections. For `terminal`, enable but block dangerous commands. For `file_system`, enable with safe defaults. Do NOT use `require_confirm: true` for basic messaging — that would require a human-in-the-loop for every single response which breaks headless CLI mode.

### Task 2: Add `credentials` section to `edith.json`

Add a `credentials` object to `edith.json` with all keys from `CredentialsSchema` defaulting to empty string, so users can fill in their key. The structure should match what `mergeEdithJsonCredentials()` expects.

Example minimal addition:
```json
{
  "credentials": {
    "GROQ_API_KEY": "",
    "GEMINI_API_KEY": "",
    "ANTHROPIC_API_KEY": "",
    "OPENAI_API_KEY": "",
    "OPENROUTER_API_KEY": "",
    "OLLAMA_BASE_URL": "",
    "TELEGRAM_BOT_TOKEN": "",
    "TELEGRAM_CHAT_ID": ""
  },
  "agents": { ... existing ... },
  ...
}
```

**Tell the user** to fill in at least one of: `GROQ_API_KEY` or `GEMINI_API_KEY` (both free).

### Task 3: Fix OOBE credential persistence (desktop)

In `apps/desktop/main.js`, add:
```javascript
ipcMain.handle("oobe:save-credentials", async (_, credentials) => {
  // Write credentials to edith.json using fs
  // Read existing edith.json → merge credentials section → write back
  // Return { ok: true } or { ok: false, error: string }
})
```

In `apps/desktop/preload.js`, add to contextBridge:
```javascript
saveCredentials: (credentials) => ipcRenderer.invoke("oobe:save-credentials", credentials),
```

In `apps/desktop/renderer/onboarding.html`, find the `saveCredentials()` function and replace the `console.log` with:
```javascript
await window.edith.saveCredentials(credentials)
```

### Task 4: Verify startup flow

After Tasks 1-3, trace through startup to confirm:
1. `permissions/permissions.yaml` loads correctly and `sandbox.check(PermissionAction.SEND_MESSAGE, ...)` returns `true`
2. `mergeEdithJsonCredentials()` reads `edith.json.credentials` and overlays onto config
3. `orchestrator.getAvailableEngines()` returns at least 1 engine if key is present
4. `processMessage("owner", "hello", { channel: "cli" })` returns a non-empty string

---

## Files to Read First

Before writing any code, read these files to understand the full picture:
- `src/permissions/sandbox.ts` — full permission check logic
- `src/config/edith-config.ts` — `CredentialsSchema`, `loadEDITHConfig()`, `saveEDITHConfig()`
- `src/config.ts` — `mergeEdithJsonCredentials()` function (bottom of file)
- `edith.json` — current state (no credentials section)
- `apps/desktop/main.js` — existing IPC handlers to understand pattern
- `apps/desktop/preload.js` — existing contextBridge setup
- `apps/desktop/renderer/onboarding.html` — find `saveCredentials()` function

---

## Constraints

- DO NOT change `src/config.ts` schema — it's large and works correctly
- DO NOT change `src/permissions/sandbox.ts` logic — just create the missing yaml
- DO NOT add new npm packages for Tasks 1-3 — use existing deps only (`fs`, `js-yaml` already imported in sandbox.ts)
- `edith.json` must remain valid JSON after your changes
- `permissions.yaml` must be valid YAML
- All changes should be minimal — fix the blocking issues, don't refactor

---

## Success Criteria

```
[ ] pnpm dev starts without crashing
[ ] Log shows "engines loaded: [groq]" (or whichever key is set)
[ ] Log shows "permissions loaded" (not "failed to load permissions")
[ ] Sending a message via CLI or WebChat receives a response
[ ] OOBE wizard step 3 saves credentials to edith.json (desktop)
```

---

## Notes for the AI

- The project uses TypeScript ESM — all imports need `.js` extension even for `.ts` files
- `edith.json` is read from `process.cwd()/edith.json` by `loadEDITHConfig()`
- `permissions.yaml` path is resolved via `path.resolve(filePath)` in sandbox.ts where `filePath` comes from `config.PERMISSIONS_FILE` which defaults to `"permissions/permissions.yaml"`
- `mergeEdithJsonCredentials()` is async and called with `await` in startup — it silently catches errors and falls back to env vars, so it won't crash if credentials are empty, but it WILL fail to load keys if the `credentials` section doesn't exist in edith.json
