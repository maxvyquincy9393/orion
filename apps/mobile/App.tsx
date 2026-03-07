import React, { useEffect, useRef, useState } from "react"
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  SafeAreaView,
} from "react-native"
import { Audio } from "expo-av"

import Setup from "./screens/Setup"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
}

type Screen = "setup" | "chat"

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function mergeBase64Chunks(chunks: string[]): string {
  return chunks.join("")
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  let result = ""

  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0
    const b = bytes[index + 1] ?? 0
    const c = bytes[index + 2] ?? 0
    const triple = (a << 16) | (b << 8) | c

    result += alphabet[(triple >> 18) & 63]
    result += alphabet[(triple >> 12) & 63]
    result += index + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "="
    result += index + 2 < bytes.length ? alphabet[triple & 63] : "="
  }

  return result
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [connected, setConnected] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [draftAssistant, setDraftAssistant] = useState("")
  const [gatewayUrl, setGatewayUrl] = useState("ws://192.168.1.1:18789/ws")
  const [screen, setScreen] = useState<Screen>("setup")
  const [recording, setRecording] = useState<Audio.Recording | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const ws = useRef<WebSocket | null>(null)
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftAssistantRef = useRef("")
  const voiceRequestIdRef = useRef<string | null>(null)
  const voiceAudioChunksRef = useRef<string[]>([])
  const listRef = useRef<FlatList<Message>>(null)

  useEffect(() => {
    connect()
    return () => {
      ws.current?.close()
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current)
      }
    }
  }, [gatewayUrl])

  useEffect(() => {
    draftAssistantRef.current = draftAssistant
  }, [draftAssistant])

  function connect() {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current)
    }

    const socket = new WebSocket(gatewayUrl)
    ws.current = socket

    socket.onopen = () => setConnected(true)

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data)

      switch (msg.type) {
        case "chunk":
          setThinking(false)
          setDraftAssistant((prev) => prev + (msg.chunk || ""))
          break
        case "final":
          setThinking(false)
          setMessages((prev) => [...prev, {
            id: createId("assistant"),
            role: "assistant",
            content: msg.content || draftAssistantRef.current,
            timestamp: new Date(),
          }])
          setDraftAssistant("")
          break
        case "voice_started":
          setThinking(true)
          voiceAudioChunksRef.current = []
          break
        case "voice_transcript":
          setMessages((prev) => [...prev, {
            id: createId("voice-user"),
            role: "user",
            content: msg.text || "",
            timestamp: new Date(),
          }])
          break
        case "assistant_transcript":
          setMessages((prev) => [...prev, {
            id: createId("voice-assistant"),
            role: "assistant",
            content: msg.text || "",
            timestamp: new Date(),
          }])
          break
        case "voice_audio":
          if (!voiceRequestIdRef.current || msg.requestId === voiceRequestIdRef.current) {
            voiceAudioChunksRef.current.push(msg.data || "")
          }
          break
        case "voice_stopped":
          setThinking(false)
          if (msg.requestId === voiceRequestIdRef.current) {
            void playVoiceResponse()
            voiceRequestIdRef.current = null
            voiceAudioChunksRef.current = []
          }
          break
        case "error":
          setThinking(false)
          setDraftAssistant("")
          setMessages((prev) => [...prev, {
            id: createId("error"),
            role: "assistant",
            content: msg.message || "Gateway error",
            timestamp: new Date(),
          }])
          break
      }
    }

    socket.onclose = () => {
      setConnected(false)
      reconnectTimeout.current = setTimeout(connect, 3000)
    }
  }

  useEffect(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
  }, [messages, draftAssistant])

  async function sendGatewayMessage(payload: Record<string, unknown>) {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      throw new Error("Gateway not connected")
    }
    ws.current.send(JSON.stringify(payload))
  }

  function send() {
    if (!input.trim() || !connected) {
      return
    }

    const content = input.trim()
    setInput("")
    setThinking(true)
    setDraftAssistant("")

    setMessages((prev) => [...prev, {
      id: createId("user"),
      role: "user",
      content,
      timestamp: new Date(),
    }])

    void sendGatewayMessage({
      type: "message",
      content,
      userId: "owner",
      requestId: createId("text"),
    }).catch((error: Error) => {
      setThinking(false)
      setMessages((prev) => [...prev, {
        id: createId("send-error"),
        role: "assistant",
        content: `Send failed: ${error.message}`,
        timestamp: new Date(),
      }])
    })
  }

  async function startVoiceCapture() {
    if (isRecording || !connected) {
      return
    }

    const permission = await Audio.requestPermissionsAsync()
    if (!permission.granted) {
      setMessages((prev) => [...prev, {
        id: createId("mic-denied"),
        role: "assistant",
        content: "Microphone permission is required for voice input.",
        timestamp: new Date(),
      }])
      return
    }

    const requestId = createId("voice")
    voiceRequestIdRef.current = requestId
    voiceAudioChunksRef.current = []

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    })

    const nextRecording = new Audio.Recording()
    await nextRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY)
    await sendGatewayMessage({
      type: "voice_start",
      userId: "owner",
      requestId,
      encoding: "base64",
      mimeType: "audio/mp4",
      channelCount: 1,
    })
    await nextRecording.startAsync()

    setRecording(nextRecording)
    setIsRecording(true)
    setThinking(true)
  }

  async function stopVoiceCapture() {
    if (!recording) {
      return
    }

    try {
      await recording.stopAndUnloadAsync()
      const uri = recording.getURI()
      if (!uri || !voiceRequestIdRef.current) {
        throw new Error("Recording URI unavailable")
      }

      const response = await fetch(uri)
      const arrayBuffer = await response.arrayBuffer()

      await sendGatewayMessage({
        type: "voice_stop",
        userId: "owner",
        requestId: voiceRequestIdRef.current,
        mimeType: "audio/mp4",
        data: arrayBufferToBase64(arrayBuffer),
      })
    } catch (error) {
      setThinking(false)
      setMessages((prev) => [...prev, {
        id: createId("voice-error"),
        role: "assistant",
        content: `Voice capture failed: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      }])
      voiceRequestIdRef.current = null
      voiceAudioChunksRef.current = []
    } finally {
      setRecording(null)
      setIsRecording(false)
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      })
    }
  }

  async function playVoiceResponse() {
    const payload = mergeBase64Chunks(voiceAudioChunksRef.current)
    if (!payload) {
      return
    }

    const { sound } = await Audio.Sound.createAsync(
      { uri: `data:audio/mpeg;base64,${payload}` },
      { shouldPlay: true },
    )

    sound.setOnPlaybackStatusUpdate((status) => {
      if (!status.isLoaded || !status.didJustFinish) {
        return
      }
      void sound.unloadAsync()
    })
  }

  const renderedMessages = draftAssistant
    ? [...messages, {
      id: "draft-assistant",
      role: "assistant" as const,
      content: draftAssistant,
      timestamp: new Date(),
    }]
    : messages

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="light-content" />

      {screen === "setup" ? (
        <Setup
          gatewayUrl={gatewayUrl.replace("ws://", "http://").replace("wss://", "https://").replace(/\/ws$/, "")}
          onComplete={() => setScreen("chat")}
        />
      ) : (
        <>
          <View style={s.header}>
            <Text style={s.headerTitle}>EDITH</Text>
            <View style={s.headerActions}>
              <TouchableOpacity onPress={() => setScreen("setup")}>
                <Text style={s.setupLink}>Setup</Text>
              </TouchableOpacity>
              <View style={[s.dot, { backgroundColor: connected ? "#22c55e" : "#ef4444" }]} />
            </View>
          </View>

          <FlatList
            ref={listRef}
            data={renderedMessages}
            keyExtractor={(item) => item.id}
            style={s.list}
            contentContainerStyle={{ padding: 12 }}
            renderItem={({ item }) => (
              <View style={[s.bubble, item.role === "user" ? s.userBubble : s.aiBubble]}>
                <Text style={[s.bubbleText, item.role === "user" ? s.userText : s.aiText]}>
                  {item.content}
                </Text>
              </View>
            )}
            ListFooterComponent={thinking ? <Text style={s.thinking}>EDITH is listening/thinking...</Text> : null}
          />

          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={s.inputRow}>
              <TextInput
                style={s.input}
                value={input}
                onChangeText={setInput}
                placeholder="Message EDITH..."
                placeholderTextColor="#555"
                multiline
                onSubmitEditing={send}
                returnKeyType="send"
              />
              <TouchableOpacity
                style={[s.voiceBtn, isRecording && s.voiceBtnRecording]}
                onPress={() => {
                  if (isRecording) {
                    void stopVoiceCapture()
                  } else {
                    void startVoiceCapture()
                  }
                }}
              >
                <Text style={s.voiceText}>{isRecording ? "Stop" : "Mic"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.sendBtn} onPress={send}>
                <Text style={s.sendText}>{"->"}</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </>
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "600" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  setupLink: { color: "#888", fontSize: 13 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  list: { flex: 1 },
  bubble: {
    maxWidth: "80%",
    marginVertical: 4,
    padding: 12,
    borderRadius: 16,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: "#1d4ed8",
  },
  aiBubble: {
    alignSelf: "flex-start",
    backgroundColor: "#1a1a1a",
  },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  userText: { color: "#fff" },
  aiText: { color: "#e5e5e5" },
  thinking: {
    color: "#555",
    fontSize: 13,
    paddingLeft: 12,
    paddingVertical: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
    gap: 8,
  },
  input: {
    flex: 1,
    color: "#fff",
    backgroundColor: "#1a1a1a",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 120,
    fontSize: 15,
  },
  voiceBtn: {
    backgroundColor: "#14532d",
    width: 48,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceBtnRecording: {
    backgroundColor: "#991b1b",
  },
  voiceText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  sendBtn: {
    backgroundColor: "#1d4ed8",
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: { color: "#fff", fontSize: 18 },
})
