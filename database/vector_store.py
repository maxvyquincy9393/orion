"""
vector_store.py

Vector database client and operations for Orion.
Provides a unified interface with two backends:
  1. Supabase pgvector (primary)  — free-tier hosted PostgreSQL + pgvector
  2. Chroma (fallback)            — local, zero-config, no server needed

Backend is auto-detected from config:
  • If SUPABASE_URL + SUPABASE_KEY are set → use Supabase pgvector
  • Otherwise                              → use Chroma local (persist to ./chroma_data)

Public API
----------
    embed(text)            → list[float]      # Generate an embedding vector
    upsert(doc_id, text, metadata)            # Insert or update a document
    search(query, top_k, filters)             # Semantic similarity search
    delete(doc_ids)                           # Remove documents by ID
    get_store_stats()                         # Backend info + document count

DECISION: Use LangChain's embedding wrapper so the embedding model can be
swapped via config without touching vector_store code.
WHY: Keeps vector store backend-agnostic; same embed() call works with
OpenAI, HuggingFace, or Ollama embeddings.
ALTERNATIVES CONSIDERED: Direct SentenceTransformers — rejected because it
cannot hot-swap models via config.
REVISIT: If LangChain embedding overhead becomes measurable.

Part of Orion — Persistent AI Companion System.
"""

from __future__ import annotations

import logging
import os
import uuid
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Optional

import config

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

_log = logging.getLogger("orion.vector_store")
_handler = logging.FileHandler(config.LOGS_DIR / "vector_store.log")
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))


# ===========================================================================
# Embedding helper
# ===========================================================================

_embedder = None


def _get_embedder():
    """
    Lazily create the embedding model.

    Tries (in order):
      1. OpenAI embeddings if OPENAI_ACCESS_TOKEN is set
      2. Ollama local embeddings (always free, no key needed)

    Returns:
        A LangChain Embeddings instance.

    Raises:
        RuntimeError: If no embedding backend can be initialised.
    """
    global _embedder
    if _embedder is not None:
        return _embedder

    # --- Attempt 1: OpenAI embeddings (text-embedding-3-small, cheapest) ---
    if config.OPENAI_ACCESS_TOKEN:
        try:
            from langchain_openai import OpenAIEmbeddings

            _embedder = OpenAIEmbeddings(
                model="text-embedding-3-small",
                openai_api_key=config.OPENAI_ACCESS_TOKEN,
            )
            _log.info("Embedding backend: OpenAI text-embedding-3-small")
            return _embedder
        except Exception as exc:  # noqa: BLE001
            _log.warning("OpenAI embeddings unavailable: %s", exc)

    # --- Attempt 2: Ollama local embeddings (free, no key) ---
    try:
        from langchain_ollama import OllamaEmbeddings

        _embedder = OllamaEmbeddings(
            model="nomic-embed-text",
            base_url=config.OLLAMA_BASE_URL,
        )
        _log.info("Embedding backend: Ollama nomic-embed-text @ %s", config.OLLAMA_BASE_URL)
        return _embedder
    except Exception as exc:  # noqa: BLE001
        _log.warning("Ollama embeddings unavailable: %s", exc)

    raise RuntimeError(
        "No embedding backend available. "
        "Set OPENAI_ACCESS_TOKEN or ensure Ollama is running."
    )


def embed(text: str) -> list[float]:
    """
    Generate an embedding vector for the given text.

    Args:
        text: The input text to embed.

    Returns:
        A list of floats representing the embedding vector.

    Example:
        vec = embed("Hello, Orion!")
        len(vec)  # e.g. 1536 for OpenAI, 768 for nomic
    """
    embedder = _get_embedder()
    return embedder.embed_query(text)


# ===========================================================================
# Abstract backend
# ===========================================================================

class _VectorBackend(ABC):
    """Interface that every concrete vector store backend must implement."""

    @abstractmethod
    def upsert(self, doc_id: str, vector: list[float], metadata: dict) -> None: ...

    @abstractmethod
    def search(
        self,
        vector: list[float],
        top_k: int = 5,
        filters: Optional[dict] = None,
    ) -> list[dict]: ...

    @abstractmethod
    def delete(self, doc_ids: list[str]) -> None: ...

    @abstractmethod
    def stats(self) -> dict: ...


# ===========================================================================
# Backend 1 — Supabase pgvector
# ===========================================================================

class _SupabaseBackend(_VectorBackend):
    """
    Uses the Supabase REST API (PostgREST) with pgvector for similarity search.

    Requires:
        • SUPABASE_URL and SUPABASE_KEY in .env
        • A table `documents` with columns:
            id        TEXT PRIMARY KEY,
            embedding VECTOR(dimension),
            metadata  JSONB
        • A Postgres function `match_documents(query_embedding, match_count, filter)`
          created via Supabase SQL editor.

    DECISION: Raw REST calls via ``requests`` instead of supabase-py SDK.
    WHY: supabase-py pulls in heavy deps; we only need two endpoints.
    REVISIT: If Supabase adds features we need that are painful via REST.
    """

    def __init__(self) -> None:
        import requests as _requests

        self._requests = _requests
        self._url = config.SUPABASE_URL.rstrip("/")
        self._key = config.SUPABASE_KEY
        self._headers = {
            "apikey": self._key,
            "Authorization": f"Bearer {self._key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        }
        _log.info("Supabase pgvector backend initialised (%s)", self._url)

    # ---- helpers ----------------------------------------------------------

    def _rest(self, method: str, path: str, json: Any = None) -> Any:
        """Execute a REST call against the Supabase PostgREST API."""
        url = f"{self._url}/rest/v1/{path}"
        resp = self._requests.request(
            method, url, headers=self._headers, json=json, timeout=15
        )
        resp.raise_for_status()
        if resp.content:
            return resp.json()
        return None

    def _rpc(self, fn: str, params: dict) -> Any:
        """Call a Postgres function via the Supabase RPC endpoint."""
        url = f"{self._url}/rest/v1/rpc/{fn}"
        resp = self._requests.post(
            url, headers=self._headers, json=params, timeout=15
        )
        resp.raise_for_status()
        return resp.json()

    # ---- interface --------------------------------------------------------

    def upsert(self, doc_id: str, vector: list[float], metadata: dict) -> None:
        """
        Insert or update a document in the Supabase ``documents`` table.

        Args:
            doc_id: Unique document identifier.
            vector: The embedding vector.
            metadata: JSON metadata (user_id, text, timestamp, …).
        """
        payload = {
            "id": doc_id,
            "embedding": vector,
            "metadata": metadata,
        }
        self._rest("POST", "documents", json=payload)
        _log.debug("Supabase upsert doc_id=%s", doc_id)

    def search(
        self,
        vector: list[float],
        top_k: int = 5,
        filters: Optional[dict] = None,
    ) -> list[dict]:
        """
        Similarity search via the ``match_documents`` Postgres RPC function.

        Args:
            vector: Query embedding.
            top_k: Max results.
            filters: Optional metadata filter dict passed to the RPC function.

        Returns:
            List of dicts with keys: id, score, metadata.
        """
        params: dict[str, Any] = {
            "query_embedding": vector,
            "match_count": top_k,
        }
        if filters:
            params["filter"] = filters

        rows = self._rpc("match_documents", params)
        results = [
            {
                "id": row["id"],
                "score": row.get("similarity", 0.0),
                "metadata": row.get("metadata", {}),
            }
            for row in rows
        ]
        _log.debug("Supabase search returned %d results", len(results))
        return results

    def delete(self, doc_ids: list[str]) -> None:
        """
        Delete documents by ID from the ``documents`` table.

        Args:
            doc_ids: List of document IDs to remove.
        """
        for doc_id in doc_ids:
            self._rest("DELETE", f"documents?id=eq.{doc_id}")
        _log.debug("Supabase deleted %d docs", len(doc_ids))

    def stats(self) -> dict:
        """Return backend name and an approximate row count."""
        rows = self._rest("GET", "documents?select=id") or []
        return {
            "backend": "supabase_pgvector",
            "url": self._url,
            "total_vectors": len(rows),
        }


# ===========================================================================
# Backend 2 — Chroma (local fallback)
# ===========================================================================

class _ChromaBackend(_VectorBackend):
    """
    Local vector store using ChromaDB.
    Zero config — persists to ``<project_root>/chroma_data/``.

    DECISION: PersistentClient (Chroma ≥ 0.4) with a single collection "orion_memory".
    WHY: Simplest local option; no server, no key, free forever.
    REVISIT: If dataset exceeds ~1 M vectors and local performance degrades.
    """

    def __init__(self) -> None:
        import chromadb

        persist_dir = str(config.PROJECT_ROOT / "chroma_data")
        self._client = chromadb.PersistentClient(path=persist_dir)
        self._collection = self._client.get_or_create_collection(
            name="orion_memory",
            metadata={"hnsw:space": "cosine"},
        )
        _log.info("Chroma local backend initialised (persist=%s)", persist_dir)

    # ---- interface --------------------------------------------------------

    def upsert(self, doc_id: str, vector: list[float], metadata: dict) -> None:
        """
        Insert or update a document in the Chroma collection.

        Args:
            doc_id: Unique document identifier.
            vector: The embedding vector.
            metadata: JSON-serialisable metadata dict.
        """
        # Chroma requires metadata values to be str, int, float, or bool.
        safe_meta = _sanitize_metadata(metadata)
        self._collection.upsert(
            ids=[doc_id],
            embeddings=[vector],
            metadatas=[safe_meta],
            documents=[metadata.get("text", "")],
        )
        _log.debug("Chroma upsert doc_id=%s", doc_id)

    def search(
        self,
        vector: list[float],
        top_k: int = 5,
        filters: Optional[dict] = None,
    ) -> list[dict]:
        """
        Similarity search in the Chroma collection.

        Args:
            vector: Query embedding.
            top_k: Max results.
            filters: Optional Chroma ``where`` filter dict.

        Returns:
            List of dicts with keys: id, score, metadata.
        """
        query_kwargs: dict[str, Any] = {
            "query_embeddings": [vector],
            "n_results": top_k,
        }
        if filters:
            query_kwargs["where"] = filters

        result = self._collection.query(**query_kwargs)

        items: list[dict] = []
        ids = result.get("ids", [[]])[0]
        distances = result.get("distances", [[]])[0]
        metadatas = result.get("metadatas", [[]])[0]

        for doc_id, dist, meta in zip(ids, distances, metadatas):
            # Chroma returns cosine *distance* (0 = identical).
            # Convert to a similarity score in [0, 1].
            score = 1.0 - min(dist, 1.0)
            items.append({"id": doc_id, "score": score, "metadata": meta})

        _log.debug("Chroma search returned %d results", len(items))
        return items

    def delete(self, doc_ids: list[str]) -> None:
        """
        Delete documents by ID from the Chroma collection.

        Args:
            doc_ids: List of document IDs to remove.
        """
        self._collection.delete(ids=doc_ids)
        _log.debug("Chroma deleted %d docs", len(doc_ids))

    def stats(self) -> dict:
        """Return backend name and collection count."""
        return {
            "backend": "chroma_local",
            "persist_dir": str(config.PROJECT_ROOT / "chroma_data"),
            "total_vectors": self._collection.count(),
        }


# ===========================================================================
# Metadata sanitiser (Chroma-specific)
# ===========================================================================

def _sanitize_metadata(meta: dict) -> dict:
    """
    Flatten metadata values to types Chroma accepts (str, int, float, bool).
    Nested dicts / lists are JSON-serialised to strings.

    Args:
        meta: Raw metadata dict.

    Returns:
        A new dict with Chroma-compatible values.
    """
    import json

    clean: dict[str, str | int | float | bool] = {}
    for key, value in meta.items():
        if isinstance(value, (str, int, float, bool)):
            clean[key] = value
        elif value is None:
            clean[key] = ""
        else:
            clean[key] = json.dumps(value, default=str)
    return clean


# ===========================================================================
# Backend auto-detection and singleton
# ===========================================================================

_backend: _VectorBackend | None = None


def _get_backend() -> _VectorBackend:
    """
    Return the active vector store backend.

    Auto-detection logic (evaluated once, then cached):
        1. If both SUPABASE_URL and SUPABASE_KEY are set → SupabaseBackend
        2. Otherwise → ChromaBackend (local, zero-config)

    Returns:
        A _VectorBackend instance.
    """
    global _backend
    if _backend is not None:
        return _backend

    if config.SUPABASE_URL and config.SUPABASE_KEY:
        _backend = _SupabaseBackend()
    else:
        _backend = _ChromaBackend()

    return _backend


# ===========================================================================
# Public API
# ===========================================================================

def upsert(doc_id: str, text: str, metadata: dict | None = None) -> None:
    """
    Embed a text and upsert it into the vector store.

    Args:
        doc_id: Unique document identifier (e.g. message UUID).
        text: The raw text to embed and store.
        metadata: Optional additional metadata. ``text`` is always
                  included automatically.

    Returns:
        None

    Example:
        upsert("msg_abc", "Orion remembers everything", {"user_id": "owner"})
    """
    meta = dict(metadata) if metadata else {}
    meta.setdefault("text", text)
    vector = embed(text)
    _get_backend().upsert(doc_id, vector, meta)
    _log.info("upsert doc_id=%s  dim=%d", doc_id, len(vector))


def search(
    query: str,
    top_k: int = 5,
    filters: Optional[dict] = None,
) -> list[dict]:
    """
    Embed a query and return the most similar documents.

    Args:
        query: Natural-language search query.
        top_k: Maximum number of results to return.
        filters: Optional backend-specific metadata filters.

    Returns:
        A list of result dicts with keys: id, score, metadata.

    Example:
        results = search("OAuth token refresh", top_k=3)
        for r in results:
            print(r["score"], r["metadata"]["text"])
    """
    vector = embed(query)
    results = _get_backend().search(vector, top_k=top_k, filters=filters)
    _log.info("search top_k=%d  returned=%d", top_k, len(results))
    return results


def delete(doc_ids: list[str]) -> None:
    """
    Delete one or more documents from the vector store by ID.

    Args:
        doc_ids: A list of document IDs to remove.

    Returns:
        None

    Example:
        delete(["msg_123", "msg_456"])
    """
    _get_backend().delete(doc_ids)
    _log.info("deleted %d docs", len(doc_ids))


def get_store_stats() -> dict:
    """
    Return statistics about the currently active vector store backend.

    Returns:
        A dict with at least ``backend`` (str) and ``total_vectors`` (int).

    Example:
        stats = get_store_stats()
        # {"backend": "chroma_local", "total_vectors": 342, ...}
    """
    return _get_backend().stats()
