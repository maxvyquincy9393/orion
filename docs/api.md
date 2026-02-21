# API Reference — Orion

> Internal interfaces and their contracts.
> All modules must follow these interfaces exactly.

---

## Engines (engines/base.py)

```python
class BaseEngine:
    def generate(self, prompt: str, context: list[dict]) -> str
    def stream(self, prompt: str, context: list[dict]) -> Iterator[str]
    def is_available(self) -> bool
```

## Memory (core/memory.py)

```python
def save_message(user_id: str, role: str, content: str, metadata: dict) -> None
def get_history(user_id: str, limit: int = 50) -> list[dict]
def get_relevant_context(user_id: str, query: str, top_k: int = 5) -> list[dict]
def compress_old_sessions(user_id: str, older_than_days: int = 30) -> None
```

## Orchestrator (core/orchestrator.py)

```python
def route(task_type: str) -> BaseEngine
# task_type: "reasoning" | "code" | "voice" | "multimodal" | "fast"
```

## Thread Manager (background/thread_manager.py)

```python
def open_thread(user_id: str, trigger: str) -> str
def update_state(thread_id: str, state: str) -> None
def get_pending_threads(user_id: str) -> list[dict]
def should_follow_up(thread_id: str) -> bool
```

## Token Manager (auth/token_manager.py)

```python
def get_token(provider: str) -> str
def save_token(provider: str, token_data: dict) -> None
def refresh_token(provider: str) -> str
def is_expired(provider: str) -> bool
```

## RAG Pipeline (core/rag.py)

```python
def embed_text(text: str) -> list[float]
def store_embedding(doc_id: str, text: str, vector: list[float], metadata: dict) -> None
def query(query_text: str, top_k: int = 5, filters: dict | None = None) -> list[dict]
def delete_embeddings(doc_ids: list[str]) -> None
```

## Context Builder (core/context.py)

```python
def build_context(user_id: str, current_message: str, max_tokens: int = 4000, include_system_prompt: bool = True) -> list[dict]
def get_system_prompt() -> str
def truncate_context(messages: list[dict], max_tokens: int) -> list[dict]
```

---

*Update this document when interfaces change.*
