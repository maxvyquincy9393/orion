# Orion Setup Guide

This guide covers how to install and configure Orion on your system.

## Prerequisites

- Python 3.11 or higher
- pip (Python package manager)
- git

## Installation

1. Clone the repository:

```bash
git clone https://github.com/maxvyquincy9393/orion.git
cd orion
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Run the setup wizard:

```bash
python scripts/setup.py
```

The setup wizard will guide you through entering all required credentials.

## Quick Start (SQLite + Claude)

The fastest way to get Orion running:

1. Run setup:
```bash
python scripts/setup.py
```

2. Enter your Anthropic API key when prompted (required)

3. Enter your Telegram bot token and chat ID (required for delivery)

4. Run the smoke test:
```bash
python scripts/first_run.py
```

5. Start Orion:
```bash
python main.py
```

## Telegram Bot Setup

Orion uses Telegram for proactive messages and confirmations.

### Create a Bot

1. Open Telegram and search for @BotFather

2. Send the command: `/newbot`

3. Follow the prompts to name your bot

4. BotFather will give you a token like: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`

5. Save this token - you will enter it during setup

### Get Your Chat ID

1. Open Telegram and search for @userinfobot

2. Start a conversation with it

3. It will reply with your chat ID (a number like `123456789`)

4. Save this ID - you will enter it during setup

## Full Setup (PostgreSQL + All Engines)

For production use, PostgreSQL is recommended over SQLite.

### PostgreSQL Installation

1. Install PostgreSQL on your system

2. Create a database:
```sql
CREATE DATABASE orion;
```

3. Create a user:
```sql
CREATE USER orion_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE orion TO orion_user;
```

4. Set the DATABASE_URL in your .env:
```
DATABASE_URL=postgresql://orion_user:your_password@localhost:5432/orion
```

### API Keys

#### Anthropic Claude (Required)
1. Go to https://console.anthropic.com/
2. Create an account or log in
3. Navigate to API Keys
4. Create a new API key
5. Add to .env as ANTHROPIC_API_KEY

#### OpenAI (Optional)
1. Go to https://platform.openai.com/api-keys
2. Create an API key
3. Add to .env as OPENAI_API_KEY

#### Google Gemini (Optional)
1. Go to https://aistudio.google.com/apikey
2. Create an API key
3. Add to .env as GEMINI_API_KEY

## Voice Setup

For voice input and output:

```bash
pip install TTS openai-whisper sounddevice soundfile
```

Voice uses:
- Whisper (local) for speech-to-text
- Coqui TTS (local) for text-to-speech

To use ElevenLabs TTS instead:
1. Get an API key from https://elevenlabs.io/
2. Add to .env as ELEVENLABS_API_KEY
3. Set TTS_ENGINE=elevenlabs

## Vision Setup

For camera and screen capture:

```bash
pip install opencv-python numpy mss Pillow pytesseract
```

For OCR functionality, also install Tesseract:
- Windows: https://github.com/UB-Mannheim/tesseract/wiki
- macOS: `brew install tesseract`
- Linux: `sudo apt install tesseract-ocr`

## Permissions Configuration

Orion's permission system is configured via `permissions/permissions.yaml`.

### Key Settings

```yaml
permissions:
  file_system:
    enabled: true
    read: true
    write: true
    delete: false          # Disabled by default
    require_confirm: true  # Ask before writing
    allowed_paths:
      - "~/Documents/orion"
    blocked_paths:
      - "~/.ssh"
      - "~/.env"

  terminal:
    enabled: true
    require_confirm: true  # Always ask before running commands
    blocked_commands:
      - "rm -rf"
      - "sudo"
```

### Hot Reload

Permissions can be changed without restarting Orion. Edit the YAML file and the changes take effect immediately.

## Running Orion

### Text Mode (Default)
```bash
python main.py
```

### Voice Mode
```bash
python main.py --mode voice
```

### Vision Mode
```bash
python main.py --mode vision
```

### All Modes
```bash
python main.py --mode all
```

### Specify User
```bash
python main.py --user my_user_id
```

## Troubleshooting

### Database Connection Failed

If using SQLite, ensure the directory is writable. The database file will be created automatically.

If using PostgreSQL:
- Verify PostgreSQL is running: `pg_isready`
- Check connection string format
- Verify user has permissions on the database

### No Engines Available

If all engines show as offline:
- Check that ANTHROPIC_API_KEY is set correctly
- Verify the API key is valid and has credits
- Check internet connectivity

### Telegram Not Working

If Telegram messages fail:
- Verify bot token is correct
- Verify chat ID is correct
- Ensure you have started a conversation with your bot

### Import Errors

If you see ModuleNotFoundError:
```bash
pip install -r requirements.txt
```

### Permission Denied

If Orion cannot access files:
- Check permissions.yaml allowed_paths
- Ensure paths use correct format (use ~/ for home directory)

## File Structure

```
orion/
├── main.py              # Entry point
├── config.py            # Configuration loader
├── .env                 # Your credentials (never commit)
├── permissions/
│   └── permissions.yaml # Permission configuration
├── data/                # Generated data files
└── logs/                # Log files
```

## Getting Help

- Check logs in the `logs/` directory
- Review `docs/` folder for detailed documentation
- Open an issue on GitHub if you find a bug
