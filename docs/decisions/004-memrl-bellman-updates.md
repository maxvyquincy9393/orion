# ADR-004: MemRL Bellman Q-Learning for Memory Utility

## Status
Accepted

## Context
As EDITH accumulates thousands of memories, retrieval quality degrades — irrelevant memories surface alongside useful ones. A static relevance score (cosine similarity) is insufficient because it doesn't account for whether a memory actually helped produce a good response.

We needed a mechanism for memories to "learn" their own value over time based on real usage outcomes.

## Decision
Implement **MemRL** (arXiv 2601.03192) — a Memory Reinforcement Learning system using Intent-Experience-Utility (IEU) triplets with Bellman Q-value updates.

**Core algorithm:**
```
Q(s,a) = Q(s,a) + α * [r + γ * max(Q(s',a')) - Q(s,a)]
```

Where:
- `s` = current context, `a` = retrieving this memory
- `r` = reward from task feedback (explicit + implicit signals)
- `γ` = discount factor for future rewards
- `α` = learning rate

**Retrieval is two-phase:**
1. Phase A: Semantic similarity filter (vector search)
2. Phase B: Q-value reranking (blended score: 50% similarity + 30% Q-value + 20% utility)

## Consequences
**Positive:**
- Memories that reliably lead to good outcomes get retrieved more often
- Self-improving: quality increases with usage, no manual curation needed
- Temporal credit assignment via Bellman updates handles delayed rewards
- IEU triplets capture intent, making retrieval context-aware

**Negative:**
- Cold-start problem: new memories start at Q=0.5, need several interactions to calibrate
- Requires feedback signal after every response (`updateFromFeedback()` in pipeline Stage 11)
- Q-values can oscillate if feedback is noisy (mitigated by low learning rate α=0.1)
- Computational overhead: each retrieval does a Prisma query for Q-values after vector search

## Alternatives Considered
- **Static cosine similarity:** Simpler but doesn't learn from outcomes
- **BM25 + reranking:** Good for keyword search but doesn't capture utility
- **LLM-based reranking:** Expensive (extra LLM call per retrieval) and adds latency
