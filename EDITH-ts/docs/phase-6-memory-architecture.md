# Phase 6 Memory Architecture

## Goal
Move from flat memory retrieval to layered personal memory with temporal validity, profiling, causal relations, and context fusion.

## Modules
- `temporal-index.ts`
- `session-summarizer.ts`
- `profiler.ts`
- `promem.ts`
- `causal-graph.ts`
- `himes.ts`
- `core/context-predictor.ts`
- `core/voi.ts`

## Pipeline
1. User message saved.
2. Session summarizer may compress active context.
3. Profiler extracts facts and opinions.
4. Causal graph updates event edges and hyper-edges.
5. Temporal index stores level-0 node.
6. Consolidation and expiry run in background.
7. HiMeS fuses short-term and long-term context for generation.

## Retrieval Strategy
- Simple query: prioritize level 1-2 temporal nodes.
- Complex query: include level 0 raw nodes and graph-derived context.
- Causal hybrid retrieval merges semantic and graph distance ranking.

## Persistence Mapping
- Prisma for structured memory graphs/profile/history.
- LanceDB for vector semantic memory and document chunks.

## Operational Cadence
- Fast path: synchronous store and message context.
- Slow path: asynchronous extraction and periodic maintenance.

## Risks and Controls
- Over-compression: keep recency window uncompressed.
- Hallucinated profile facts: confidence threshold and evidence merge.
- Stale memory: validity window + maintenance expiry.
