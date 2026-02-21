# OAuth Setup Guide — Orion

> How to authenticate with each LLM provider.

---

## OpenAI (OAuth2)

1. Register an OAuth2 application at OpenAI Developer Portal
2. Set redirect URI to `http://localhost:8080/callback/openai`
3. Add credentials to `.env`:
   ```
   OPENAI_CLIENT_ID=your_client_id
   OPENAI_CLIENT_SECRET=your_client_secret
   ```
4. Run the auth flow: `python auth/openai_oauth.py`
5. Tokens are stored automatically by `auth/token_manager.py`

## Google Gemini (OAuth2)

1. Create a project in Google Cloud Console
2. Enable the Generative Language API
3. Create OAuth2 credentials with redirect URI `http://localhost:8080/callback/google`
4. Add credentials to `.env`:
   ```
   GOOGLE_CLIENT_ID=your_client_id
   GOOGLE_CLIENT_SECRET=your_client_secret
   ```
5. Run the auth flow: `python auth/google_oauth.py`
6. Tokens are auto-refreshed via the google-auth library

## Anthropic Claude (API Key)

1. Get an API key from the Anthropic Console
2. Add to `.env`:
   ```
   ANTHROPIC_API_KEY=your_api_key
   ```

## Ollama (Local)

1. Install Ollama: https://ollama.com
2. Pull a model: `ollama pull llama3`
3. Ollama runs on `http://localhost:11434` by default — no auth needed

---

*Update this document when auth flows change.*
