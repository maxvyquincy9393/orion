import React, { useState } from "react"
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator,
  Alert
} from "react-native"

interface SetupProps {
  gatewayUrl: string
  onComplete: () => void
}

type Provider = "groq" | "ollama" | "anthropic" | "openai"

const PROVIDERS: { id: Provider; name: string; desc: string; badge?: string }[] = [
  { id: "groq", name: "Groq", desc: "Free, fast inference with Llama models", badge: "Recommended" },
  { id: "ollama", name: "Ollama", desc: "Local, private, free — runs on your machine" },
  { id: "anthropic", name: "Anthropic", desc: "Claude — best quality reasoning" },
  { id: "openai", name: "OpenAI", desc: "GPT-4 — excellent for code and tasks" },
]

const MODEL_MAP: Record<Provider, string> = {
  groq: "groq/llama-3.3-70b-versatile",
  ollama: "ollama/llama3.2",
  anthropic: "anthropic/claude-sonnet-4-20250514",
  openai: "openai/gpt-4o",
}

const KEY_FIELD: Record<Provider, { label: string; placeholder: string; envKey: string } | null> = {
  groq: { label: "GROQ_API_KEY", placeholder: "gsk_...", envKey: "GROQ_API_KEY" },
  ollama: null,
  anthropic: { label: "ANTHROPIC_API_KEY", placeholder: "sk-ant-...", envKey: "ANTHROPIC_API_KEY" },
  openai: { label: "OPENAI_API_KEY", placeholder: "sk-...", envKey: "OPENAI_API_KEY" },
}

export default function Setup({ gatewayUrl, onComplete }: SetupProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [provider, setProvider] = useState<Provider | null>(null)
  const [apiKey, setApiKey] = useState("")
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const httpBase = gatewayUrl
    .replace("ws://", "http://")
    .replace("wss://", "https://")
    .replace(/\/ws$/, "")

  async function testProvider() {
    if (!provider) return
    setTesting(true)
    setTestResult(null)

    const credentials: Record<string, string> = {}
    const field = KEY_FIELD[provider]
    if (field) {
      credentials[field.envKey] = apiKey
    } else if (provider === "ollama") {
      credentials.OLLAMA_HOST = "http://127.0.0.1:11434"
    }

    try {
      const res = await fetch(`${httpBase}/api/config/test-provider`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, credentials }),
      })
      const data = await res.json()
      if (data.ok) {
        setTestResult({ ok: true, msg: "Connection successful!" })
        setTimeout(() => setStep(3), 800)
      } else {
        setTestResult({ ok: false, msg: data.error || `Failed (status ${data.status})` })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error"
      setTestResult({ ok: false, msg })
    }
    setTesting(false)
  }

  async function saveConfig() {
    if (!provider) return
    setSaving(true)

    const novaConfig: Record<string, unknown> = {
      env: {} as Record<string, string>,
      identity: { name: "Nova", emoji: "✦", theme: "dark minimal" },
      agents: {
        defaults: {
          model: { primary: MODEL_MAP[provider], fallbacks: [] },
          workspace: "./workspace",
        },
      },
    }

    const env = novaConfig.env as Record<string, string>
    const field = KEY_FIELD[provider]
    if (field) {
      env[field.envKey] = apiKey
    } else if (provider === "ollama") {
      env.OLLAMA_HOST = "http://127.0.0.1:11434"
    }

    try {
      const res = await fetch(`${httpBase}/api/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(novaConfig),
      })
      const data = await res.json()
      if (data.ok) {
        Alert.alert("Setup Complete", "Nova is configured and ready!", [
          { text: "Start Chatting", onPress: onComplete },
        ])
      } else {
        Alert.alert("Error", data.error || "Failed to save config")
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error"
      Alert.alert("Error", `Could not reach gateway: ${msg}`)
    }
    setSaving(false)
  }

  // ── Step 1: Choose Provider ────────────────────────────────────────
  if (step === 1) {
    return (
      <ScrollView style={s.container}>
        <Text style={s.title}>Setup Nova</Text>
        <Text style={s.desc}>Choose your AI provider</Text>

        {PROVIDERS.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={[s.providerCard, provider === p.id && s.providerSelected]}
            onPress={() => setProvider(p.id)}
          >
            <View style={s.providerHeader}>
              <Text style={s.providerName}>{p.name}</Text>
              {p.badge && (
                <View style={s.badge}>
                  <Text style={s.badgeText}>{p.badge}</Text>
                </View>
              )}
            </View>
            <Text style={s.providerDesc}>{p.desc}</Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={[s.btn, !provider && s.btnDisabled]}
          onPress={() => provider && setStep(2)}
          disabled={!provider}
        >
          <Text style={s.btnText}>Continue</Text>
        </TouchableOpacity>
      </ScrollView>
    )
  }

  // ── Step 2: Credentials ────────────────────────────────────────────
  if (step === 2) {
    const field = provider ? KEY_FIELD[provider] : null
    return (
      <ScrollView style={s.container}>
        <Text style={s.title}>
          {provider === "ollama" ? "Ollama Setup" : `${provider?.charAt(0).toUpperCase()}${provider?.slice(1)} API Key`}
        </Text>

        {field ? (
          <>
            <Text style={s.label}>{field.label}</Text>
            <TextInput
              style={s.input}
              value={apiKey}
              onChangeText={setApiKey}
              placeholder={field.placeholder}
              placeholderTextColor="#555"
              secureTextEntry
              autoCapitalize="none"
            />
          </>
        ) : (
          <Text style={s.desc}>
            Make sure Ollama is installed and running on the same machine as the gateway.
          </Text>
        )}

        <TouchableOpacity
          style={s.btn}
          onPress={testProvider}
          disabled={testing || (!!field && apiKey.length < 5)}
        >
          {testing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.btnText}>Test Connection</Text>
          )}
        </TouchableOpacity>

        {testResult && (
          <Text style={[s.result, { color: testResult.ok ? "#22c55e" : "#ef4444" }]}>
            {testResult.msg}
          </Text>
        )}

        <TouchableOpacity style={s.backBtn} onPress={() => setStep(1)}>
          <Text style={s.backBtnText}>Back</Text>
        </TouchableOpacity>
      </ScrollView>
    )
  }

  // ── Step 3: Save ───────────────────────────────────────────────────
  return (
    <ScrollView style={s.container}>
      <Text style={s.title}>All Set!</Text>
      <Text style={s.desc}>
        Nova is ready. Tap below to save your config and start chatting.
      </Text>

      <TouchableOpacity style={s.btn} onPress={saveConfig} disabled={saving}>
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={s.btnText}>Save & Start Chatting</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={s.backBtn} onPress={() => setStep(2)}>
        <Text style={s.backBtnText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", padding: 20 },
  title: {
    color: "#fff", fontSize: 24, fontWeight: "bold",
    marginBottom: 8, marginTop: 40,
  },
  desc: {
    color: "#888", fontSize: 14, lineHeight: 22,
    marginBottom: 24,
  },
  label: { color: "#aaa", fontSize: 13, marginBottom: 6 },
  input: {
    backgroundColor: "#1a1a1a", color: "#fff",
    borderRadius: 10, padding: 14,
    fontSize: 15, marginBottom: 20,
    borderWidth: 2, borderColor: "#222",
  },
  providerCard: {
    padding: 16, backgroundColor: "#141414",
    borderWidth: 2, borderColor: "#222",
    borderRadius: 12, marginBottom: 12,
  },
  providerSelected: {
    borderColor: "#1d4ed8", backgroundColor: "#1a1a2e",
  },
  providerHeader: {
    flexDirection: "row", alignItems: "center",
    marginBottom: 4,
  },
  providerName: { color: "#fff", fontWeight: "600", fontSize: 15 },
  providerDesc: { color: "#666", fontSize: 12 },
  badge: {
    backgroundColor: "#22c55e", borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 2, marginLeft: 8,
  },
  badgeText: { color: "#000", fontSize: 10, fontWeight: "600" },
  btn: {
    backgroundColor: "#1d4ed8", borderRadius: 10,
    padding: 14, alignItems: "center", marginTop: 12,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  backBtn: {
    backgroundColor: "#222", borderRadius: 10,
    padding: 14, alignItems: "center", marginTop: 12,
  },
  backBtnText: { color: "#888", fontWeight: "600", fontSize: 15 },
  result: {
    textAlign: "center", marginTop: 12, fontSize: 14,
  },
})
