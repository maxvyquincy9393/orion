# ADR-001: LanceDB for Vector Memory Store

## Status
Accepted

## Context
EDITH needs a vector store for semantic memory retrieval — the core subsystem that allows the assistant to recall relevant past interactions. Requirements: embedded (no external service), offline-capable, fast cold starts, and compatible with Node.js.

Options evaluated: Chroma, Pinecone, pgvector, Milvus, Weaviate, LanceDB.

## Decision
Use **LanceDB** — an embedded, serverless vector database written in Rust with a zero-copy Apache Arrow-native storage format.

## Consequences
**Positive:**
- Zero infrastructure overhead — embedded directly in the Node.js process
- Works fully offline (critical for Phase 9 offline mode)
- Arrow-native storage enables efficient bulk operations and column projection
- Rust core provides native performance without a separate server process
- Sub-millisecond cold start (no connection pooling needed)

**Negative:**
- No built-in replication or multi-instance consistency (mitigated by CRDT sync in Phase 27)
- Schema migrations require manual table recreation — no `ALTER TABLE` equivalent
- LanceDB filter language is SQL-like but not standardized; injection risk if values are string-concatenated (mitigated by `lance-filter.ts` safe builder)
- Community and ecosystem smaller than Chroma or Pinecone

## Alternatives Considered
- **Chroma:** Python-native, would require a sidecar process; rejected for operational complexity
- **Pinecone:** Cloud-only SaaS; violates the self-hosted-first requirement
- **pgvector:** Requires PostgreSQL; rejected because EDITH uses SQLite as primary data store
- **Milvus:** Heavy infrastructure (etcd, MinIO); overkill for a personal assistant
