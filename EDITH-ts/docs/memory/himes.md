# HiMeS Coordinator

File: `src/memory/himes.ts`

## Goal
Fuse short-term and long-term context into model-ready conversation context.

## Short-Term Inputs
- Recent session messages (preferred) or DB history fallback.
- Prefetched memory snippets from temporal index.

## Long-Term Inputs
- Profile facts and opinions.
- Temporal retrieval by complexity.
- Causal graph hybrid retrieval and pattern context.

## Fusion Order
1. Profile context blocks.
2. Personal facts.
3. Opinions.
4. Relevant memory blocks.
5. Prefetched context.
6. Recent user/assistant turns.

## Output
Array of chat messages usable by orchestrator model calls.

## Design Constraints
- Keep context bounded and prioritized.
- Preserve newest conversational turns.
- Avoid duplicate repeated memory snippets.
