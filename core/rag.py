"""
rag.py

RAG (Retrieval-Augmented Generation) pipeline for Orion.
Handles text chunking, embedding, vector storage, and retrieval
to provide relevant context for LLM calls.
Part of Orion — Persistent AI Companion System.
"""

import logging
import uuid
from pathlib import Path
from typing import Any

import config
import database.vector_store as vector_store

_log = logging.getLogger("orion.rag")
_handler = logging.FileHandler(config.LOGS_DIR / "rag.log")
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))


def _get_text_splitter():
    """
    Create a RecursiveCharacterTextSplitter with Orion defaults.

    Returns:
        LangChain RecursiveCharacterTextSplitter instance.
    """
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    return RecursiveCharacterTextSplitter(
        chunk_size=512,
        chunk_overlap=50,
        length_function=len,
        separators=["\n\n", "\n", ". ", " ", ""],
    )


def ingest(text: str, source: str, user_id: str, metadata: dict | None = None) -> str:
    """
    Ingest text into the RAG pipeline: chunk, embed, and store.

    Args:
        text: The raw text to ingest.
        source: The source identifier (e.g., file path, URL, conversation ID).
        user_id: The user ID for access control.
        metadata: Optional additional metadata.

    Returns:
        The document ID of the first chunk (or parent document).

    Example:
        doc_id = ingest("Long text content...", "chat_123", "owner")
    """
    if not text or not text.strip():
        _log.warning("Empty text provided to ingest, skipping")
        return ""

    meta = dict(metadata) if metadata else {}
    meta["source"] = source
    meta["user_id"] = user_id

    splitter = _get_text_splitter()
    chunks = splitter.split_text(text)

    if not chunks:
        _log.warning("No chunks produced from text")
        return ""

    parent_doc_id = str(uuid.uuid4())
    meta["parent_doc_id"] = parent_doc_id
    meta["total_chunks"] = len(chunks)

    for i, chunk in enumerate(chunks):
        chunk_id = f"{parent_doc_id}_chunk_{i}"
        chunk_meta = dict(meta)
        chunk_meta["chunk_index"] = i
        chunk_meta["text"] = chunk

        vector_store.upsert(chunk_id, chunk, chunk_meta)
        _log.debug("Ingested chunk %d/%d: %s", i + 1, len(chunks), chunk_id)

    _log.info(
        "Ingested document %s: %d chunks from source '%s'",
        parent_doc_id,
        len(chunks),
        source,
    )
    return parent_doc_id


def ingest_file(path: str, user_id: str) -> list[str]:
    """
    Load a file, chunk its content, and ingest all chunks.

    Detects file type by extension and uses the appropriate LangChain loader:
        - .pdf  → PyPDFLoader
        - .txt  → TextLoader
        - .md   → UnstructuredMarkdownLoader
        - .docx → Docx2txtLoader

    Args:
        path: The file path to ingest.
        user_id: The user ID for access control.

    Returns:
        A list of document IDs (one per top-level document/chunk group).

    Example:
        doc_ids = ingest_file("~/Documents/report.pdf", "owner")
    """
    file_path = Path(path).expanduser().resolve()
    if not file_path.exists():
        _log.error("File not found: %s", file_path)
        return []

    suffix = file_path.suffix.lower()
    source = str(file_path)

    try:
        documents = _load_file(file_path, suffix)
    except Exception as exc:
        _log.error("Failed to load file %s: %s", file_path, exc)
        return []

    if not documents:
        _log.warning("No documents extracted from file: %s", file_path)
        return []

    doc_ids = []
    for doc in documents:
        text = doc.page_content if hasattr(doc, "page_content") else str(doc)
        file_meta = doc.metadata if hasattr(doc, "metadata") else {}
        file_meta["file_path"] = source
        file_meta["file_type"] = suffix

        doc_id = ingest(text, source, user_id, file_meta)
        if doc_id:
            doc_ids.append(doc_id)

    _log.info(
        "Ingested file %s: %d documents, doc_ids=%s", source, len(doc_ids), doc_ids
    )
    return doc_ids


def _load_file(file_path: Path, suffix: str) -> list[Any]:
    """
    Load a file using the appropriate LangChain document loader.

    Args:
        file_path: Path object for the file.
        suffix: Lowercase file extension (e.g., ".pdf").

    Returns:
        A list of LangChain Document objects.
    """
    if suffix == ".pdf":
        from langchain_community.document_loaders import PyPDFLoader

        loader = PyPDFLoader(str(file_path))
        return loader.load()

    if suffix == ".txt":
        from langchain_community.document_loaders import TextLoader

        loader = TextLoader(str(file_path), encoding="utf-8")
        return loader.load()

    if suffix == ".md":
        from langchain_community.document_loaders import UnstructuredMarkdownLoader

        loader = UnstructuredMarkdownLoader(str(file_path))
        return loader.load()

    if suffix == ".docx":
        from langchain_community.document_loaders import Docx2txtLoader

        loader = Docx2txtLoader(str(file_path))
        return loader.load()

    _log.warning("Unsupported file type: %s, treating as plain text", suffix)
    from langchain_community.document_loaders import TextLoader

    loader = TextLoader(str(file_path), encoding="utf-8")
    return loader.load()


def query(question: str, user_id: str, top_k: int = 5) -> list[dict]:
    """
    Query the vector store for documents relevant to the question.

    Args:
        question: The search query or question.
        user_id: The user ID to filter results by.
        top_k: Maximum number of results to return.

    Returns:
        A list of dicts, each containing:
            - "text": The matched text content
            - "score": Similarity score (0-1)
            - "metadata": Associated metadata dict

    Example:
        results = query("What is OAuth?", "owner", top_k=3)
        for r in results:
            print(r["text"])
    """
    filters = {"user_id": user_id}

    results = vector_store.search(question, top_k=top_k, filters=filters)

    formatted = []
    for r in results:
        meta = r.get("metadata", {})
        text = meta.pop("text", "") if isinstance(meta, dict) else ""
        if not text and "text" in r:
            text = r["text"]

        formatted.append(
            {
                "text": text,
                "score": r.get("score", 0.0),
                "metadata": meta if isinstance(meta, dict) else {},
            }
        )

    _log.info(
        "Query '%s...' for user %s: %d results", question[:50], user_id, len(formatted)
    )
    return formatted


def build_context(question: str, user_id: str) -> str:
    """
    Build a formatted context string from relevant documents.

    Queries the vector store, formats results with source attribution,
    and returns a clean string ready to inject into an LLM prompt.

    Args:
        question: The question to find relevant context for.
        user_id: The user ID for access control.

    Returns:
        A formatted context string with source attribution.

    Example:
        context = build_context("Explain the auth system", "owner")
        prompt = f"Context:\n{context}\n\nQuestion: {question}"
    """
    results = query(question, user_id, top_k=5)

    if not results:
        _log.debug("No context found for question: %s", question[:50])
        return ""

    context_parts = []
    for i, r in enumerate(results, 1):
        text = r.get("text", "")
        score = r.get("score", 0.0)
        meta = r.get("metadata", {})
        source = meta.get("source", "unknown")
        chunk_idx = meta.get("chunk_index", "")

        source_label = source
        if chunk_idx != "":
            source_label = f"{source} (chunk {chunk_idx})"

        context_parts.append(
            f"[{i}] Source: {source_label} (relevance: {score:.2f})\n{text}"
        )

    context_str = "\n\n---\n\n".join(context_parts)
    _log.info(
        "Built context: %d chars from %d documents", len(context_str), len(results)
    )
    return context_str


def delete_document(doc_id: str) -> None:
    """
    Delete a document and all its chunks from the vector store.

    Args:
        doc_id: The parent document ID to delete.

    Example:
        delete_document("abc123")
    """
    all_docs = vector_store.search(doc_id, top_k=100)
    chunk_ids = []
    for doc in all_docs:
        meta = doc.get("metadata", {})
        if isinstance(meta, dict):
            if meta.get("parent_doc_id") == doc_id:
                chunk_ids.append(doc.get("id", ""))
            elif doc.get("id", "").startswith(f"{doc_id}_chunk_"):
                chunk_ids.append(doc.get("id", ""))

    if chunk_ids:
        vector_store.delete(chunk_ids)
        _log.info("Deleted document %s with %d chunks", doc_id, len(chunk_ids))
    else:
        _log.warning("No chunks found for document %s", doc_id)
