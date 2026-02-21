# Free Stack Setup (Zero Cost)

Panduan ini menyiapkan Orion agar bisa jalan dengan biaya $0/bulan untuk development.

1. Install Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

2. Pull model local (embeddings + fallback local inference)

```bash
ollama pull nomic-embed-text && ollama pull qwen2.5:7b
```

3. Daftar Groq dan ambil API key gratis

- Buka `https://console.groq.com`
- Login, buat API key baru, lalu simpan key

4. Daftar Google AI Studio dan ambil API key gratis

- Buka `https://aistudio.google.com`
- Generate API key untuk Gemini

5. Update `.env` di folder `orion-ts`

```env
GROQ_API_KEY=your_groq_key
GEMINI_API_KEY=your_gemini_key
OLLAMA_BASE_URL=http://localhost:11434
```

6. Test runtime text mode

```bash
pnpm dev --mode text
```

Lalu coba kirim: `halo orion` dan pastikan respons keluar tanpa error embedding.
