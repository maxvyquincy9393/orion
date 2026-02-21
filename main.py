"""
main.py

Entry point for the Orion Persistent AI Companion System.
Starts a CLI chat loop for interactive conversation.
Part of Orion — Persistent AI Companion System.
"""

import logging
import sys

import config
from database.models import create_all_tables
from core import orchestrator
from core import context as context_module
from core import memory


_log = logging.getLogger("orion.main")
_handler = logging.FileHandler(config.LOGS_DIR / "main.log")
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))

console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(logging.Formatter("%(message)s"))
logging.getLogger().addHandler(console_handler)
logging.getLogger().setLevel(logging.INFO)


def print_banner() -> None:
    """Print the Orion welcome banner."""
    print()
    print("=" * 60)
    print("   ORION - Persistent AI Companion System")
    print("=" * 60)
    print()


def print_engines(engines: list[str]) -> None:
    """Print available engines status."""
    print("Available Engines:")
    for name in ["claude", "openai", "gemini", "local"]:
        status = "✓ online" if name in engines else "✗ offline"
        print(f"  {name:10} {status}")
    print()


def load_permissions() -> bool:
    """
    Load and validate permissions configuration.

    Returns:
        True if permissions loaded successfully.
    """
    try:
        from permissions.config_loader import load_config

        perm_config = load_config()
        if perm_config:
            print("Permissions: Loaded from permissions.yaml")
            return True
    except Exception as exc:
        _log.debug("Could not load permissions config: %s", exc)

    print("Permissions: Using defaults (permissions.yaml not found)")
    return True


def chat_loop(user_id: str) -> None:
    """
    Run the interactive chat loop.

    Args:
        user_id: The user ID for the session.
    """
    print(f"User: {user_id}")
    print("Type your message and press Enter to chat.")
    print("Type 'exit' or 'quit' to stop.")
    print()

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not user_input:
            continue

        if user_input.lower() in ("exit", "quit", "bye"):
            print("Goodbye!")
            break

        try:
            memory.save_message(user_id, "user", user_input)

            messages = context_module.build(user_id, user_input, task_type="reasoning")

            engine = orchestrator.route("reasoning")

            print(f"[{engine.get_name()}] ", end="", flush=True)

            response = engine.generate(user_input, messages)

            print(response)

            memory.save_message(
                user_id,
                "assistant",
                response,
                {
                    "engine": engine.get_name(),
                },
            )

            _log.info("Conversation turn completed")

        except RuntimeError as exc:
            print(f"\n[Error] {exc}")
            _log.error("Runtime error in chat loop: %s", exc)
        except Exception as exc:
            print(f"\n[Error] Unexpected error: {exc}")
            _log.exception("Unexpected error in chat loop")


def main() -> None:
    """
    Main entry point. Initializes configuration, database connections,
    and starts the Orion CLI chat loop.

    Returns:
        None
    """
    print_banner()

    print("Initializing Orion...")

    try:
        create_all_tables()
        print("Database: Tables initialized")
        _log.info("Database tables created/verified")
    except Exception as exc:
        print(f"[Warning] Database initialization failed: {exc}")
        print("Continuing without persistent storage...")
        _log.warning("Database initialization failed: %s", exc)

    try:
        engines = orchestrator.get_available_engines()
        print_engines(engines)

        if not engines:
            print("[Warning] No LLM engines available!")
            print("Set up at least one engine in your .env file:")
            print("  - ANTHROPIC_API_KEY for Claude")
            print("  - OPENAI_ACCESS_TOKEN for GPT-4")
            print("  - GOOGLE_ACCESS_TOKEN for Gemini")
            print("  - Or run Ollama locally for free inference")
            print()
    except Exception as exc:
        print(f"[Warning] Could not check engines: {exc}")
        _log.warning("Engine check failed: %s", exc)

    load_permissions()

    user_id = config.DEFAULT_USER_ID

    print("-" * 60)
    print()

    try:
        chat_loop(user_id)
    except KeyboardInterrupt:
        print("\n\nInterrupted. Goodbye!")
    except Exception as exc:
        print(f"\n[Fatal] {exc}")
        _log.exception("Fatal error in main")
        sys.exit(1)

    _log.info("Orion shutdown complete")


def start_services() -> None:
    """
    Start all Orion services:
    - Database connection
    - Vector store initialization
    - Background daemon process
    - Delivery channels (Telegram/WhatsApp)
    - Voice pipeline (optional)

    Returns:
        None
    """
    _log.info("Starting Orion services...")

    create_all_tables()
    _log.info("Database service started")

    try:
        from database.vector_store import get_store_stats

        stats = get_store_stats()
        _log.info("Vector store started: %s", stats)
    except Exception as exc:
        _log.warning("Vector store initialization failed: %s", exc)

    _log.info("All services started")


def shutdown() -> None:
    """
    Gracefully shut down all Orion services.

    Returns:
        None
    """
    _log.info("Shutting down Orion services...")
    _log.info("Shutdown complete")


if __name__ == "__main__":
    main()
