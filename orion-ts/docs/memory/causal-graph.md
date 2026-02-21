# Causal Graph and Hyper-Edges

File: `src/memory/causal-graph.ts`

## Models
- `CausalNode`: event with category.
- `CausalEdge`: directed causal relation with strength and evidence count.
- `HyperEdge`: multi-node relation with context and weight.
- `HyperEdgeMembership`: node membership table.

## Extraction
- Parse events and causes from incoming user messages.
- Upsert nodes and update/create edges.
- Add hyper-edge relations for multi-event context.

## APIs
- `extractAndUpdate()`
- `getDownstreamEffects()`
- `addHyperEdge()`
- `queryHyperEdges()`
- `hybridRetrieve()`
- `generateInsight()`
- `formatForContext()`

## Hybrid Retrieval
1. Semantic candidate retrieval from temporal index.
2. Graph traversal up to two hops from seed nodes.
3. Merge node/edge/hyper-edge candidates.
4. Rank with blended score (semantic and graph distance/weight).

## Context Usage
- `formatForContext()` injects concise behavior patterns.
- Used by HiMeS and overall context build path.
