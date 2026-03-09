/**
 * @file screens/Chat.tsx
 * @description Main chat screen — WebSocket connection to EDITH gateway with
 *   offline queue, push notifications, background sync, and deep link handling.
 *   Gateway URL and userId are persisted in AsyncStorage and configured via
 *   the Settings screen.
 */

import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import AsyncStorage from "@react-native-async-storage/async-storage"
import type { StackNavigationProp } from "@react-navigation/stack"
import { useNavigation } from "@react-navigation/native"
import * as Linking from "expo-linking"
import NetInfo from "@react-native-community/netinfo"
import { registerForPushNotifications, setupNotificationListeners } from "../services/PushHandler"
import { routeNotification } from "../services/NotificationRouter"
import { registerBackgroundSync, syncNow } from "../services/BackgroundSyncTask"
import { offlineQueue } from "../services/OfflineQueue"
import { parseDeepLink } from "../services/DeepLinkRouter"
import type { RootStackParamList } from "../App"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  /** true while queued offline and not yet delivered */
  pending?: boolean
}

const STORAGE_URL_KEY = "edith_gateway_url"
const STORAGE_UID_KEY = "edith_user_id"
const DEFAULT_URL = "ws://192.168.1.1:18789/ws"
const DEFAULT_UID = "owner"

export default function Chat() {
  const nav = useNavigation<StackNavigationProp<RootStackParamList, "Chat">>()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [connected, setConnected] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const [gatewayUrl, setGatewayUrl] = useState(DEFAULT_URL)
  const [userId, setUserId] = useState(DEFAULT_UID)
  const ws = useRef<WebSocket | null>(null)
  const listRef = useRef<FlatList>(null)

  // ── Load persisted settings ───────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      const [url, uid] = await Promise.all([
        AsyncStorage.getItem(STORAGE_URL_KEY),
        AsyncStorage.getItem(STORAGE_UID_KEY),
      ])
      if (url) setGatewayUrl(url)
      if (uid) setUserId(uid)
    })()
  }, [])

  // ── Settings header button ────────────────────────────────────────────────
  useEffect(() => {
    nav.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => nav.navigate("Settings")}
          style={{ marginRight: 16 }}
        >
          <Text style={{ color: "#888", fontSize: 20 }}>⚙</Text>
        </TouchableOpacity>
      ),
    })
  }, [nav])

  // ── Lifecycle listeners ───────────────────────────────────────────────────
  useEffect(() => {
    const unsubNet = NetInfo.addEventListener((state) => {
      setIsOnline(state.isConnected ?? false)
    })
    void registerForPushNotifications()
    const cleanupNotif = setupNotificationListeners((response) => {
      const action = routeNotification(response)
      if (action.autoMessage) setInput(action.autoMessage)
    })
    void registerBackgroundSync()
    const deepLinkSub = Linking.addEventListener("url", ({ url }) => {
      const action = parseDeepLink(url)
      if (action?.autoMessage) setInput(action.autoMessage)
    })
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void syncNow()
    })
    return () => {
      unsubNet()
      cleanupNotif()
      deepLinkSub.remove()
      appStateSub.remove()
    }
  }, [])

  // ── WebSocket connection ──────────────────────────────────────────────────
  useEffect(() => {
    connect()
    return () => ws.current?.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatewayUrl])

  function connect() {
    ws.current = new WebSocket(gatewayUrl)
    ws.current.onopen = async () => {
      setConnected(true)
      const flushed = await offlineQueue.flush(
        (msg) => ws.current?.send(msg),
        userId,
      )
      if (flushed > 0) console.log(`[Chat] Flushed ${flushed} queued messages`)
    }
    ws.current.onmessage = (e: MessageEvent) => {
      const msg = JSON.parse(e.data as string) as { type: string; content?: string }
      if (msg.type === "response" && msg.content) {
        setThinking(false)
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: "assistant", content: msg.content ?? "", timestamp: new Date() },
        ])
      }
    }
    ws.current.onclose = () => {
      setConnected(false)
      setTimeout(connect, 3000)
    }
    ws.current.onerror = () => { setConnected(false) }
  }

  // ── Send message ──────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    if (!input.trim()) return
    const content = input.trim()
    setInput("")
    const userMsg: Message = { id: Date.now().toString(), role: "user", content, timestamp: new Date() }
    setMessages((prev) => [...prev, userMsg])
    setTimeout(() => listRef.current?.scrollToEnd(), 100)

    if (connected && ws.current?.readyState === WebSocket.OPEN) {
      setThinking(true)
      ws.current.send(JSON.stringify({ type: "message", content, userId }))
    } else {
      await offlineQueue.enqueue({ content, timestamp: new Date().toISOString(), userId })
      setMessages((prev) => prev.map((m) => m.id === userMsg.id ? { ...m, pending: true } : m))
    }
  }, [input, connected, userId])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="light-content" />

      <View style={s.statusBar}>
        {!isOnline && <Text style={s.offlineTag}>OFFLINE</Text>}
        <View style={[s.dot, { backgroundColor: connected ? "#22c55e" : "#ef4444" }]} />
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        style={s.list}
        contentContainerStyle={{ padding: 12 }}
        renderItem={({ item }) => (
          <View style={[s.bubble, item.role === "user" ? s.userBubble : s.aiBubble]}>
            <Text style={[s.bubbleText, item.role === "user" ? s.userText : s.aiText]}>
              {item.content}
            </Text>
            {item.pending === true && (
              <Text style={s.pendingTag}>⏳ queued — will send when online</Text>
            )}
          </View>
        )}
        ListFooterComponent={thinking ? <Text style={s.thinking}>EDITH is thinking...</Text> : null}
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
          <TouchableOpacity style={s.sendBtn} onPress={send}>
            <Text style={s.sendText}>→</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  statusBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 8,
  },
  offlineTag: { color: "#f59e0b", fontSize: 11, fontWeight: "600" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  list: { flex: 1 },
  bubble: { maxWidth: "80%", marginVertical: 4, padding: 12, borderRadius: 16 },
  userBubble: { alignSelf: "flex-end", backgroundColor: "#1d4ed8" },
  aiBubble: { alignSelf: "flex-start", backgroundColor: "#1a1a1a" },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  userText: { color: "#fff" },
  aiText: { color: "#e5e5e5" },
  pendingTag: { color: "#f59e0b", fontSize: 11, marginTop: 4 },
  thinking: { color: "#555", fontSize: 13, paddingLeft: 12, paddingVertical: 8 },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
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
  sendBtn: {
    marginLeft: 8,
    backgroundColor: "#1d4ed8",
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: { color: "#fff", fontSize: 18 },
})
