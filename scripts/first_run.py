"""
first_run.py

End-to-end smoke test for Orion.
Verifies database, memory, engines, and daemon are working.

Run with: python scripts/first_run.py

Part of Orion - Persistent AI Companion System.
"""

import os
import sys
import time
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv

ENV_PATH = project_root / ".env"
load_dotenv(ENV_PATH)


def print_header() -> None:
    """Print the test header."""
    print()
    print("=" * 60)
    print("   ORION FIRST RUN TEST")
    print("=" * 60)
    print()


def print_section(title: str) -> None:
    """Print a section header."""
    print(f"\n--- {title} ---\n")


def print_result(name: str, success: bool, message: str = "") -> None:
    """Print a test result."""
    status = "[OK]" if success else "[FAILED]"
    msg = f"  {status} {name}"
    if message:
        msg += f" - {message}"
    print(msg)


def test_database() -> bool:
    """
    Test database connection and table creation.

    Returns:
        True if database tests pass.
    """
    print_section("Database")

    try:
        from database.models import create_all_tables, get_engine

        engine = get_engine()
        db_url = str(engine.url)
        print(f"  Database URL: {db_url}")

        create_all_tables()
        print_result("Table creation", True)

        from sqlalchemy import inspect

        inspector = inspect(engine)
        tables = inspector.get_table_names()
        print_result("Tables exist", True, f"{len(tables)} tables")
        print(f"    Tables: {', '.join(tables)}")

        return True

    except Exception as exc:
        print_result("Database setup", False, str(exc))
        return False


def test_memory() -> bool:
    """
    Test memory save and retrieve.

    Returns:
        True if memory tests pass.
    """
    print_section("Memory")

    try:
        from core import memory

        user_id = os.getenv("DEFAULT_USER_ID", "owner")

        memory.save_message(user_id, "system", "Orion initialized", {})
        print_result("Save message", True)

        history = memory.get_history(user_id, limit=5)
        print_result("Get history", True, f"{len(history)} messages")

        if history:
            last_msg = history[-1]
            print(
                f"    Last message: {last_msg['role']} - {last_msg['content'][:50]}..."
            )

        return True

    except Exception as exc:
        print_result("Memory operations", False, str(exc))
        return False


def test_engines() -> tuple[bool, list[str]]:
    """
    Test available LLM engines.

    Returns:
        Tuple of (success, list of available engine names).
    """
    print_section("LLM Engines")

    try:
        from core import orchestrator

        engines = orchestrator.get_available_engines()

        for name in ["claude", "openai", "gemini", "local"]:
            if name in engines:
                print_result(name, True, "online")
            else:
                print_result(name, False, "offline")

        if engines:
            print(f"\n  Available engines: {', '.join(engines)}")
            return True, engines
        else:
            print("\n  No engines available!")
            return False, []

    except Exception as exc:
        print_result("Engine check", False, str(exc))
        return False, []


def test_conversation(engines: list[str]) -> bool:
    """
    Test a simple conversation with an available engine.

    Args:
        engines: List of available engine names.

    Returns:
        True if conversation test passes.
    """
    print_section("Conversation Test")

    if not engines:
        print_result("Conversation", False, "No engines available")
        return False

    try:
        from core import orchestrator, memory, context as context_module

        user_id = os.getenv("DEFAULT_USER_ID", "owner")
        test_prompt = "Hello, say 'Orion is online' and nothing else."

        print(f"  Sending test message to {engines[0]}...")

        engine = orchestrator.route("reasoning")
        messages = context_module.build(user_id, test_prompt, task_type="reasoning")

        memory.save_message(user_id, "user", test_prompt)

        response = engine.generate(test_prompt, messages)

        memory.save_message(
            user_id, "assistant", response, {"engine": engine.get_name()}
        )

        print_result("Engine response", True)
        print(f"    Response: {response[:100]}...")

        return True

    except Exception as exc:
        print_result("Conversation", False, str(exc))
        return False


def test_daemon() -> bool:
    """
    Test daemon start and stop.

    Returns:
        True if daemon tests pass.
    """
    print_section("Daemon")

    try:
        from background.process import OrionDaemon

        daemon = OrionDaemon(interval_seconds=1)

        daemon.start()
        print_result("Daemon start", True)

        time.sleep(5)

        status = daemon.get_status()
        print_result(
            "Daemon running", status["running"], f"cycles: {status['cycle_count']}"
        )

        daemon.stop()
        print_result("Daemon stop", True)

        return True

    except Exception as exc:
        print_result("Daemon", False, str(exc))
        return False


def print_summary(results: dict) -> None:
    """
    Print final summary.

    Args:
        results: Dict of test results.
    """
    print("\n" + "=" * 60)
    print("   TEST SUMMARY")
    print("=" * 60)

    all_passed = True
    for name, passed in results.items():
        status = "[OK]" if passed else "[FAILED]"
        print(f"  {status} {name}")
        if not passed:
            all_passed = False

    print("\n" + "-" * 60)

    if all_passed:
        print("  All tests passed. Orion is ready.")
        print("\n  Run: python main.py")
    else:
        print("  Some tests failed. Check configuration.")

    print("\n" + "=" * 60)


def main() -> None:
    """
    Run all first-run tests.

    Steps:
        1. Test database
        2. Test memory
        3. Test engines
        4. Test conversation (if engines available)
        5. Test daemon
        6. Print summary
    """
    print_header()

    if not ENV_PATH.exists():
        print("  ERROR: .env file not found.")
        print("  Run: python scripts/setup.py")
        sys.exit(1)

    print(f"  Configuration: {ENV_PATH}")

    results = {}

    results["database"] = test_database()
    results["memory"] = test_memory()

    engines_ok, engines = test_engines()
    results["engines"] = engines_ok

    if engines:
        results["conversation"] = test_conversation(engines)
    else:
        results["conversation"] = False
        print_section("Conversation Test")
        print_result("Conversation", False, "No engines available")

    results["daemon"] = test_daemon()

    print_summary(results)


if __name__ == "__main__":
    main()
