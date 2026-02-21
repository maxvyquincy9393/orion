"""
vector_store.py

Vector database client and operations for Orion.
Provides a unified interface for Pinecone or Supabase (pgvector)
to store and query embedding vectors.
Part of Orion — Persistent AI Companion System.
"""

from typing import Optional


def initialize_store() -> None:
    """
    Initialize the vector store connection.
    Connects to Pinecone or Supabase based on configuration.

    Returns:
        None

    Example:
        initialize_store()
    """
    raise NotImplementedError


def upsert_vector(doc_id: str, vector: list[float], metadata: dict) -> None:
    """
    Insert or update a vector in the store.

    Args:
        doc_id: Unique identifier for the document.
        vector: The embedding vector.
        metadata: Additional metadata (text, user_id, timestamp, etc.).

    Returns:
        None

    Example:
        upsert_vector("msg_123", [0.1, 0.2, ...], {"user_id": "owner", "text": "..."})
    """
    raise NotImplementedError


def query_similar(vector: list[float], top_k: int = 5, filters: Optional[dict] = None) -> list[dict]:
    """
    Query the vector store for vectors similar to the given vector.

    Args:
        vector: The query embedding vector.
        top_k: Number of top results to return.
        filters: Optional metadata filters.

    Returns:
        A list of result dicts with id, score, and metadata.

    Example:
        results = query_similar(query_vector, top_k=3)
    """
    raise NotImplementedError


def delete_vectors(doc_ids: list[str]) -> None:
    """
    Delete vectors from the store by their document IDs.

    Args:
        doc_ids: A list of document IDs to delete.

    Returns:
        None

    Example:
        delete_vectors(["msg_123", "msg_124"])
    """
    raise NotImplementedError


def get_store_stats() -> dict:
    """
    Get statistics about the vector store (count, index info, etc.).

    Returns:
        A dict with store stats.

    Example:
        stats = get_store_stats()
        # {"total_vectors": 1500, "index_name": "orion-memory"}
    """
    raise NotImplementedError
