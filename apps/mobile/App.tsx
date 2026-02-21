import React, { useEffect, useRef, useState } from "react"
import { 
  View, Text, TextInput, FlatList, 
  TouchableOpacity, StyleSheet, 
  KeyboardAvoidingView, Platform,
  StatusBar, SafeAreaView
} from "react-native"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [connected, setConnected] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [gatewayUrl, setGatewayUrl] = useState("ws://192.168.1.1:18789/ws")
  const ws = useRef<WebSocket | null>(null)
  const listRef = useRef<FlatList>(null)

  useEffect(() => {
    connect()
    return () => ws.current?.close()
  }, [gatewayUrl])

  function connect() {
    ws.current = new WebSocket(gatewayUrl)

    ws.current.onopen = () => setConnected(true)

    ws.current.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === "response") {
        setThinking(false)
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: "assistant",
          content: msg.content,
          timestamp: new Date()
        }])
      }
    }

    ws.current.onclose = () => {
      setConnected(false)
      setTimeout(connect, 3000)
    }
  }

  function send() {
    if (!input.trim() || !connected) return
    const content = input.trim()
    setInput("")
    setThinking(true)

    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: "user",
      content,
      timestamp: new Date()
    }])

    ws.current?.send(JSON.stringify({
      type: "message",
      content,
      userId: "owner"
    }))

    setTimeout(() => listRef.current?.scrollToEnd(), 100)
  }

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="light-content" />
      
      <View style={s.header}>
        <Text style={s.headerTitle}>Orion</Text>
        <View style={[s.dot, 
          { backgroundColor: connected ? "#22c55e" : "#ef4444" }
        ]} />
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={m => m.id}
        style={s.list}
        contentContainerStyle={{ padding: 12 }}
        renderItem={({ item }) => (
          <View style={[s.bubble, 
            item.role === "user" ? s.userBubble : s.aiBubble
          ]}>
            <Text style={[s.bubbleText,
              item.role === "user" ? s.userText : s.aiText
            ]}>
              {item.content}
            </Text>
          </View>
        )}
        ListFooterComponent={thinking ? (
          <Text style={s.thinking}>Orion is thinking...</Text>
        ) : null}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={input}
            onChangeText={setInput}
            placeholder="Message Orion..."
            placeholderTextColor="#555"
            multiline
            onSubmitEditing={send}
            returnKeyType="send"
          />
          <TouchableOpacity style={s.sendBtn} onPress={send}>
            <Text style={s.sendText}>{"->"}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  header: { 
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between",
    padding: 16, borderBottomWidth: 1, 
    borderBottomColor: "#1a1a1a" 
  },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "600" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  list: { flex: 1 },
  bubble: { 
    maxWidth: "80%", marginVertical: 4, 
    padding: 12, borderRadius: 16 
  },
  userBubble: { 
    alignSelf: "flex-end", backgroundColor: "#1d4ed8" 
  },
  aiBubble: { 
    alignSelf: "flex-start", backgroundColor: "#1a1a1a" 
  },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  userText: { color: "#fff" },
  aiText: { color: "#e5e5e5" },
  thinking: { color: "#555", fontSize: 13, 
    paddingLeft: 12, paddingVertical: 8 },
  inputRow: { 
    flexDirection: "row", alignItems: "flex-end",
    padding: 12, borderTopWidth: 1, 
    borderTopColor: "#1a1a1a" 
  },
  input: { 
    flex: 1, color: "#fff", backgroundColor: "#1a1a1a",
    borderRadius: 20, paddingHorizontal: 16, 
    paddingVertical: 10, maxHeight: 120, fontSize: 15
  },
  sendBtn: { 
    marginLeft: 8, backgroundColor: "#1d4ed8",
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center"
  },
  sendText: { color: "#fff", fontSize: 18 }
})
