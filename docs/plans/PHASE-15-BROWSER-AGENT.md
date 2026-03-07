# Phase 15 — Browser Agent (Deep Web Automation)

> "JARVIS bisa hack Departemen Pertahanan. EDITH minimal harus bisa book tiket kereta."

**Prioritas:** 🟡 MEDIUM-HIGH — Beda dari Phase 7 (Computer Use).
**Depends on:** Phase 7 (computer use / vision fallback), Phase 17 (credential vault)
**Status:** ❌ Not started

---

## 1. Tujuan

Phase 7 (Computer Use) = screenshot → klik pixel. Ini = **purpose-built browser automation**
dengan DOM awareness, form filling cerdas, session management, dan web scraping terstruktur.
EDITH bisa browse web, fill forms, extract data, dan complete tasks — di browser nyata.

```mermaid
flowchart TD
    subgraph UserRequest["💬 User Request"]
        NL["'EDITH, book tiket kereta Bandung\nSabtu pagi, budget bawah 200k'"]
    end

    subgraph BrowserAgent["🌐 Browser Agent"]
        Planner["Task Planner\n(NL → action sequence)"]
        Browser["Playwright Browser\n(headless / headful)"]
        DOM["DOM Parser\n(simplified tree,\ninteractable elements)"]
        Vision["Vision Fallback\n(Phase 7 screenshot\nif DOM fails)"]
        Session["Session Manager\n(cookies, login state)"]
    end

    subgraph Actions["⚡ Action Types"]
        Navigate["Navigate to URL"]
        Click["Click element"]
        Fill["Fill form field"]
        Extract["Extract data"]
        Wait["Wait for element"]
        Screenshot["Screenshot + OCR"]
    end

    subgraph Safety["🛡️ Safety"]
        Confirm["Confirm before payment"]
        Budget["Budget limit check"]
        CAPTCHA["CAPTCHA → ask user"]
    end

    NL --> Planner --> Browser --> DOM --> Actions
    DOM -->|"DOM parse fails"| Vision
    Actions --> Safety
```

---

## 2. Research References

| # | Paper / Project | ID | Kontribusi ke EDITH |
|---|-----------------|-----|---------------------|
| 1 | WebAgent: LLM-driven Browser Agent | arXiv:2307.12856 | HTML understanding → action generation, multi-step web tasks |
| 2 | Mind2Web: Cross-Website Generalization | arXiv:2306.06070 | Generalize web automation across unseen websites |
| 3 | WebArena: Realistic Web Task Benchmark | arXiv:2307.13854 | Benchmark for evaluating autonomous web agents |
| 4 | Browser Use (open source, 2024) | github.com/browser-use | Playwright + LLM integration pattern, production-ready |
| 5 | SeeAct: GPT-4V Web Agent | arXiv:2401.01614 | Vision-based web agent — click based on screenshot |
| 6 | Playwright (Microsoft) | playwright.dev | Browser automation: Chrome, Firefox, WebKit |
| 7 | AgentQL: Web Element Query Language | agentql.com | Natural language → DOM element selection |
| 8 | Skyvern (open source) | github.com/Skyvern-AI | Visual web automation without pre-mapped selectors |

---

## 3. Arsitektur

### 3.1 Kontrak Arsitektur

```
Rule 1: DOM-first, Vision-fallback.
        Try structured DOM parsing first (faster, more accurate).
        If DOM is obfuscated/complex → fallback to Phase 7 screenshot vision.

Rule 2: Never auto-submit payments or sensitive actions.
        Payment forms → ALWAYS confirm with user.
        Login with stored credentials → confirm first time, remember preference.

Rule 3: Session persistence across requests.
        Login once → cookies stored in encrypted session store.
        Next request to same site → already logged in.

Rule 4: Rate limiting and politeness.
        Respect robots.txt (configurable override).
        Max 1 request per second per domain (default).
        Concurrent tabs: max 5 (configurable).

Rule 5: DOM simplification before LLM.
        Raw DOM is too large for context windows.
        Simplify: keep only interactable elements with attributes.
        Result: slim action tree that LLM can reason about.
```

### 3.2 System Architecture

```mermaid
flowchart TD
    subgraph Core["🧠 Browser Agent Core"]
        TaskPlanner["Task Planner\n(NL → step sequence)"]
        ActionLoop["Action Loop\n(observe → think → act)"]
        StateTracker["State Tracker\n(current page, form state,\nnavigation history)"]
    end

    subgraph Browser["🌐 Browser Layer"]
        PW["Playwright\n(Chrome headless)"]
        DOMSimplifier["DOM Simplifier\n(100k DOM → 2k action tree)"]
        ScreenCapture["Screen Capture\n(for vision fallback)"]
        SessionMgr["Session Manager\n(cookies, localStorage)"]
    end

    subgraph Intelligence["🧠 Intelligence"]
        ElementSelector["Element Selector\n(which button to click?)"]
        FormFiller["Form Filler\n(map intent → fields)"]
        DataExtractor["Data Extractor\n(scrape structured data)"]
        ErrorRecovery["Error Recovery\n(retry, different approach)"]
    end

    subgraph Safety["🛡️ Safety Layer"]
        PaymentGate["Payment Gate\n(always confirm)"]
        CredentialVault["Credential Vault\n(Phase 17)"]
        BudgetCheck["Budget Check\n(max spend limit)"]
        DomainAllowlist["Domain Allowlist\n(which sites allowed)"]
    end

    TaskPlanner --> ActionLoop
    ActionLoop <--> PW
    PW --> DOMSimplifier --> ElementSelector
    PW --> ScreenCapture
    ActionLoop --> StateTracker
    ActionLoop --> FormFiller & DataExtractor
    ActionLoop --> ErrorRecovery
    ActionLoop --> Safety
```

### 3.3 Cross-Device (Phase 27 Integration)

```mermaid
flowchart LR
    subgraph Phone["📱 Phone"]
        PhoneReq["'EDITH, book tiket\nkereta besok'"]
        PhoneResult["📸 Screenshot result\n+ confirmation card"]
    end

    subgraph Gateway["🌐 Gateway"]
        BrowserAgent["Browser Agent\n(runs on laptop/server)"]
        ResultSync["Result Sync\n(screenshots + data)"]
    end

    subgraph Laptop["💻 Laptop"]
        LaptopBrowser["Headful browser\n(user can watch)"]
        LaptopApprove["Approve payment\nfrom laptop"]
    end

    PhoneReq --> Gateway
    Gateway --> BrowserAgent --> LaptopBrowser
    BrowserAgent --> ResultSync --> PhoneResult
    LaptopApprove --> BrowserAgent
```

---

## 4. Sub-Phase Breakdown

```mermaid
flowchart LR
    A["15A\nBrowser Core\n(Playwright)"]
    B["15B\nDOM Simplifier\n& Element Selection"]
    C["15C\nSmart Form\nFilling"]
    D["15D\nWeb Research\nAgent"]
    E["15E\nSession &\nCredential Mgmt"]
    F["15F\nAutomation\nRecipes"]

    A --> B --> C
    B --> D
    A --> E
    C --> F
```

---

### Phase 15A — Browser Core (Playwright)

**Goal:** Playwright-powered browser with observe-think-act loop.

```mermaid
stateDiagram-v2
    [*] --> Navigate
    Navigate --> Observe : Page loaded
    
    Observe --> Think : DOM simplified + screenshot
    Think --> Act : LLM decides action
    
    Act --> Click : "Click 'Book Now' button"
    Act --> Fill : "Type 'Bandung' in destination"
    Act --> Navigate : "Go to checkout page"
    Act --> Extract : "Get all prices from table"
    Act --> Wait : "Wait for loading spinner"
    Act --> Done : "Task complete"
    
    Click --> Observe : Page may have changed
    Fill --> Observe
    Navigate --> Observe
    Wait --> Observe
    
    Done --> [*]
    
    Observe --> Error : Unexpected page state
    Error --> Recovery : Try different approach
    Recovery --> Observe
```

```typescript
/**
 * @module browser/browser-core
 * Playwright browser automation with observe-think-act loop.
 */

import { chromium, type Browser, type Page } from 'playwright';

interface BrowserAction {
  type: 'click' | 'fill' | 'navigate' | 'extract' | 'wait' | 'screenshot' | 'scroll';
  selector?: string;
  value?: string;
  url?: string;
  description: string;
}

interface PageState {
  url: string;
  title: string;
  actionTree: ActionElement[];    // simplified DOM
  screenshot?: Buffer;
  formState: Record<string, string>;
}

class BrowserCore {
  private browser: Browser | null = null;
  private page: Page | null = null;
  
  async launch(headless: boolean = true): Promise<void> {
    this.browser = await chromium.launch({
      headless,
      args: ['--disable-web-security', '--no-sandbox'],
    });
    const context = await this.browser.newContext({
      userAgent: 'EDITH-Browser-Agent/1.0',
      viewport: { width: 1280, height: 720 },
    });
    this.page = await context.newPage();
  }
  
  /**
   * Observe current page state: simplified DOM + optional screenshot.
   */
  async observe(): Promise<PageState> {
    if (!this.page) throw new Error('Browser not launched');
    
    const [actionTree, screenshot] = await Promise.all([
      this.simplifyDOM(),
      this.page.screenshot({ type: 'png' }),
    ]);
    
    return {
      url: this.page.url(),
      title: await this.page.title(),
      actionTree,
      screenshot,
      formState: await this.getFormState(),
    };
  }
  
  /**
   * Execute a browser action.
   */
  async act(action: BrowserAction): Promise<void> {
    if (!this.page) throw new Error('Browser not launched');
    
    switch (action.type) {
      case 'navigate':
        await this.page.goto(action.url!, { waitUntil: 'domcontentloaded' });
        break;
      case 'click':
        await this.page.click(action.selector!, { timeout: 10000 });
        break;
      case 'fill':
        await this.page.fill(action.selector!, action.value!);
        break;
      case 'wait':
        await this.page.waitForSelector(action.selector!, { timeout: 15000 });
        break;
      case 'scroll':
        await this.page.mouse.wheel(0, 500);
        break;
    }
  }
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/browser/browser-core.ts` | CREATE | ~200 |
| `EDITH-ts/src/browser/types.ts` | CREATE | ~100 |
| `EDITH-ts/src/browser/__tests__/browser-core.test.ts` | CREATE | ~120 |

---

### Phase 15B — DOM Simplifier & Element Selection

**Goal:** 100k DOM → 2k actionable element tree.

```mermaid
flowchart TD
    RawDOM["Raw DOM\n(100,000+ nodes)"]
    
    RawDOM --> Filter["Filter Non-Interactable\n(remove: script, style, hidden,\ncomments, SVG internals)"]
    
    Filter --> Extract["Extract Actions\n(buttons, links, inputs,\nselects, textareas)"]
    
    Extract --> Simplify["Simplify Attributes\n(keep: id, class, text,\naria-label, placeholder,\nhref, type, value)"]
    
    Simplify --> Index["Index Elements\n([1] Login button\n[2] Email input\n[3] Password input\n[4] Submit button)"]
    
    Index --> ActionTree["Action Tree\n(~50-200 elements,\n<2000 tokens)"]
```

```typescript
/**
 * @module browser/dom-simplifier
 * Simplifies full DOM into actionable element tree for LLM consumption.
 */

interface ActionElement {
  index: number;              // [1], [2], ...
  tag: string;                // 'button', 'input', 'a', 'select'
  text: string;               // visible text or label
  attributes: {
    id?: string;
    type?: string;
    placeholder?: string;
    href?: string;
    ariaLabel?: string;
    value?: string;
  };
  isVisible: boolean;
  boundingBox: { x: number; y: number; width: number; height: number };
}

class DOMSimplifier {
  /**
   * Reduce full DOM to actionable elements only.
   * @param page - Playwright page
   * @returns Simplified action tree with indexed elements
   */
  async simplify(page: Page): Promise<ActionElement[]> {
    return page.evaluate(() => {
      const interactableTags = new Set([
        'a', 'button', 'input', 'select', 'textarea', 'summary', 'details'
      ]);
      const interactableRoles = new Set([
        'button', 'link', 'textbox', 'checkbox', 'radio', 'tab',
        'menuitem', 'option', 'switch', 'combobox'
      ]);
      
      const elements: ActionElement[] = [];
      let index = 0;
      
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role');
        
        if (!interactableTags.has(tag) && !interactableRoles.has(role ?? '')) continue;
        
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        
        elements.push({
          index: ++index,
          tag,
          text: (el.textContent ?? '').trim().slice(0, 100),
          attributes: {
            id: el.id || undefined,
            type: (el as HTMLInputElement).type || undefined,
            placeholder: (el as HTMLInputElement).placeholder || undefined,
            href: (el as HTMLAnchorElement).href || undefined,
            ariaLabel: el.getAttribute('aria-label') || undefined,
          },
          isVisible: true,
          boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        });
      }
      
      return elements;
    });
  }
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/browser/dom-simplifier.ts` | CREATE | ~150 |
| `EDITH-ts/src/browser/element-selector.ts` | CREATE | ~100 |

---

### Phase 15C — Smart Form Filling

**Goal:** Map user intent to form fields without hardcoded selectors.

```mermaid
sequenceDiagram
    participant User
    participant Planner as Task Planner
    participant Browser as Browser
    participant DOM as DOM Simplifier
    participant LLM as LLM Engine

    User->>Planner: "Book tiket kereta Bandung Sabtu pagi budget 200k"
    Planner->>Browser: navigate("https://tiket.kereta-api.co.id")
    Browser->>DOM: simplify()
    DOM-->>LLM: "[1] From: input (placeholder: 'Departure city')\n[2] To: input (placeholder: 'Arrival city')\n[3] Date: input (type: date)\n[4] Passengers: select\n[5] Search: button"
    
    LLM-->>Browser: actions: [\n  {fill: [1], value: "Jakarta"},\n  {fill: [2], value: "Bandung"},\n  {fill: [3], value: "2024-03-09"},\n  {click: [5]}\n]
    
    Browser->>Browser: Execute actions sequentially
    Browser->>DOM: simplify() (results page)
    DOM-->>LLM: "[1] Train A - 06:00 - Rp 150.000\n[2] Train B - 08:00 - Rp 180.000\n[3] Train C - 10:00 - Rp 250.000"
    
    LLM-->>User: "Ada 2 opsi dalam budget:\n1. Train A — 06:00 — Rp 150.000\n2. Train B — 08:00 — Rp 180.000\n\nMau yang mana?"
```

```typescript
/**
 * @module browser/form-filler
 * Maps user intent to form fields using LLM reasoning.
 */

interface FormField {
  index: number;
  label: string;
  type: string;          // text, email, password, date, select
  placeholder?: string;
  currentValue?: string;
  options?: string[];    // for select elements
  required: boolean;
}

interface FillPlan {
  fields: Array<{
    fieldIndex: number;
    value: string;
    confidence: number;
  }>;
  missingInfo: string[];  // info we need from user
}

class SmartFormFiller {
  /**
   * Generate fill plan from user intent + detected form fields.
   */
  async planFill(
    intent: string,
    fields: FormField[],
    userContext: Record<string, string>
  ): Promise<FillPlan> {
    const prompt = `Given the user's request and the form fields below, determine what to fill in each field.
If information is missing, list what's needed.

User request: "${intent}"
User context: ${JSON.stringify(userContext)}

Form fields:
${fields.map(f => `[${f.index}] ${f.label} (${f.type}${f.placeholder ? `, hint: "${f.placeholder}"` : ''}${f.required ? ', required' : ''})`).join('\n')}

Respond in JSON: {"fields": [{"fieldIndex": N, "value": "..."}], "missingInfo": ["..."]}`;

    return this.engine.generateJSON<FillPlan>(prompt);
  }
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/browser/form-filler.ts` | CREATE | ~150 |
| `EDITH-ts/src/browser/__tests__/form-filler.test.ts` | CREATE | ~100 |

---

### Phase 15D — Web Research Agent

**Goal:** Multi-tab parallel research with structured data extraction.

```mermaid
flowchart TD
    Query["User: 'Compare 3 hotel Bali\nbintang 4, bawah 800k,\ncompare fasilitas'"]
    
    Query --> Plan["Research Plan:\n1. Search Traveloka\n2. Search Tiket.com\n3. Search Booking.com"]
    
    Plan --> Par["Parallel Execution\n(3 tabs simultaneously)"]
    
    subgraph Tab1["Tab 1: Traveloka"]
        T1_Nav["Navigate + search"] --> T1_Extract["Extract: name, price,\nrating, facilities"]
    end
    
    subgraph Tab2["Tab 2: Tiket.com"]
        T2_Nav["Navigate + search"] --> T2_Extract["Extract: name, price,\nrating, facilities"]
    end
    
    subgraph Tab3["Tab 3: Booking.com"]
        T3_Nav["Navigate + search"] --> T3_Extract["Extract: name, price,\nrating, facilities"]
    end
    
    Par --> Tab1 & Tab2 & Tab3
    
    T1_Extract & T2_Extract & T3_Extract --> Synthesize["Synthesize:\nMerge results,\nremove duplicates,\ncompare + rank"]
    
    Synthesize --> Result["Structured Result:\n| Hotel | Price | Rating | Pool | WiFi | Breakfast |\n| ...   | ...   | ...    | ...  | ...  | ...       |"]
```

```typescript
/**
 * @module browser/research-agent
 * Multi-source web research with parallel extraction and synthesis.
 */

interface ResearchResult {
  query: string;
  sources: SourceResult[];
  synthesis: string;            // LLM-generated comparison
  structuredData?: Record<string, unknown>[];  // extracted table data
  citations: { url: string; title: string; extractedAt: Date }[];
}

interface SourceResult {
  url: string;
  title: string;
  extractedData: Record<string, unknown>[];
  rawText: string;
  screenshot?: Buffer;
}

class WebResearchAgent {
  /**
   * Conduct parallel research across multiple sources.
   * @param query - Research query
   * @param sources - URLs or search engines to use
   * @param maxTabs - Maximum concurrent tabs (default: 3)
   */
  async research(
    query: string,
    sources: string[],
    maxTabs: number = 3
  ): Promise<ResearchResult> {
    // 1. Plan: what sites to visit, what data to extract
    const plan = await this.planResearch(query, sources);
    
    // 2. Execute in parallel (batched by maxTabs)
    const results = await this.executeParallel(plan, maxTabs);
    
    // 3. Deduplicate + merge
    const merged = this.mergeResults(results);
    
    // 4. Synthesize with LLM
    const synthesis = await this.synthesize(query, merged);
    
    return {
      query,
      sources: results,
      synthesis,
      structuredData: merged,
      citations: results.map(r => ({
        url: r.url, title: r.title, extractedAt: new Date()
      })),
    };
  }
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/browser/research-agent.ts` | CREATE | ~200 |
| `EDITH-ts/src/browser/data-extractor.ts` | CREATE | ~120 |

---

### Phase 15E — Session & Credential Management

**Goal:** Persistent login sessions + secure credential storage.

```mermaid
flowchart TD
    subgraph SessionStore["🔐 Session Store"]
        Cookies["Encrypted Cookie Jar\n(per-domain)"]
        LocalStorage["LocalStorage Snapshot\n(per-domain)"]
        Auth["Auth Tokens\n(from Phase 17 vault)"]
    end

    subgraph Flow["Login Flow"]
        First["First Visit\n(no session)"]
        First --> HasCreds{"Credentials\nin vault?"}
        HasCreds -->|"Yes"| AutoLogin["Auto-fill login\n(with user confirmation)"]
        HasCreds -->|"No"| AskUser["Ask user to login\nmanually (headful mode)"]
        AutoLogin --> SaveSession["Save cookies\n+ localStorage"]
        AskUser --> SaveSession
    end

    subgraph Reuse["Session Reuse"]
        NextVisit["Next Visit\n(has session)"]
        NextVisit --> LoadSession["Load cookies\nfrom encrypted store"]
        LoadSession --> CheckValid{"Session\nstill valid?"}
        CheckValid -->|"Yes"| Continue["Continue (no login needed)"]
        CheckValid -->|"No"| First
    end
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/browser/session-manager.ts` | CREATE | ~120 |
| `EDITH-ts/src/browser/credential-bridge.ts` | CREATE | ~80 |

---

### Phase 15F — Automation Recipes

**Goal:** Pre-built + user-defined automation templates.

```mermaid
flowchart TD
    subgraph Prebuilt["📦 Pre-built Recipes"]
        Tiket["🚂 Tiket Kereta\n(kereta-api.co.id)"]
        Traveloka["✈️ Traveloka\n(hotel + flight)"]
        Tokopedia["🛒 Tokopedia\n(product search)"]
        LinkedIn["💼 LinkedIn\n(job search)"]
        GitHub["🐙 GitHub\n(PR review, issue)"]
    end

    subgraph Custom["🛠️ User-Defined Recipes"]
        Record["Record: user describes\nstep-by-step in NL"]
        Template["EDITH creates\nautomation template"]
        Test["Test run\n(dry-run mode)"]
        Save["Save to\nskill library"]
    end

    subgraph Execute["▶️ Execution"]
        Match["Intent matches\nrecipe?"]
        Match -->|"Yes"| UseRecipe["Use recipe\n(faster, more reliable)"]
        Match -->|"No"| Freeform["Freeform agent\n(LLM-driven)"]
    end
```

```json
{
  "browserAgent": {
    "enabled": true,
    "headless": true,
    "maxConcurrentTabs": 5,
    "requestsPerSecondPerDomain": 1,
    "respectRobotsTxt": true,
    "domainAllowlist": ["*"],
    "domainBlocklist": ["*.gov", "*.mil"],
    "autoLoginConfirmation": true,
    "maxBudgetPerSession": 0,
    "screenshotOnEveryStep": false,
    "timeout": 30000
  }
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/browser/recipe-engine.ts` | CREATE | ~120 |
| `EDITH-ts/src/browser/recipes/tiket-kereta.ts` | CREATE | ~80 |
| `EDITH-ts/src/skills/browser-skill.ts` | CREATE | ~100 |

---

## 5. Acceptance Gates

```
□ Playwright launches headless Chrome successfully
□ DOM simplifier: 100k DOM → <200 actionable elements
□ Navigate + click + fill form on real website
□ Smart form filling: map "book tiket Bandung" → form fields
□ Web research: parallel 3-tab extraction + synthesis
□ Structured data extraction: prices, dates, names from results page
□ Session persistence: login once → cookies saved → auto-restore
□ CAPTCHA detection → ask user (no auto-solve)
□ Payment gate: ALWAYS confirm before purchase
□ Budget check: reject if over user's limit
□ Domain allowlist/blocklist enforcement
□ Error recovery: page load failure → retry with different approach
□ Vision fallback: when DOM parsing fails → use screenshot (Phase 7)
□ Cross-device: start browser task from phone → executes on laptop (Phase 27)
□ Rate limiting: respect 1 req/sec default
```

---

## 6. Koneksi ke Phase Lain

| Phase | Integration | Protocol |
|-------|------------|----------|
| Phase 7 (Computer Use) | Vision fallback when DOM parsing fails | screenshot_analyze |
| Phase 13 (Knowledge) | Save extracted web data to knowledge base | ingest_content |
| Phase 14 (Calendar) | "Book meeting room" on web portal | browser_task |
| Phase 17 (Privacy) | Credential vault for auto-login | vault_read |
| Phase 22 (Mission) | Browser tasks as mission sub-tasks | task_execute |
| Phase 25 (Simulation) | Preview browser actions before execution | preview_mode |
| Phase 27 (Cross-Device) | Trigger browser task from phone | remote_execute |

---

## 7. File Changes Summary

| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/browser/browser-core.ts` | CREATE | ~200 |
| `EDITH-ts/src/browser/types.ts` | CREATE | ~100 |
| `EDITH-ts/src/browser/dom-simplifier.ts` | CREATE | ~150 |
| `EDITH-ts/src/browser/element-selector.ts` | CREATE | ~100 |
| `EDITH-ts/src/browser/form-filler.ts` | CREATE | ~150 |
| `EDITH-ts/src/browser/research-agent.ts` | CREATE | ~200 |
| `EDITH-ts/src/browser/data-extractor.ts` | CREATE | ~120 |
| `EDITH-ts/src/browser/session-manager.ts` | CREATE | ~120 |
| `EDITH-ts/src/browser/credential-bridge.ts` | CREATE | ~80 |
| `EDITH-ts/src/browser/recipe-engine.ts` | CREATE | ~120 |
| `EDITH-ts/src/browser/recipes/tiket-kereta.ts` | CREATE | ~80 |
| `EDITH-ts/src/skills/browser-skill.ts` | CREATE | ~100 |
| `EDITH-ts/src/browser/__tests__/browser-core.test.ts` | CREATE | ~120 |
| `EDITH-ts/src/browser/__tests__/form-filler.test.ts` | CREATE | ~100 |
| **Total** | | **~1840** |

**New dependencies:** `playwright` (browser automation)
