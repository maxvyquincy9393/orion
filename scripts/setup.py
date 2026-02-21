"""
setup.py

Interactive multi-provider setup wizard for Orion.
Configures Telegram, AI providers, connectivity tests, and database settings.
Part of Orion - Persistent AI Companion System.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from engines.auth.manager import get_auth_manager

ENV_PATH = project_root / ".env"
load_dotenv(ENV_PATH)

PROVIDER_MENU = {
    "1": "anthropic",
    "2": "openai",
    "3": "gemini",
    "4": "openrouter",
    "5": "groq",
    "6": "mistral",
    "7": "ollama",
    "8": "skip",
}

PROVIDER_LABELS = {
    "anthropic": "Anthropic",
    "openai": "OpenAI",
    "gemini": "Gemini",
    "openrouter": "OpenRouter",
    "groq": "Groq",
    "mistral": "Mistral",
    "ollama": "Ollama",
}

DEFAULT_VALUES = {
    "OLLAMA_BASE_URL": "http://localhost:11434",
    "OLLAMA_MODEL": "llama3.2",
    "DATABASE_URL": "sqlite:///orion.db",
    "DEFAULT_USER_ID": "owner",
    "DEFAULT_ENGINE": "anthropic",
    "PERMISSIONS_CONFIG": "permissions/permissions.yaml",
    "LOG_LEVEL": "INFO",
}


def print_header() -> None:
    """Print setup wizard header."""
    print()
    print("=" * 60)
    print("Orion Setup")
    print("=" * 60)
    print()


def load_existing_env() -> dict[str, str]:
    """Load existing .env key/value pairs if file exists."""
    if not ENV_PATH.exists():
        return {}

    existing: dict[str, str] = {}
    for raw_line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        existing[key.strip()] = value.strip()
    return existing


def prompt_input(label: str, default: str = "", required: bool = False) -> str:
    """
    Prompt user input with optional default.

    Args:
        label: Prompt label.
        default: Default value if user enters empty.
        required: If True, re-prompt until non-empty.

    Returns:
        User input value.
    """
    suffix = f" [{default}]" if default else ""
    prompt = f"{label}{suffix}: "

    while True:
        try:
            value = input(prompt).strip()
        except (EOFError, KeyboardInterrupt):
            print("\nSetup cancelled.")
            sys.exit(0)

        if value:
            return value
        if default:
            return default
        if not required:
            return ""
        print("This field is required.")


def prompt_yes_no(label: str, default: bool = False) -> bool:
    """
    Prompt user for yes/no decision.

    Args:
        label: Prompt label.
        default: Default boolean value.

    Returns:
        True for yes, False for no.
    """
    marker = "Y/n" if default else "y/N"
    try:
        value = input(f"{label} [{marker}]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print("\nSetup cancelled.")
        sys.exit(0)

    if not value:
        return default
    return value in {"y", "yes", "1", "true"}


def parse_multi_selection(raw: str) -> list[str]:
    """
    Parse multi-select provider input into ordered provider names.

    Args:
        raw: Input like "1 3 5" or "1,3,5".

    Returns:
        Ordered list of provider keys.
    """
    normalized = raw.replace(",", " ")
    items = [item.strip() for item in normalized.split() if item.strip()]

    selected: list[str] = []
    for item in items:
        provider = PROVIDER_MENU.get(item)
        if provider and provider not in selected:
            selected.append(provider)
    return selected


def merge_updates(
    existing: dict[str, str],
    updates: dict[str, str],
) -> dict[str, str]:
    """
    Merge updates into existing env values safely.

    Existing non-empty values are not overwritten unless user confirms.

    Args:
        existing: Existing env values.
        updates: New values gathered by wizard.

    Returns:
        Merged env dictionary.
    """
    merged = dict(existing)

    for key, new_value in updates.items():
        if new_value is None:
            continue

        new_value = str(new_value).strip()
        if not new_value:
            continue

        current = merged.get(key, "").strip()
        if current and current != new_value:
            should_replace = prompt_yes_no(
                f"{key} already has a value. Replace it?",
                default=False,
            )
            if not should_replace:
                continue

        merged[key] = new_value

    return merged


def write_env(values: dict[str, str]) -> None:
    """
    Write .env file in sectioned format while preserving extra keys.

    Args:
        values: Final env mapping.
    """
    section_keys = {
        "Telegram": ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
        "Provider Keys": [
            "ANTHROPIC_API_KEY",
            "OPENAI_API_KEY",
            "GEMINI_API_KEY",
            "OPENROUTER_API_KEY",
            "GROQ_API_KEY",
            "MISTRAL_API_KEY",
        ],
        "Ollama": ["OLLAMA_BASE_URL", "OLLAMA_MODEL"],
        "Database": ["DATABASE_URL"],
        "General": [
            "DEFAULT_USER_ID",
            "DEFAULT_ENGINE",
            "PERMISSIONS_CONFIG",
            "LOG_LEVEL",
        ],
    }

    known_keys = {key for keys in section_keys.values() for key in keys}

    lines = [
        "# ============================================",
        "# Orion - Environment Variables",
        "# ============================================",
        "# Generated by scripts/setup.py",
        "# ============================================",
        "",
    ]

    for section, keys in section_keys.items():
        lines.append(f"# {section}")
        for key in keys:
            lines.append(f"{key}={values.get(key, '')}")
        lines.append("")

    extras = sorted(k for k in values.keys() if k not in known_keys)
    if extras:
        lines.append("# Preserved Values")
        for key in extras:
            lines.append(f"{key}={values.get(key, '')}")
        lines.append("")

    ENV_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nSaved configuration: {ENV_PATH}")


def apply_env_to_process(values: dict[str, str]) -> None:
    """
    Apply env values to current process for immediate runtime use.

    Args:
        values: Env values to apply.
    """
    for key, value in values.items():
        os.environ[key] = value


def configure_telegram(existing: dict[str, str], updates: dict[str, str]) -> None:
    """Run setup step for required Telegram delivery config."""
    print("Step 1 - Telegram (required for delivery)")

    token_default = existing.get("TELEGRAM_BOT_TOKEN", "")
    updates["TELEGRAM_BOT_TOKEN"] = prompt_input(
        "TELEGRAM_BOT_TOKEN",
        default=token_default,
        required=not bool(token_default),
    )

    print("Find TELEGRAM_CHAT_ID by sending a message to @userinfobot on Telegram.")
    chat_default = existing.get("TELEGRAM_CHAT_ID", "")
    updates["TELEGRAM_CHAT_ID"] = prompt_input(
        "TELEGRAM_CHAT_ID",
        default=chat_default,
        required=not bool(chat_default),
    )

    print()


def choose_providers() -> list[str]:
    """Run setup step for provider multi-selection."""
    print("Step 2 - Choose AI providers (multiple allowed)")
    print("[1] Anthropic (Claude) - API key from console.anthropic.com")
    print("[2] OpenAI/Codex - API key OR login with subscription")
    print("[3] Google Gemini - API key OR OAuth login")
    print("[4] OpenRouter - one API key for many models (openrouter.ai/keys)")
    print("[5] Groq - fast free API key (console.groq.com)")
    print("[6] Mistral - API key (console.mistral.ai)")
    print("[7] Ollama - local models, no API key")
    print("[8] Skip - configure later")

    while True:
        raw = prompt_input("Select providers (example: 1 3 5 or 1,3,5)")
        selected = parse_multi_selection(raw)
        if not selected:
            print("No valid selection detected. Try again.")
            continue

        if "skip" in selected and len(selected) > 1:
            selected = [provider for provider in selected if provider != "skip"]

        return selected


def configure_openai(
    existing: dict[str, str],
    updates: dict[str, str],
    auth_manager,
) -> None:
    """Configure OpenAI via API key or OAuth login."""
    print("\nOpenAI setup")
    print("[1] Enter API key")
    print("[2] Login with ChatGPT/Codex subscription")

    choice = prompt_input("Choose OpenAI auth mode", default="1")
    if choice.strip() == "2":
        success = auth_manager.login_provider("openai")
        if success:
            print("OpenAI OAuth login successful.")
        else:
            print("OpenAI OAuth login failed. You can configure API key later.")
        return

    default_key = existing.get("OPENAI_API_KEY", "")
    updates["OPENAI_API_KEY"] = prompt_input(
        "OPENAI_API_KEY",
        default=default_key,
        required=not bool(default_key),
    )


def configure_gemini(
    existing: dict[str, str],
    updates: dict[str, str],
    auth_manager,
) -> None:
    """Configure Gemini via API key or OAuth login."""
    print("\nGemini setup")
    print("[1] Enter API key (free)")
    print("[2] Login with Google account (OAuth)")

    choice = prompt_input("Choose Gemini auth mode", default="1")
    if choice.strip() == "2":
        success = auth_manager.login_provider("gemini")
        if success:
            print("Gemini OAuth login successful.")
        else:
            print("Gemini OAuth login failed. You can configure API key later.")
        return

    default_key = existing.get("GEMINI_API_KEY", "")
    updates["GEMINI_API_KEY"] = prompt_input(
        "GEMINI_API_KEY",
        default=default_key,
        required=not bool(default_key),
    )


def configure_ollama(existing: dict[str, str], updates: dict[str, str]) -> None:
    """Configure local Ollama provider settings."""
    print("\nOllama setup")

    ollama_path = shutil.which("ollama")
    if not ollama_path:
        print("Ollama was not found in PATH.")
        print("Install command (Windows): winget install Ollama.Ollama")
        updates["OLLAMA_BASE_URL"] = existing.get(
            "OLLAMA_BASE_URL", DEFAULT_VALUES["OLLAMA_BASE_URL"]
        )
        updates["OLLAMA_MODEL"] = existing.get(
            "OLLAMA_MODEL", DEFAULT_VALUES["OLLAMA_MODEL"]
        )
        return

    print(f"Detected ollama: {ollama_path}")

    try:
        listed = subprocess.run(
            ["ollama", "list"],
            capture_output=True,
            text=True,
            check=False,
            timeout=20,
        )
        output = (listed.stdout or "").strip()
        if output:
            print("Installed Ollama models:")
            print(output)
        else:
            print("No local models listed yet.")
    except Exception as exc:
        print(f"Could not run 'ollama list': {exc}")

    default_model = existing.get("OLLAMA_MODEL", DEFAULT_VALUES["OLLAMA_MODEL"])
    updates["OLLAMA_MODEL"] = prompt_input("Preferred Ollama model", default=default_model)
    updates["OLLAMA_BASE_URL"] = existing.get(
        "OLLAMA_BASE_URL", DEFAULT_VALUES["OLLAMA_BASE_URL"]
    )


def configure_selected_providers(
    selected: list[str],
    existing: dict[str, str],
    updates: dict[str, str],
    auth_manager,
) -> None:
    """Collect credentials for each selected provider."""
    if selected == ["skip"]:
        print("Provider setup skipped.")
        print()
        return

    for provider in selected:
        if provider == "anthropic":
            updates["ANTHROPIC_API_KEY"] = prompt_input(
                "ANTHROPIC_API_KEY",
                default=existing.get("ANTHROPIC_API_KEY", ""),
                required=not bool(existing.get("ANTHROPIC_API_KEY", "")),
            )
        elif provider == "openai":
            configure_openai(existing, updates, auth_manager)
        elif provider == "gemini":
            configure_gemini(existing, updates, auth_manager)
        elif provider == "openrouter":
            updates["OPENROUTER_API_KEY"] = prompt_input(
                "OPENROUTER_API_KEY",
                default=existing.get("OPENROUTER_API_KEY", ""),
                required=not bool(existing.get("OPENROUTER_API_KEY", "")),
            )
        elif provider == "groq":
            updates["GROQ_API_KEY"] = prompt_input(
                "GROQ_API_KEY",
                default=existing.get("GROQ_API_KEY", ""),
                required=not bool(existing.get("GROQ_API_KEY", "")),
            )
        elif provider == "mistral":
            updates["MISTRAL_API_KEY"] = prompt_input(
                "MISTRAL_API_KEY",
                default=existing.get("MISTRAL_API_KEY", ""),
                required=not bool(existing.get("MISTRAL_API_KEY", "")),
            )
        elif provider == "ollama":
            configure_ollama(existing, updates)


def test_anthropic(api_key: str) -> tuple[bool, str]:
    """Test Anthropic API connectivity."""
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        client.models.list()
        return True, "claude-opus-4-6"
    except Exception as exc:
        return False, str(exc)


def test_openai(auth_manager) -> tuple[bool, str]:
    """Test OpenAI connectivity using available auth mode."""
    token = auth_manager.get_token("openai")
    if not token:
        return False, "no credentials"

    try:
        if token.startswith("Bearer "):
            response = requests.get(
                "https://api.openai.com/v1/models",
                headers={"Authorization": token},
                timeout=15,
            )
            if response.ok:
                return True, "gpt-5.2"
            return False, response.text

        from openai import OpenAI

        client = OpenAI(api_key=token)
        client.models.list()
        return True, "gpt-5.2"
    except Exception as exc:
        return False, str(exc)


def test_gemini(auth_manager) -> tuple[bool, str]:
    """Test Gemini connectivity using available auth mode."""
    token = auth_manager.get_token("gemini")
    if not token:
        return False, "no credentials"

    try:
        if token.startswith("Bearer "):
            response = requests.get(
                "https://generativelanguage.googleapis.com/v1beta/models",
                headers={"Authorization": token},
                timeout=15,
            )
            if response.ok:
                return True, "gemini-3.1-pro"
            return False, response.text

        import google.generativeai as genai

        genai.configure(api_key=token)
        list(genai.list_models())
        return True, "gemini-3.1-pro"
    except Exception as exc:
        return False, str(exc)


def test_openrouter(api_key: str) -> tuple[bool, str]:
    """Test OpenRouter API connectivity."""
    try:
        from openai import OpenAI

        client = OpenAI(
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1",
            default_headers={
                "HTTP-Referer": "https://github.com/maxvyquincy9393/orion",
            },
        )
        client.models.list()
        return True, "openrouter/auto"
    except Exception as exc:
        return False, str(exc)


def test_groq(api_key: str) -> tuple[bool, str]:
    """Test Groq API connectivity."""
    try:
        from groq import Groq

        client = Groq(api_key=api_key)
        client.models.list()
        return True, "llama-3.3-70b-versatile"
    except Exception as exc:
        return False, str(exc)


def test_mistral(api_key: str) -> tuple[bool, str]:
    """Test Mistral API connectivity with a minimal models endpoint call."""
    try:
        response = requests.get(
            "https://api.mistral.ai/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15,
        )
        if response.ok:
            return True, "mistral-large"
        return False, response.text
    except Exception as exc:
        return False, str(exc)


def test_ollama(base_url: str) -> tuple[bool, str]:
    """Test Ollama local connectivity."""
    try:
        response = requests.get(f"{base_url.rstrip('/')}/api/tags", timeout=10)
        if response.ok:
            return True, "auto-detect"
        return False, response.text
    except Exception as exc:
        return False, str(exc)


def run_connectivity_tests(final_env: dict[str, str], auth_manager) -> dict[str, bool]:
    """
    Run connectivity tests for configured providers.

    Args:
        final_env: Final merged env values.
        auth_manager: Shared AuthManager.

    Returns:
        Dict of provider -> readiness status.
    """
    print("Step 3 - Connectivity tests")

    results: dict[str, tuple[bool, str]] = {}

    if final_env.get("ANTHROPIC_API_KEY"):
        results["anthropic"] = test_anthropic(final_env["ANTHROPIC_API_KEY"])

    if auth_manager.get_token("openai"):
        results["openai"] = test_openai(auth_manager)

    if auth_manager.get_token("gemini"):
        results["gemini"] = test_gemini(auth_manager)

    if final_env.get("OPENROUTER_API_KEY"):
        results["openrouter"] = test_openrouter(final_env["OPENROUTER_API_KEY"])

    if final_env.get("GROQ_API_KEY"):
        results["groq"] = test_groq(final_env["GROQ_API_KEY"])

    if final_env.get("MISTRAL_API_KEY"):
        results["mistral"] = test_mistral(final_env["MISTRAL_API_KEY"])

    ollama_url = final_env.get("OLLAMA_BASE_URL", DEFAULT_VALUES["OLLAMA_BASE_URL"])
    ollama_ok, ollama_msg = test_ollama(ollama_url)
    if final_env.get("OLLAMA_MODEL") or ollama_ok:
        results["ollama"] = (ollama_ok, ollama_msg)

    if not results:
        print("No configured providers found for connectivity tests.")
        print()
        return {}

    print()
    readiness: dict[str, bool] = {}
    for provider, (ok, msg) in results.items():
        label = PROVIDER_LABELS.get(provider, provider)
        if ok:
            print(f"{label}: OK ({msg})")
        else:
            print(f"{label}: FAILED: {msg}")
        readiness[provider] = ok

    print("\nSummary")
    print("-" * 60)
    for provider in sorted(readiness.keys()):
        status = "READY" if readiness[provider] else "FAILED"
        print(f"{provider:12} {status}")
    print()

    return readiness


def configure_database(existing: dict[str, str], updates: dict[str, str]) -> None:
    """Run setup step for database configuration."""
    print("Step 4 - Database")
    print("[1] SQLite (quick start, local)")
    print("[2] PostgreSQL (production)")

    current = existing.get("DATABASE_URL", DEFAULT_VALUES["DATABASE_URL"])
    choice = prompt_input("Choose database", default="1")

    if choice.strip() == "2":
        updates["DATABASE_URL"] = prompt_input(
            "PostgreSQL connection string",
            default=current if current.startswith("postgresql") else "",
            required=True,
        )
    else:
        updates["DATABASE_URL"] = "sqlite:///orion.db"

    print()


def print_final_summary(readiness: dict[str, bool]) -> None:
    """Print final setup summary and next steps."""
    print("Step 5 - Final summary")

    ready = sorted([provider for provider, ok in readiness.items() if ok])
    failed = sorted([provider for provider, ok in readiness.items() if not ok])

    if ready:
        print("Providers ready:")
        for provider in ready:
            print(f"- {provider}")
    else:
        print("No providers are fully ready yet.")

    if failed:
        print("Providers with failed connectivity:")
        for provider in failed:
            print(f"- {provider}")

    print()
    print("Run python scripts/first_run.py to test")
    print("Run python main.py to start Orion")


def apply_defaults(existing: dict[str, str], updates: dict[str, str]) -> None:
    """Fill baseline defaults for config keys not explicitly updated."""
    for key, value in DEFAULT_VALUES.items():
        if key not in updates:
            updates[key] = existing.get(key, value)


def main() -> None:
    """Run the Orion multi-provider setup wizard."""
    print_header()

    existing = load_existing_env()
    updates: dict[str, str] = {}
    auth_manager = get_auth_manager()

    configure_telegram(existing, updates)

    selected = choose_providers()
    configure_selected_providers(selected, existing, updates, auth_manager)

    apply_defaults(existing, updates)

    merged = merge_updates(existing, updates)
    write_env(merged)
    apply_env_to_process(merged)

    readiness = run_connectivity_tests(merged, auth_manager)

    configure_database(merged, updates)

    apply_defaults(merged, updates)
    merged = merge_updates(merged, updates)
    write_env(merged)
    apply_env_to_process(merged)

    print_final_summary(readiness)


if __name__ == "__main__":
    main()
