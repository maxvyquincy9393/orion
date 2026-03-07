# ============================================================
# Bulk rename: EDITH / EDITH / EDITH / EDITH / EDITH -> EDITH
# ============================================================

$root = "C:\Users\test\OneDrive\Desktop\EDITH"

# --- Exclude dirs ---
$excludePatterns = @('node_modules', '.git', 'coverage', 'dist', '.next')

function Should-Skip($path) {
    foreach ($p in $excludePatterns) {
        if ($path -match [regex]::Escape($p)) { return $true }
    }
    return $false
}

# --- Get text files ---
$extensions = @('.ts','.tsx','.js','.jsx','.json','.md','.yaml','.yml','.html','.css','.py','.txt','.sh','.bat','.cmd','.example','.toml','.cfg','.ini','.prisma','.sql','.ps1')
$extraNames = @('Dockerfile','docker-compose.yml','.env.example','.gitignore')

$allFiles = Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
    (-not (Should-Skip $_.FullName)) -and (($extensions -contains $_.Extension) -or ($extraNames -contains $_.Name))
}

Write-Host "=== EDITH Bulk Rename ===" -ForegroundColor Cyan
Write-Host "Root: $root"
Write-Host "Files to scan: $($allFiles.Count)"

# ------------------------------------------------------------------
# PHASE 1: Content replacements
# ------------------------------------------------------------------
# We use an ARRAY of pairs instead of hashtable to preserve order
$replacements = @(
    # Code identifiers (most specific first)
    ,@('EdithAgentGraph','EdithAgentGraph')
    ,@('EdithConfigCacheEntry','EdithConfigCacheEntry')
    ,@('EdithConfigSchema','EdithConfigSchema')
    ,@('loadEdithConfig','loadEdithConfig')
    ,@('writeEdithConfig','writeEdithConfig')
    ,@('getEdithConfig','getEdithConfig')
    ,@('injectEdithJsonEnv','injectEdithJsonEnv')
    ,@('loadExistingEdithJson','loadExistingEdithJson')
    ,@('loadRawEdithConfig','loadRawEdithConfig')
    ,@('buildEdithChildEnv','buildEdithChildEnv')
    ,@('EdithPlugin','EdithPlugin')
    ,@('EdithEventBus','EdithEventBus')
    ,@('EdithDaemon','EdithDaemon')
    ,@('EdithConfig','EdithConfig')
    ,@('edithConfig','edithConfig')
    ,@('edithTools','edithTools')
    ,@('edithUserId','edithUserId')
    ,@('edithProcess','edithProcess')
    ,@('edithOsAgent','edithOsAgent')
    ,@('edithJson','edithJson')
    ,@('EdithEvent','EdithEvent')
    ,@('toWhatsAppEdithUserId','toWhatsAppEdithUserId')
    ,@('toDiscordEdithUserId','toDiscordEdithUserId')
    ,@('parseEdithCliArgs','parseEdithCliArgs')
    ,@('isEdithRepoDir','isEdithRepoDir')
    ,@('findEdithRepoUpwards','findEdithRepoUpwards')
    ,@('readEdithConfig','readEdithConfig')
    ,@('getEdithOSConfig','getEdithOSConfig')

    # Constants
    ,@('EDITH_ALT_VOICES','EDITH_ALT_VOICES')
    ,@('EDITH_VOICE','EDITH_VOICE')
    ,@('EDITH_DSP','EDITH_DSP')
    ,@('EDITH_OCEAN','EDITH_OCEAN')

    # Env vars (specific first)
    ,@('EDITH_SYSTEM_TOOL_APPROVED','EDITH_SYSTEM_TOOL_APPROVED')
    ,@('EDITH_ALLOW_PROACTIVE_CHANNEL_SEND','EDITH_ALLOW_PROACTIVE_CHANNEL_SEND')
    ,@('EDITH_SAAS_MODE','EDITH_SAAS_MODE')
    ,@('EDITH_SAAS_DATA_DIR','EDITH_SAAS_DATA_DIR')
    ,@('EDITH_MEMORY_PERSIST','EDITH_MEMORY_PERSIST')
    ,@('EDITH_STATE_DIR','EDITH_STATE_DIR')
    ,@('EDITH_ENV_FILE','EDITH_ENV_FILE')
    ,@('EDITH_WORKSPACE','EDITH_WORKSPACE')
    ,@('EDITH_CONFIG_PATH','EDITH_CONFIG_PATH')
    ,@('EDITH_PROFILE_DIR','EDITH_PROFILE_DIR')
    ,@('EDITH_REPO_DIR','EDITH_REPO_DIR')
    ,@('EDITH_INSTANCE_ID','EDITH_INSTANCE_ID')
    ,@('EDITH_MODE','EDITH_MODE')

    # Import paths / file names
    ,@('edith-preset','edith-preset')
    ,@('edith-config','edith-config')
    ,@('edith-config','edith-config')
    ,@('edith.json','edith.json')
    ,@('edith.db','edith.db')
    ,@('edith.log','edith.log')
    ,@('edith.service','edith.service')

    # Dir paths
    ,@('.edith/','.edith/')
    ,@('.edith\','.edith\')
    ,@('.edith"','.edith"')

    # Temp file prefixes
    ,@('edith-bootstrap-','edith-bootstrap-')
    ,@('edith-saas-','edith-saas-')
    ,@('edith-logger-','edith-logger-')
    ,@('edith-rate-limit-','edith-rate-limit-')
    ,@('edith-working-','edith-working-')
    ,@('edith-episodic-','edith-episodic-')
    ,@('edith-stats-','edith-stats-')
    ,@('edith-code-','edith-code-')
    ,@('edith-tts-','edith-tts-')
    ,@('edith-vision-','edith-vision-')
    ,@('edith-ocr-','edith-ocr-')
    ,@('edith-screenshot-','edith-screenshot-')
    ,@('edith-iot-','edith-iot-')
    ,@('edith-alerts','edith-alerts')
    ,@('EDITH-ts','EDITH-ts')
    ,@('EDITH-mobile','EDITH-mobile')
    ,@('EDITH-desktop','EDITH-desktop')

    # Metrics/tokens
    ,@('edith_csrf_token','edith_csrf_token')
    ,@('edith_http_requests_total','edith_http_requests_total')
    ,@('edith_engine_calls_total','edith_engine_calls_total')
    ,@('edith_memory_retrievals_total','edith_memory_retrievals_total')
    ,@('edith_bot','edith_bot')
    ,@('edith_','edith_')

    # User agents
    ,@('EDITH-Agent','EDITH-Agent')
    ,@('EdithBot','EdithBot')

    # EDITH compound forms
    ,@('EDITH-style','EDITH-style')
    ,@('EDITH-inspired','EDITH-inspired')
    ,@('EDITH-like','EDITH-like')
    ,@('EDITH-alignment','EDITH-alignment')
    ,@('EDITH-Compatible','EDITH-Compatible')
    ,@('edith.json','edith.json')
    ,@('edith.ai','edith.ai')
    ,@('~/.edith/','~/.edith/')

    # EDITH compound forms
    ,@('EDITH-style','EDITH-style')
    ,@('EDITH-level','EDITH-level')
    ,@('EDITH-like','EDITH-like')

    # EDITH compound forms
    ,@('EDITH','EDITH')

    # EDITH compound forms
    ,@('EDITH-ts','EDITH-ts')
    ,@('edith.vision','edith.vision')
    ,@('edith.voice','edith.voice')
    ,@('EDITH-mobile','EDITH-mobile')

    # Wake words
    ,@('Hey EDITH','Hey EDITH')
    ,@('hey-edith','hey-edith')
    ,@('hey edith','hey edith')
    ,@('halo edith','halo edith')

    # CLI commands
    ,@('edith link','edith link')
    ,@('edith repo','edith repo')
    ,@('edith profile','edith profile')
    ,@('edith setup','edith setup')
    ,@('edith init','edith init')
    ,@('edith quickstart','edith quickstart')
    ,@('edith configure','edith configure')
    ,@('edith dashboard','edith dashboard')
    ,@('edith status','edith status')
    ,@('edith logs','edith logs')
    ,@('edith channels','edith channels')
    ,@('edith self-test','edith self-test')
    ,@('edith wa ','edith wa ')
    ,@('edith all','edith all')
    ,@('edith gateway','edith gateway')
    ,@('edith doctor','edith doctor')
    ,@('edith onboard','edith onboard')
    ,@('edith --help','edith --help')
    ,@('edith --dev','edith --dev')
    ,@('edith --profile','edith --profile')

    # Catch-all brand replacements (broadest — LAST)
    ,@('EDITH','EDITH')
    ,@('edith','edith')
    ,@('EDITH','EDITH')
    ,@('EDITH','EDITH')
    ,@('EDITH','EDITH')
    ,@('edith','edith')
    ,@('EDITH','EDITH')
    ,@('EDITH','EDITH')
    ,@('edith','edith')
    ,@('EDITH','EDITH')
    ,@('edith','edith')
)

Write-Host "`nPhase 1: Content replacement..." -ForegroundColor Yellow
$changedCount = 0

foreach ($file in $allFiles) {
    try {
        $content = [System.IO.File]::ReadAllText($file.FullName)
        $original = $content

        foreach ($pair in $replacements) {
            $old = $pair[0]
            $new = $pair[1]
            if ($old -ne $new) {
                $content = $content.Replace($old, $new)
            }
        }

        if ($content -ne $original) {
            [System.IO.File]::WriteAllText($file.FullName, $content)
            $changedCount++
            $rel = $file.FullName.Substring($root.Length)
            Write-Host "  + $rel" -ForegroundColor Green
        }
    }
    catch {
        Write-Host "  ! SKIP $($file.Name): $_" -ForegroundColor Red
    }
}
Write-Host "  Done: $changedCount files changed" -ForegroundColor Cyan

# ------------------------------------------------------------------
# PHASE 2: File renames
# ------------------------------------------------------------------
Write-Host "`nPhase 2: File renames..." -ForegroundColor Yellow

$renames = @(
    ,@("EDITH-ts\src\config\edith-config.ts", "EDITH-ts\src\config\edith-config.ts")
    ,@("EDITH-ts\src\config\edith-config.ts", "EDITH-ts\src\config\edith-config-legacy.ts")
    ,@("EDITH-ts\bin\edith.js", "EDITH-ts\bin\edith.js")
    ,@("EDITH-ts\bin\edith.d.ts", "EDITH-ts\bin\edith.d.ts")
    ,@("EDITH-ts\src\cli\__tests__\edith-global.test.ts", "EDITH-ts\src\cli\__tests__\edith-global.test.ts")
    ,@("EDITH-ts\src\voice\edith-preset.ts", "EDITH-ts\src\voice\edith-preset.ts")
    ,@("EDITH-ts\docs\phase-11-tars-voice.md", "EDITH-ts\docs\phase-11-edith-voice.md")
    ,@("EDITH-ts\docs\research-prompts\phase-H-edith-os-agent.md", "EDITH-ts\docs\research-prompts\phase-H-edith-os-agent.md")
    ,@("EDITH-ts\logs\edith.log", "EDITH-ts\logs\edith.log")
    ,@("EDITH-ts\logs\edith.log.1", "EDITH-ts\logs\edith.log.1")
    ,@("EDITH-ts\prisma\edith.db", "EDITH-ts\prisma\edith.db")
)

foreach ($r in $renames) {
    $oldPath = Join-Path $root $r[0]
    $newPath = Join-Path $root $r[1]
    if (Test-Path $oldPath) {
        Move-Item -Path $oldPath -Destination $newPath -Force
        Write-Host "  + $($r[0]) -> $($r[1])" -ForegroundColor Green
    } else {
        Write-Host "  - NOT FOUND: $($r[0])" -ForegroundColor DarkGray
    }
}

Write-Host "`n=== EDITH Rename Complete ===" -ForegroundColor Cyan
