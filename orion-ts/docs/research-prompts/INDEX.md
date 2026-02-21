# Orion-TS — Research Prompt Index
# Semua paper sudah diverifikasi di arXiv

## Quick Reference Per Phase

| Phase | Target Kategori | Paper | arXiv ID | Status |
|---|---|---|---|---|
| A | Free Stack (prereq) | - | - | Verified: Groq/Gemini free tier confirmed |
| B | Memory → Self-evolving | MemRL | 2601.03192 | Verified Jan 2026 |
| C | Reasoning → Superhuman | Scalable Oversight via Recursive Self-Critique | 2502.04675 | Verified Feb 2025 (v4 Jan 2026) |
| C | Reasoning (supp) | SCRIT: Self-Evolving Critic | 2501.05727 | Verified Jan 2025 |
| D | Personality → Human-like | Four-Quadrant Taxonomy NeurIPS 2025 | 2511.02979 | Verified Nov 2025 |
| D | Personality (supp) | AI Personality Shapes Human Self-concept | 2601.12727 | Verified Jan 2026 |
| E | Security → Military-grade | AURA: Affordance-Understanding & Risk-aware | 2508.06124 | Verified Aug 2025 |
| F | Data Processing → Real-time | Async Tool Usage for Real-Time Agents | 2410.21620 | Verified Oct 2024 |
| F | Data Processing (supp) | X-Talk Event Bus Architecture | 2512.18706 | Verified Dec 2025 |
| G | Combat Assist → Autonomous | ALAS: Adaptive LLM Agent Scheduler | 2505.12501 | Verified May 2025 |
| G | Combat Assist (supp) | MCP + A2A Multi-Agent Orchestration | 2601.13671 | Verified Jan 2026 |
| G | System Control (supp) | Agentic AI in Cybersecurity (5-gen taxonomy) | 2512.06659 | Verified Dec 2025 |

## Background Survey Papers (Untuk Pemahaman Lebih Dalam)

| Paper | arXiv ID | Relevansi |
|---|---|---|
| Memory in the Age of AI Agents (survey) | 2512.13564 | Overview semua memory approaches |
| Survey of Self-Evolving Agents | 2507.21046 | Landscape self-evolving agent 2022-2025 |
| LLM Generated Persona is a Promise with a Catch | 2503.16527 | Caveats dalam persona generation |

## Dependency Graph (Urutan Implementasi)

```
Phase A (Free Stack)
    ↓
Phase B (MemRL)
    ↓
Phase C (Reasoning) ←── Bisa parallel dengan B kalau ada bandwidth
    ↓
Phase D (Personality) ←── Butuh Phase A selesai minimal
    ↓
Phase E (Security) ←── Bisa kapan saja, independent
    ↓
Phase F (Event Bus) ←── Butuh Phase A dan B selesai
    ↓
Phase G (Multi-Agent) ←── Butuh Phase F selesai
```

## Cara Pakai Prompt

1. Buka file phase yang mau dikerjakan
2. Scroll ke bagian `## Prompt untuk AI Coding Assistant`
3. Copy konten di dalam block ``` 
4. Paste ke GitHub Copilot Chat / Claude / OpenCode
5. Attach file yang disebutkan di `Target files:`
6. Iterasi sampai zero TypeScript errors

## Notes untuk Session Context
- Repo: C:\Users\test\OneDrive\Desktop\orion\orion-ts
- Branch: typescript
- Node: 22+, ESM modules
- Package manager: pnpm
- Database: Prisma + SQLite + LanceDB
- Style: no emotes, plain text, ESM imports dengan .js extension
