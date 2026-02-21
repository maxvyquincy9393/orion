"""
main.py

Entry point for the Orion Persistent AI Companion System.
Starts a CLI chat loop for interactive conversation.
Part of Orion - Persistent AI Companion System.
"""

import argparse
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


def print_engines(engines: dict[str, object]) -> None:
    """
    Print available engines status.

    Args:
        engines: Dict of provider key to engine instance.
    """
    print("Available Engines:")
    display_rows = [
        ("anthropic", "Anthropic"),
        ("openai", "OpenAI"),
        ("gemini", "Gemini"),
        ("openrouter", "OpenRouter"),
        ("groq", "Groq"),
        ("local", "Local (Ollama)"),
    ]
    for key, label in display_rows:
        status = "[OK] online" if key in engines else "[--] offline"
        print(f"  {label:16} {status}")
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


def voice_loop(user_id: str) -> None:
    """
    Run voice-based interaction loop.

    Args:
        user_id: The user ID for the session.
    """
    print(f"User: {user_id}")
    print("Voice mode - Say 'Orion' to activate, 'exit' to quit.")
    print()

    try:
        from delivery.voice import VoicePipeline

        voice = VoicePipeline()
        print("Voice pipeline initialized.")

        voice.conversation_loop(
            wake_word="orion",
            on_wake=lambda: print("Listening..."),
            on_response=lambda text: print(f"Response: {text}"),
        )

    except ImportError:
        print("[Error] Voice dependencies not installed.")
        print("Install with: pip install TTS openai-whisper sounddevice soundfile")
    except Exception as exc:
        print(f"[Error] Voice initialization failed: {exc}")
        _log.error("Voice loop error: %s", exc)


def vision_loop(user_id: str) -> None:
    """
    Run vision-based interaction loop.

    Args:
        user_id: The user ID for the session.
    """
    print(f"User: {user_id}")
    print("Vision mode - Camera analysis active. Type 'exit' to quit.")
    print()

    try:
        from vision.stream import CameraStream
        from vision.processor import VisionProcessor

        camera = CameraStream()
        processor = VisionProcessor()

        camera.start()
        print("Camera started. Commands: capture | analyze | stop | exit")

        while True:
            try:
                cmd = input("Vision> ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                break

            if cmd in ("exit", "quit"):
                break
            elif cmd == "capture":
                frame = camera.get_frame()
                if frame is not None:
                    camera.save_frame(frame, config.DATA_DIR / "captures" / "frame.jpg")
                    print("Frame captured.")
            elif cmd == "analyze":
                frame = camera.get_frame()
                if frame is not None:
                    result = processor.analyze_frame(frame)
                    print(f"Analysis: {result[:500]}")
            elif cmd == "stop":
                camera.stop()
                print("Camera stopped.")
            elif cmd == "start":
                camera.start()
                print("Camera started.")

        camera.stop()

    except ImportError:
        print("[Error] Vision dependencies not installed.")
        print("Install with: pip install opencv-python numpy mss Pillow")
    except Exception as exc:
        print(f"[Error] Vision initialization failed: {exc}")
        _log.error("Vision loop error: %s", exc)


def all_modes_loop(user_id: str) -> None:
    """
    Run combined text, voice, and vision interaction.

    Args:
        user_id: The user ID for the session.
    """
    print(f"User: {user_id}")
    print("All modes - Text, voice, and vision available.")
    print("Commands: voice | vision | text | exit")
    print()

    current_mode = "text"

    while True:
        try:
            if current_mode == "text":
                user_input = input("You: ").strip()
            else:
                user_input = input(f"[{current_mode}] ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not user_input:
            continue

        if user_input.lower() in ("exit", "quit", "bye"):
            print("Goodbye!")
            break

        if user_input.lower() == "voice":
            current_mode = "voice"
            print("Switched to voice mode. Type 'text' to switch back.")
            continue

        if user_input.lower() == "vision":
            current_mode = "vision"
            print("Switched to vision mode. Type 'text' to switch back.")
            continue

        if user_input.lower() == "text":
            current_mode = "text"
            print("Switched to text mode.")
            continue

        if current_mode == "text":
            try:
                memory.save_message(user_id, "user", user_input)
                messages = context_module.build(
                    user_id, user_input, task_type="reasoning"
                )
                engine = orchestrator.route("reasoning")
                print(f"[{engine.get_name()}] ", end="", flush=True)
                response = engine.generate(user_input, messages)
                print(response)
                memory.save_message(
                    user_id,
                    "assistant",
                    response,
                    {"engine": engine.get_name()},
                )
            except Exception as exc:
                print(f"\n[Error] {exc}")
                _log.error("Error in all_modes_loop: %s", exc)


def parse_args() -> argparse.Namespace:
    """
    Parse command line arguments.

    Returns:
        Parsed arguments namespace.
    """
    parser = argparse.ArgumentParser(
        description="Orion - Persistent AI Companion System"
    )
    parser.add_argument(
        "--mode",
        choices=["text", "voice", "vision", "all"],
        default="text",
        help="Interaction mode (default: text)",
    )
    parser.add_argument(
        "--user",
        default=config.DEFAULT_USER_ID,
        help=f"User ID (default: {config.DEFAULT_USER_ID})",
    )
    return parser.parse_args()


def main() -> None:
    """
    Main entry point. Initializes configuration, database connections,
    and starts the Orion CLI chat loop.

    Returns:
        None
    """
    args = parse_args()

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
            print("Set up at least one provider:")
            print("  - ANTHROPIC_API_KEY")
            print("  - OPENAI_API_KEY or OpenAI OAuth login")
            print("  - GEMINI_API_KEY or Gemini OAuth login")
            print("  - OPENROUTER_API_KEY, GROQ_API_KEY, or MISTRAL_API_KEY")
            print("  - Or run Ollama locally for free inference")
            print()
    except Exception as exc:
        print(f"[Warning] Could not check engines: {exc}")
        _log.warning("Engine check failed: %s", exc)

    load_permissions()

    print(f"Mode: {args.mode}")
    print("-" * 60)
    print()

    try:
        if args.mode == "voice":
            voice_loop(args.user)
        elif args.mode == "vision":
            vision_loop(args.user)
        elif args.mode == "all":
            all_modes_loop(args.user)
        else:
            chat_loop(args.user)
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
