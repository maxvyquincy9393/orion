# Phase C — Reasoning Upgrade: Recursive Self-Critique

## Papers
**[1] Scalable Oversight for Superhuman AI via Recursive Self-Critiquing**
arXiv: 2502.04675 | Feb 2025 (v4: Jan 2026) | Verified

**[2] Enabling Scalable Oversight via Self-Evolving Critic (SCRIT)**
arXiv: 2501.05727 | Jan 2025 | Qwen2.5-72B based

## Core Idea dari Paper
Insight utama: verifikasi lebih mudah dari generasi.
Kalau output LLM terlalu kompleks untuk dievaluasi langsung,
lakukan "critique of critique" — evaluasi critiknya, bukan outputnya langsung.

Pipeline Recursive Self-Critique:
1. Generator (engine "reasoning") → buat response
2. Critic (engine "fast"/Groq) → critique response tersebut
3. Meta-Critic (engine "fast") → critique critiknya
4. Synthesizer → gabungkan semua menjadi final response

Untuk Orion, versi yang lebih pragmatis (2 level cukup):
1. Generator → draft response
2. Critic → evaluasi 3 aspek: accuracy, helpfulness, completeness
3. Refiner → perbaiki draft berdasarkan critique

Ini berbeda dari simple retry karena:
- Critic dan Generator adalah LLM yang sama tapi dengan prompt berbeda
- Critique diarahkan ke aspek spesifik bukan hanya "improve this"
- Loop hanya jalan kalau critique score di bawah threshold

## Gap di Orion Sekarang
`agents/runner.ts` → `runSingle()` langsung return tanpa verifikasi.
`main.ts` → response langsung dipakai tanpa critique pass.
Tidak ada feedback loop untuk improve quality.

## Prompt untuk AI Coding Assistant

```
Kamu sedang memodifikasi Orion-TS. Implementasi Recursive Self-Critique pattern.
Paper referensi: arXiv 2502.04675

### TASK: Phase C — Recursive Self-Critique

Target files:
- `src/core/critic.ts` (file baru)
- `src/agents/runner.ts` (modifikasi)
- `src/main.ts` (modifikasi kecil)

#### Step 1: Buat src/core/critic.ts

```typescript
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"

const log = createLogger("core.critic")

export interface CritiqueResult {
  score: number          // 0.0 - 1.0
  issues: string[]       // list masalah yang ditemukan
  suggestions: string[]  // list saran perbaikan
  passThreshold: boolean // true jika score >= threshold
}

export interface CritiquedResponse {
  original: string
  critique: CritiqueResult
  refined: string | null   // null jika score sudah di atas threshold
  finalResponse: string
  iterations: number
}

const CRITIQUE_THRESHOLD = 0.75
const MAX_ITERATIONS = 2   // maksimal 2 round critique untuk hemat API calls

const CRITIC_PROMPT = `Evaluate this AI response on 3 dimensions. Return ONLY valid JSON.

Dimensions:
1. accuracy (0-1): Is the information correct and not hallucinated?
2. helpfulness (0-1): Does it directly address what was asked?
3. completeness (0-1): Are important aspects missing?

Response to evaluate:
"""
{response}
"""

Original query:
"""
{query}
"""

Return format:
{
  "accuracy": 0.8,
  "helpfulness": 0.9,
  "completeness": 0.7,
  "issues": ["issue 1", "issue 2"],
  "suggestions": ["suggestion 1"]
}
Return only JSON, no explanation.`

const REFINE_PROMPT = `Improve this response based on the critique provided.
Keep the same language (Indonesian/English) as the original.
Do NOT add unnecessary disclaimers. Just improve the content directly.

Original response:
"""
{response}
"""

Critique:
{critique}

Improved response:`

export class ResponseCritic {
  private readonly enabled: boolean

  constructor() {
    // Hanya aktif kalau ada engine "fast" tersedia
    // Disable jika hanya ada satu engine untuk hemat calls
    this.enabled = true
  }

  async critique(query: string, response: string): Promise<CritiqueResult> {
    try {
      const prompt = CRITIC_PROMPT
        .replace("{response}", response.slice(0, 2000))
        .replace("{query}", query.slice(0, 500))

      const raw = await orchestrator.generate("fast", { prompt })
      const cleaned = raw.replace(/```json|```/g, "").trim()
      const parsed = JSON.parse(cleaned)

      const accuracy = Math.min(1, Math.max(0, Number(parsed.accuracy ?? 0.5)))
      const helpfulness = Math.min(1, Math.max(0, Number(parsed.helpfulness ?? 0.5)))
      const completeness = Math.min(1, Math.max(0, Number(parsed.completeness ?? 0.5)))
      const score = (accuracy * 0.4 + helpfulness * 0.4 + completeness * 0.2)

      return {
        score,
        issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 5) : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : [],
        passThreshold: score >= CRITIQUE_THRESHOLD,
      }
    } catch (error) {
      log.warn("critique parse failed, using default pass", error)
      return {
        score: 1.0,
        issues: [],
        suggestions: [],
        passThreshold: true,
      }
    }
  }

  async critiqueAndRefine(
    query: string,
    response: string,
    maxIterations = MAX_ITERATIONS
  ): Promise<CritiquedResponse> {
    if (!this.enabled) {
      return {
        original: response,
        critique: { score: 1, issues: [], suggestions: [], passThreshold: true },
        refined: null,
        finalResponse: response,
        iterations: 0,
      }
    }

    let current = response
    let lastCritique: CritiqueResult | null = null
    let iterations = 0

    for (let i = 0; i < maxIterations; i++) {
      const critique = await this.critique(query, current)
      lastCritique = critique
      iterations++

      log.debug("critique result", {
        score: critique.score,
        pass: critique.passThreshold,
        issues: critique.issues.length,
        iteration: i + 1,
      })

      if (critique.passThreshold) {
        break
      }

      // Hanya refine kalau ada issues spesifik
      if (critique.issues.length === 0 && critique.suggestions.length === 0) {
        break
      }

      const refinePrompt = REFINE_PROMPT
        .replace("{response}", current.slice(0, 2000))
        .replace("{critique}", JSON.stringify({
          issues: critique.issues,
          suggestions: critique.suggestions,
        }))

      try {
        const refined = await orchestrator.generate("fast", { prompt: refinePrompt })
        current = refined.trim()
      } catch (error) {
        log.warn("refine step failed", error)
        break
      }
    }

    const refined = current !== response ? current : null

    return {
      original: response,
      critique: lastCritique ?? { score: 1, issues: [], suggestions: [], passThreshold: true },
      refined,
      finalResponse: current,
      iterations,
    }
  }
}

export const responseCritic = new ResponseCritic()
```

#### Step 2: Modifikasi agents/runner.ts
Di method `runSingle()`, setelah mendapat `output`:
```typescript
// Tambahkan after existing output generation:
import { responseCritic } from "../core/critic.js"

// Dalam runSingle(), setelah output didapat:
const critiqued = await responseCritic.critiqueAndRefine(task.task, output, 1)
// Gunakan 1 iteration di runner (hemat calls), 2 iteration hanya di main conversation
output = critiqued.finalResponse

if (critiqued.refined) {
  logger.debug("response refined", {
    taskId: task.id,
    score: critiqued.critique.score,
    iterations: critiqued.iterations,
  })
}
```

#### Step 3: Modifikasi main.ts (optional, hanya untuk mode text)
Di main.ts loop, setelah mendapat `response`:
```typescript
// Import di atas:
import { responseCritic } from "./core/critic.js"

// Setelah mendapat response:
const critiqued = await responseCritic.critiqueAndRefine(text, response, 2)
const finalResponse = critiqued.finalResponse
// Gunakan finalResponse untuk output dan simpan ke memory
```

Tambahkan env variable untuk enable/disable critique:
```typescript
// Di config.ts, tambahkan:
CRITIQUE_ENABLED: boolFromEnv.default(true),
CRITIQUE_THRESHOLD: z.preprocess(v => parseFloat(String(v)), z.number()).default(0.75),
```

### Constraints
- Critique step harus async dan tidak menambah lebih dari 2-3 detik latency
- Kalau Groq API gagal, skip critique dan return original
- Log critique score untuk monitoring
- Zero TypeScript errors
- Jangan critique responses yang sangat pendek (< 50 chars) → langsung pass
```

## Cara Test
```bash
pnpm dev --mode text
# Tanya pertanyaan yang butuh reasoning
# Check log untuk melihat critique scores
# Grep logs: grep "critique result" logs/orion*.log
```

## Expected Outcome
Responses yang lemah atau incomplete akan di-refine sebelum sampai ke user.
Logs akan menunjukkan critique score per response.
Latency sedikit naik tapi kualitas output meningkat terutama untuk complex queries.
Untuk simple queries (score awal sudah tinggi), critique pass langsung — minimal overhead.
