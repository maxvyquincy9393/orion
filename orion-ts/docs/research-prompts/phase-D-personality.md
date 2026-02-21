# Phase D — Personality Layer: Human-like AI Companion

## Papers
**[1] Systematizing LLM Persona Design: A Four-Quadrant Technical Taxonomy**
arXiv: 2511.02979 | Nov 2025 (v2: Jan 2026) | NeurIPS 2025 LLM Persona Workshop

**[2] AI Personality Shapes Human Self-concept**
arXiv: 2601.12727 | Jan 2026

## Core Idea dari Paper
Orion masuk ke Quadrant II (Functional Virtual Assistant):
- Bukan pure emotional companion
- Tapi bukan corporate bot juga
- Focus: "thinking and acting" dengan personality yang consistent

Four-Layer Technical Framework (paper 2511.02979):
1. Model Layer: Core LLM + personality traits injected via system prompt
2. Architecture Layer: Long-term memory + state management (sudah ada di Orion)
3. Generation Layer: Response style consistency (MISSING di Orion)
4. Safety Layer: Ethical guardrails (sudah ada di Orion)

OCEAN Model untuk Orion:
- Openness: HIGH (suka explore ide baru, proaktif suggest things)
- Conscientiousness: HIGH (perhatian ke detail, organized)
- Extraversion: MEDIUM (tidak overwhelming, tapi tidak dingin)
- Agreeableness: HIGH (supportive, tidak judgmental)
- Neuroticism: LOW (stable, tidak anxious)

Context-adaptive modulation (dari paper):
- User calm + casual → Orion lebih santai, boleh humor
- User stressed + urgent → Orion lebih focused, kurangi small talk
- User confused → Orion lebih detail, step-by-step
- User expert → Orion lebih technical, skip basics

## Gap di Orion Sekarang
Tidak ada personality layer sama sekali.
System prompt tidak ada (lihat main.ts — langsung forward ke orchestrator).
Responses flat, tidak ada character atau warmth.

## Prompt untuk AI Coding Assistant

```
Kamu sedang memodifikasi Orion-TS. Implementasi personality system.
Paper referensi: arXiv 2511.02979

### TASK: Phase D — Personality Layer

Target files:
- `src/core/persona.ts` (file baru)
- `src/engines/orchestrator.ts` (modifikasi — tambah system prompt)
- `src/main.ts` (modifikasi — inject persona ke context)

#### Step 1: Buat src/core/persona.ts

```typescript
import { createLogger } from "../logger.js"
import type { UserProfile } from "../memory/profiler.js"

const log = createLogger("core.persona")

// OCEAN scores untuk Orion — bisa dikustom via config
const ORION_OCEAN = {
  openness: 0.85,
  conscientiousness: 0.90,
  extraversion: 0.55,
  agreeableness: 0.85,
  neuroticism: 0.15,
}

export type UserMood = "calm" | "stressed" | "confused" | "excited" | "neutral"
export type UserExpertise = "beginner" | "intermediate" | "expert"

export interface ConversationContext {
  userMood: UserMood
  userExpertise: UserExpertise
  topicCategory: string   // work, personal, technical, creative, casual
  urgency: boolean
}

export class PersonaEngine {
  // Base persona prompt — ini selalu ada
  private readonly basePersona = `You are Orion, a highly capable AI companion.
Your character:
- Direct and precise — no unnecessary filler phrases like "Certainly!" or "Of course!"
- Curious and engaged — you find the user's interests genuinely interesting
- Proactive — you notice patterns and sometimes bring relevant things up
- Reliable — you're consistent, you remember things, you follow through
- Warm but not sycophantic — supportive without being over the top

Communication style:
- Use the same language the user is writing in (Indonesian → Indonesian, English → English)
- Match the user's level of formality
- When technical, be precise. When casual, be natural.
- Occasionally use first person "gue/lo" if user writes in informal Indonesian
- Short responses for simple things. Detailed when complexity requires it.`

  private readonly moodAdaptations: Record<UserMood, string> = {
    stressed: "The user seems stressed. Be calm and direct. Skip small talk. Focus on what helps immediately.",
    confused: "The user seems confused. Break things down step by step. Use examples. Check understanding.",
    excited: "The user is excited about something. Match their energy (but not excessively). Engage genuinely.",
    calm: "Normal conversation mode. Natural and balanced.",
    neutral: "",
  }

  private readonly expertiseAdaptations: Record<UserExpertise, string> = {
    beginner: "Avoid jargon. Explain technical terms. Use analogies.",
    intermediate: "Assume basic knowledge. No need to over-explain fundamentals.",
    expert: "Skip basics. Use proper technical terminology. Peer-level discussion.",
  }

  // Deteksi mood dari pesan terbaru user
  detectMood(message: string, recentTopics: string[]): UserMood {
    const lower = message.toLowerCase()
    const urgencyWords = ["urgent", "asap", "please help", "stuck", "problem", "tolong", "bingung", "susah"]
    const excitedWords = ["wow", "keren", "amazing", "yes!", "finally", "berhasil", "works"]

    if (urgencyWords.some(w => lower.includes(w))) return "stressed"
    if (excitedWords.some(w => lower.includes(w))) return "excited"
    if (lower.includes("?") && lower.split("?").length > 2) return "confused"
    if (recentTopics.includes("stress") || recentTopics.includes("problem")) return "stressed"
    return "neutral"
  }

  // Deteksi expertise dari profile + pesan
  detectExpertise(profile: UserProfile | null, message: string): UserExpertise {
    if (!profile) return "intermediate"

    const expertKeys = ["developer", "engineer", "programmer", "researcher", "expert"]
    const hasExpertFact = profile.facts.some(f =>
      expertKeys.some(k => f.value.toLowerCase().includes(k))
    )

    if (hasExpertFact) return "expert"

    // Cek dari message: panjang message teknis biasanya expert
    const technicalTerms = ["api", "database", "algorithm", "function", "class", "typescript", "python"]
    const techCount = technicalTerms.filter(t => message.toLowerCase().includes(t)).length
    if (techCount >= 2) return "expert"
    if (techCount >= 1) return "intermediate"

    return "intermediate"
  }

  // Buat system prompt yang di-inject ke setiap LLM call
  buildSystemPrompt(
    context: ConversationContext,
    profileSummary: string
  ): string {
    const parts: string[] = [this.basePersona]

    const moodAdaptation = this.moodAdaptations[context.userMood]
    if (moodAdaptation) {
      parts.push(`\nCurrent context note: ${moodAdaptation}`)
    }

    const expertiseAdaptation = this.expertiseAdaptations[context.userExpertise]
    if (expertiseAdaptation) {
      parts.push(`\nExpertise level note: ${expertiseAdaptation}`)
    }

    if (profileSummary) {
      parts.push(`\nWhat you know about this user:\n${profileSummary}`)
    }

    if (context.urgency) {
      parts.push("\nUser needs a quick response. Be concise.")
    }

    return parts.join("\n")
  }

  // Detect topic category dari pesan
  detectTopicCategory(message: string): string {
    const lower = message.toLowerCase()
    if (/code|debug|error|function|api|database/.test(lower)) return "technical"
    if (/kerja|work|boss|meeting|project|deadline/.test(lower)) return "work"
    if (/sakit|sehat|makan|tidur|olahraga/.test(lower)) return "personal"
    if (/gambar|musik|story|novel|design/.test(lower)) return "creative"
    return "casual"
  }
}

export const personaEngine = new PersonaEngine()
```

#### Step 2: Modifikasi engines/orchestrator.ts
Tambahkan parameter `systemPrompt` optional ke GenerateOptions:
```typescript
// Di types.ts atau langsung di orchestrator.ts:
export interface GenerateOptions {
  prompt: string
  context?: Array<{ role: "user" | "assistant"; content: string }>
  systemPrompt?: string   // TAMBAHAN BARU
}
```

Di setiap engine (anthropic.ts, gemini.ts, groq.ts, ollama.ts, openai.ts):
- Kalau `options.systemPrompt` ada, inject sebagai system message sebelum messages lain
- Format per engine berbeda:
  - Anthropic: `system` field di top-level request
  - OpenAI/Groq: message dengan `role: "system"` di awal
  - Gemini: system instruction field
  - Ollama: `system` field

#### Step 3: Modifikasi main.ts
Import dan gunakan PersonaEngine di loop utama:

```typescript
import { personaEngine } from "./core/persona.js"

// Di dalam loop, sebelum orchestrator.generate():
const profile = await profiler.getProfile(userId)
const mood = personaEngine.detectMood(text, profile?.currentTopics ?? [])
const expertise = personaEngine.detectExpertise(profile, text)
const topicCategory = personaEngine.detectTopicCategory(text)

const conversationCtx = {
  userMood: mood,
  userExpertise: expertise,
  topicCategory,
  urgency: mood === "stressed",
}

const profileSummary = await profiler.formatForContext(userId)
const systemPrompt = personaEngine.buildSystemPrompt(conversationCtx, profileSummary)

// Pass ke orchestrator:
const response = await orchestrator.generate("reasoning", {
  prompt: text,
  context: messages,
  systemPrompt,   // BARU
})
```

### Constraints
- System prompt harus bisa di-disable via env PERSONA_ENABLED=false untuk testing
- Persona tidak boleh mengubah bahasa kalau user pakai bahasa tertentu
- Jangan hardcode nama user di base persona (ambil dari profile kalau ada)
- Zero TypeScript errors
- Personality harus consistent across channels (webchat, telegram, dll)
```

## Cara Test
```bash
pnpm dev --mode text
# Test 1: Kirim pesan stres "tolong gue stuck banget sama bug ini"
# → Orion harusnya lebih fokus, tidak basa basi
# Test 2: Kirim "wow keren banget ini works!"
# → Orion harusnya ikut excited tapi tidak lebay
# Test 3: Kirim pertanyaan teknis dengan jargon
# → Orion harusnya reply dengan level teknis yang sama
```

## Expected Outcome
Orion punya karakter yang terasa consistent.
Response tidak lagi terasa seperti generic chatbot.
Tone menyesuaikan situasi user secara otomatis.
User yang expert tidak perlu baca penjelasan dasar.
User yang stres mendapat respon yang lebih focused dan efisien.
