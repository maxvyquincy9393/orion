import React, { useState } from "react"
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native"

interface SetupProps {
  gatewayUrl: string
  onComplete: () => void
}

type Provider = "groq" | "ollama" | "anthropic" | "openai"
type VoiceMode = "push-to-talk" | "always-on"
type VoiceSttEngine = "auto" | "python-whisper" | "deepgram"
type VoiceLanguage = "auto" | "id" | "en" | "multi"
type VoiceWhisperModel = "tiny" | "base" | "small" | "medium" | "large"
type VoiceWakeEngine = "porcupine" | "openwakeword"
type VoiceVadEngine = "cobra" | "silero" | "webrtc"

interface VoiceConfigInput {
  enabled: boolean
  mode: VoiceMode
  sttEngine: VoiceSttEngine
  language: VoiceLanguage
  whisperModel: VoiceWhisperModel
  ttsVoice: string
  wakeEngine: VoiceWakeEngine
  wakeWord: string
  wakeModelPath: string
  vadEngine: VoiceVadEngine
  deepgramApiKey: string
  picovoiceAccessKey: string
}

interface ChoiceOption {
  label: string
  value: string
}

const PROVIDERS: { id: Provider; name: string; desc: string; badge?: string }[] = [
  { id: "groq", name: "Groq", desc: "Free, fast inference with Llama models", badge: "Recommended" },
  { id: "ollama", name: "Ollama", desc: "Local, private, free - runs on your machine" },
  { id: "anthropic", name: "Anthropic", desc: "Claude - best quality reasoning" },
  { id: "openai", name: "OpenAI", desc: "GPT-4 - excellent for code and tasks" },
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

const VOICE_MODE_OPTIONS: ChoiceOption[] = [
  { label: "Push-to-talk", value: "push-to-talk" },
  { label: "Always-on", value: "always-on" },
]

const STT_ENGINE_OPTIONS: ChoiceOption[] = [
  { label: "Auto", value: "auto" },
  { label: "Whisper", value: "python-whisper" },
  { label: "Deepgram", value: "deepgram" },
]

const VOICE_LANGUAGE_OPTIONS: ChoiceOption[] = [
  { label: "Auto", value: "auto" },
  { label: "ID", value: "id" },
  { label: "EN", value: "en" },
  { label: "Multi", value: "multi" },
]

const WHISPER_MODEL_OPTIONS: ChoiceOption[] = [
  { label: "tiny", value: "tiny" },
  { label: "base", value: "base" },
  { label: "small", value: "small" },
  { label: "medium", value: "medium" },
  { label: "large", value: "large" },
]

const WAKE_ENGINE_OPTIONS: ChoiceOption[] = [
  { label: "OpenWakeWord", value: "openwakeword" },
  { label: "Porcupine", value: "porcupine" },
]

const VAD_ENGINE_OPTIONS: ChoiceOption[] = [
  { label: "silero", value: "silero" },
  { label: "cobra", value: "cobra" },
  { label: "webrtc", value: "webrtc" },
]

const DEFAULT_TTS_VOICE = "en-US-GuyNeural"
const DEFAULT_WAKE_WORD = "hey-edith"

function buildVoiceConfig(input: VoiceConfigInput) {
  return {
    enabled: input.enabled,
    mode: input.mode,
    stt: {
      engine: input.sttEngine,
      language: input.language,
      whisperModel: input.whisperModel,
      providers: {
        deepgram: {
          apiKey: input.deepgramApiKey.trim(),
        },
      },
    },
    tts: {
      engine: "edge" as const,
      voice: input.ttsVoice.trim() || DEFAULT_TTS_VOICE,
    },
    wake: {
      engine: input.wakeEngine,
      keyword: input.wakeWord.trim() || DEFAULT_WAKE_WORD,
      modelPath: input.wakeModelPath.trim() || undefined,
      providers: {
        picovoice: {
          accessKey: input.picovoiceAccessKey.trim(),
        },
      },
    },
    vad: {
      engine: input.vadEngine,
    },
  }
}

export default function Setup({ gatewayUrl, onComplete }: SetupProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [provider, setProvider] = useState<Provider | null>(null)
  const [apiKey, setApiKey] = useState("")
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [preparingWakeModel, setPreparingWakeModel] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("push-to-talk")
  const [voiceSttEngine, setVoiceSttEngine] = useState<VoiceSttEngine>("auto")
  const [voiceLanguage, setVoiceLanguage] = useState<VoiceLanguage>("auto")
  const [voiceWhisperModel, setVoiceWhisperModel] = useState<VoiceWhisperModel>("base")
  const [voiceTtsVoice, setVoiceTtsVoice] = useState(DEFAULT_TTS_VOICE)
  const [voiceWakeEngine, setVoiceWakeEngine] = useState<VoiceWakeEngine>("openwakeword")
  const [voiceWakeWord, setVoiceWakeWord] = useState(DEFAULT_WAKE_WORD)
  const [voiceWakeModelPath, setVoiceWakeModelPath] = useState("")
  const [voiceVadEngine, setVoiceVadEngine] = useState<VoiceVadEngine>("silero")
  const [voiceDeepgramApiKey, setVoiceDeepgramApiKey] = useState("")
  const [voicePicovoiceAccessKey, setVoicePicovoiceAccessKey] = useState("")

  const httpBase = gatewayUrl
    .replace("ws://", "http://")
    .replace("wss://", "https://")
    .replace(/\/ws$/, "")

  function getProviderCredentials(): Record<string, string> {
    if (!provider) {
      return {}
    }

    const credentials: Record<string, string> = {}
    const field = KEY_FIELD[provider]

    if (field) {
      credentials[field.envKey] = apiKey
    } else {
      credentials.OLLAMA_HOST = "http://127.0.0.1:11434"
    }

    return credentials
  }

  function getVoiceInput(): VoiceConfigInput {
    return {
      enabled: voiceEnabled,
      mode: voiceMode,
      sttEngine: voiceSttEngine,
      language: voiceLanguage,
      whisperModel: voiceWhisperModel,
      ttsVoice: voiceTtsVoice,
      wakeEngine: voiceWakeEngine,
      wakeWord: voiceWakeWord,
      wakeModelPath: voiceWakeModelPath,
      vadEngine: voiceVadEngine,
      deepgramApiKey: voiceDeepgramApiKey,
      picovoiceAccessKey: voicePicovoiceAccessKey,
    }
  }

  function renderChoiceRow(
    label: string,
    value: string,
    options: ChoiceOption[],
    onSelect: (nextValue: string) => void,
  ) {
    return (
      <View style={s.fieldBlock}>
        <Text style={s.label}>{label}</Text>
        <View style={s.choiceGroup}>
          {options.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[s.choiceChip, value === option.value && s.choiceChipActive]}
              onPress={() => onSelect(option.value)}
            >
              <Text style={[s.choiceChipText, value === option.value && s.choiceChipTextActive]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    )
  }

  function renderTextField(
    label: string,
    value: string,
    onChangeText: (nextValue: string) => void,
    placeholder: string,
    secureTextEntry = false,
  ) {
    return (
      <View style={s.fieldBlock}>
        <Text style={s.label}>{label}</Text>
        <TextInput
          style={s.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#555"
          secureTextEntry={secureTextEntry}
          autoCapitalize="none"
        />
      </View>
    )
  }

  async function prepareWakeModel() {
    setPreparingWakeModel(true)

    try {
      const res = await fetch(`${httpBase}/api/config/prepare-wake-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engine: "openwakeword",
          modelName: "hey_mycroft",
        }),
      })
      const data = await res.json()

      if (!data.ok || !data.prepared?.modelPath) {
        Alert.alert("Wake Model Error", data.error || "Failed to prepare the recommended host model.")
        return
      }

      setVoiceWakeEngine("openwakeword")
      setVoiceWakeWord(data.prepared.keyword || "hey mycroft")
      setVoiceWakeModelPath(data.prepared.modelPath)
      Alert.alert(
        "Wake Model Ready",
        `Prepared ${data.prepared.keyword || "hey mycroft"} on the gateway host.`,
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error"
      Alert.alert("Wake Model Error", msg)
    } finally {
      setPreparingWakeModel(false)
    }
  }

  function renderVoiceSection() {
    return (
      <View style={s.section}>
        <Text style={s.sectionTitle}>Voice Setup</Text>
        <Text style={s.sectionCopy}>
          Voice credentials are stored in the gateway host under top-level voice config, not in env.
          For native always-on wake word, use a gateway-host model path (.ppn / .onnx / .tflite).
        </Text>

        <TouchableOpacity
          style={[s.toggleCard, voiceEnabled && s.toggleCardActive]}
          onPress={() => setVoiceEnabled((value) => !value)}
        >
          <Text style={s.toggleTitle}>{voiceEnabled ? "Voice enabled" : "Voice disabled"}</Text>
          <Text style={s.toggleCopy}>
            {voiceEnabled
              ? "Push-to-talk is ready, and always-on can be enabled for the desktop host."
              : "Voice settings will still be saved, but the runtime stays off until enabled."}
          </Text>
        </TouchableOpacity>

        {renderChoiceRow("Voice Mode", voiceMode, VOICE_MODE_OPTIONS, (value) => setVoiceMode(value as VoiceMode))}
        {renderChoiceRow("STT Engine", voiceSttEngine, STT_ENGINE_OPTIONS, (value) => setVoiceSttEngine(value as VoiceSttEngine))}
        {renderChoiceRow("Language", voiceLanguage, VOICE_LANGUAGE_OPTIONS, (value) => setVoiceLanguage(value as VoiceLanguage))}
        {renderChoiceRow("Whisper Model", voiceWhisperModel, WHISPER_MODEL_OPTIONS, (value) => setVoiceWhisperModel(value as VoiceWhisperModel))}
        {renderChoiceRow("Wake Engine", voiceWakeEngine, WAKE_ENGINE_OPTIONS, (value) => setVoiceWakeEngine(value as VoiceWakeEngine))}
        {renderChoiceRow("VAD Engine", voiceVadEngine, VAD_ENGINE_OPTIONS, (value) => setVoiceVadEngine(value as VoiceVadEngine))}
        {renderTextField("Edge TTS Voice", voiceTtsVoice, setVoiceTtsVoice, DEFAULT_TTS_VOICE)}
        {renderTextField("Wake Word", voiceWakeWord, setVoiceWakeWord, DEFAULT_WAKE_WORD)}
        {voiceWakeEngine === "openwakeword" && (
          <TouchableOpacity style={s.secondaryBtn} onPress={prepareWakeModel} disabled={preparingWakeModel}>
            {preparingWakeModel ? (
              <ActivityIndicator color="#1d4ed8" />
            ) : (
              <Text style={s.secondaryBtnText}>Prepare Recommended Host Model</Text>
            )}
          </TouchableOpacity>
        )}
        {voiceWakeEngine === "openwakeword" && (
          <Text style={s.inlineHint}>
            This prepares the official OpenWakeWord preset on the gateway host and fills the matching keyword/path.
          </Text>
        )}
        {renderTextField("Wake Model Path (optional, on gateway host)", voiceWakeModelPath, setVoiceWakeModelPath, "C:\\models\\hey-edith.onnx")}
        {renderTextField("Deepgram API Key (optional)", voiceDeepgramApiKey, setVoiceDeepgramApiKey, "dg_...", true)}
        {renderTextField("Picovoice Access Key (optional)", voicePicovoiceAccessKey, setVoicePicovoiceAccessKey, "pv_...", true)}
      </View>
    )
  }

  async function testProvider() {
    if (!provider) {
      return
    }

    setTesting(true)
    setTestResult(null)

    try {
      const res = await fetch(`${httpBase}/api/config/test-provider`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, credentials: getProviderCredentials() }),
      })
      const data = await res.json()

      if (!data.ok) {
        setTestResult({ ok: false, msg: data.error || `Failed (status ${data.status})` })
        return
      }

      if (voiceEnabled && voiceDeepgramApiKey.trim()) {
        const deepgramRes = await fetch(`${httpBase}/api/config/test-provider`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "deepgram",
            credentials: { apiKey: voiceDeepgramApiKey.trim() },
          }),
        })
        const deepgramData = await deepgramRes.json()

        if (!deepgramData.ok) {
          setTestResult({
            ok: false,
            msg: deepgramData.error || `Deepgram failed (status ${deepgramData.status})`,
          })
          return
        }
      }

      setTestResult({
        ok: true,
        msg: voiceEnabled && voiceDeepgramApiKey.trim()
          ? "AI provider and Deepgram verified."
          : "Connection successful!",
      })
      setTimeout(() => setStep(3), 800)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error"
      setTestResult({ ok: false, msg })
    } finally {
      setTesting(false)
    }
  }

  async function saveConfig() {
    if (!provider) {
      return
    }

    setSaving(true)

    const edithConfig: Record<string, unknown> = {
      env: {} as Record<string, string>,
      voice: buildVoiceConfig(getVoiceInput()),
      identity: { name: "EDITH", emoji: "✦", theme: "dark minimal" },
      agents: {
        defaults: {
          model: { primary: MODEL_MAP[provider], fallbacks: [] },
          workspace: "./workspace",
        },
      },
    }

    const env = edithConfig.env as Record<string, string>
    const field = KEY_FIELD[provider]
    if (field) {
      env[field.envKey] = apiKey
    } else {
      env.OLLAMA_HOST = "http://127.0.0.1:11434"
    }

    try {
      const res = await fetch(`${httpBase}/api/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edithConfig),
      })
      const data = await res.json()
      if (data.ok) {
        Alert.alert("Setup Complete", "EDITH is configured and ready.", [
          { text: "Start Chatting", onPress: onComplete },
        ])
      } else {
        Alert.alert("Error", data.error || "Failed to save config")
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error"
      Alert.alert("Error", `Could not reach gateway: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  if (step === 1) {
    return (
      <ScrollView style={s.container}>
        <Text style={s.title}>Setup EDITH</Text>
        <Text style={s.desc}>Choose your AI provider.</Text>

        {PROVIDERS.map((entry) => (
          <TouchableOpacity
            key={entry.id}
            style={[s.providerCard, provider === entry.id && s.providerSelected]}
            onPress={() => setProvider(entry.id)}
          >
            <View style={s.providerHeader}>
              <Text style={s.providerName}>{entry.name}</Text>
              {entry.badge && (
                <View style={s.badge}>
                  <Text style={s.badgeText}>{entry.badge}</Text>
                </View>
              )}
            </View>
            <Text style={s.providerDesc}>{entry.desc}</Text>
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

  if (step === 2) {
    const field = provider ? KEY_FIELD[provider] : null
    const providerName = provider ? PROVIDERS.find((entry) => entry.id === provider)?.name ?? "Provider" : "Provider"

    return (
      <ScrollView style={s.container}>
        <Text style={s.title}>{provider === "ollama" ? "Ollama Setup" : `${providerName} API Key`}</Text>
        <Text style={s.desc}>
          Configure the main chat provider, then optionally save gateway-hosted voice settings.
        </Text>

        {field ? (
          renderTextField(field.label, apiKey, setApiKey, field.placeholder, true)
        ) : (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Ollama</Text>
            <Text style={s.sectionCopy}>
              Make sure Ollama is installed and running on the same machine as the gateway host.
            </Text>
          </View>
        )}

        {renderVoiceSection()}

        <TouchableOpacity
          style={s.btn}
          onPress={testProvider}
          disabled={testing || (!!field && apiKey.trim().length < 5)}
        >
          {testing ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Test Connection</Text>}
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

  return (
    <ScrollView style={s.container}>
      <Text style={s.title}>All Set!</Text>
      <Text style={s.desc}>
        EDITH is ready. Save the config to the gateway host and start chatting.
      </Text>

      <TouchableOpacity style={s.btn} onPress={saveConfig} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Save & Start Chatting</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={s.backBtn} onPress={() => setStep(2)}>
        <Text style={s.backBtnText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    padding: 20,
  },
  title: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
    marginTop: 40,
  },
  desc: {
    color: "#888",
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 24,
  },
  section: {
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#1f1f1f",
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 6,
  },
  sectionCopy: {
    color: "#777",
    fontSize: 13,
    lineHeight: 20,
  },
  fieldBlock: {
    marginBottom: 18,
  },
  label: {
    color: "#aaa",
    fontSize: 13,
    marginBottom: 6,
  },
  input: {
    backgroundColor: "#1a1a1a",
    color: "#fff",
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    borderWidth: 2,
    borderColor: "#222",
  },
  toggleCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#222",
    backgroundColor: "#151515",
    padding: 14,
    marginBottom: 18,
  },
  toggleCardActive: {
    borderColor: "#1d4ed8",
    backgroundColor: "#151d32",
  },
  toggleTitle: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  toggleCopy: {
    color: "#7b7b7b",
    fontSize: 12,
    lineHeight: 18,
  },
  choiceGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -4,
  },
  choiceChip: {
    borderWidth: 1,
    borderColor: "#2a2a2a",
    backgroundColor: "#151515",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 4,
    marginBottom: 8,
  },
  choiceChipActive: {
    borderColor: "#1d4ed8",
    backgroundColor: "#1a1a2e",
  },
  choiceChipText: {
    color: "#8f8f8f",
    fontSize: 12,
    fontWeight: "600",
  },
  choiceChipTextActive: {
    color: "#fff",
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: "#1d4ed8",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    marginBottom: 10,
    backgroundColor: "#10192d",
  },
  secondaryBtnText: {
    color: "#8fb3ff",
    fontWeight: "600",
    fontSize: 13,
  },
  inlineHint: {
    color: "#6f7e9c",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  providerCard: {
    padding: 16,
    backgroundColor: "#141414",
    borderWidth: 2,
    borderColor: "#222",
    borderRadius: 12,
    marginBottom: 12,
  },
  providerSelected: {
    borderColor: "#1d4ed8",
    backgroundColor: "#1a1a2e",
  },
  providerHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  providerName: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
  providerDesc: {
    color: "#666",
    fontSize: 12,
  },
  badge: {
    backgroundColor: "#22c55e",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  badgeText: {
    color: "#000",
    fontSize: 10,
    fontWeight: "600",
  },
  btn: {
    backgroundColor: "#1d4ed8",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
    marginTop: 12,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
  backBtn: {
    backgroundColor: "#222",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
    marginTop: 12,
    marginBottom: 30,
  },
  backBtnText: {
    color: "#888",
    fontWeight: "600",
    fontSize: 15,
  },
  result: {
    textAlign: "center",
    marginTop: 12,
    fontSize: 14,
  },
})
