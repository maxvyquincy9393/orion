"""
rag.py

RAG (Retrieval-Augmented Generation) pipeline for Orion.
Handles embedding text, storing vectors, and querying the vector database
to provide relevant context for LLM calls.
Part of Orion — Persistent AI Companion System.
"""

from typing import Optional


def embed_text(text: str) -> list[float]:
    """
    Generate an embedding vector for a given text string.

    Args:
        text: The text to embed.

    Returns:
        A list of floats representing the embedding vector.

    Example:
        vector = embed_text("How does OAuth work?")
    """
    raise NotImplementedError


def store_embedding(doc_id: str, text: str, vector: list[float], metadata: dict) -> None:
    """
    Store an embedding vector along with its source text and metadata
    in the vector database.

    Args:
        doc_id: A unique identifier for the document/chunk.
        text: The original text that was embedded.
        vector: The embedding vector.
        metadata: Additional metadata (user_id, timestamp, source, etc.).

    Returns:
        None

    Example:
        store_embedding("msg_123", "Hello world", [0.1, 0.2, ...], {"user_id": "owner"})
    """
    raise NotImplementedError


def query(query_text: str, top_k: int = 5, filters: Optional[dict] = None) -> list[dict]:
    """
    Query the vector database for documents similar to the query text.

    Args:
        query_text: The text to search for.
        top_k: Number of top results to return. Defaults to 5.
        filters: Optional metadata filters to narrow the search.

    Returns:
        A list of dicts containing matched text, score, and metadata.

    Example:
        results = query("What did we discuss about memory?", top_k=3)
    """
    raise NotImplementedError


def delete_embeddings(doc_ids: list[str]) -> None:
    """
    Delete embeddings from the vector database by their document IDs.

    Args:
        doc_ids: A list of document IDs to delete.

    Returns:
        None

    Example:
        delete_embeddings(["msg_123", "msg_124"])
    """
    raise NotImplementedError
