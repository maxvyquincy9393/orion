/**
 * @file screens/Settings.tsx
 * @description Gateway settings screen — configure URL and user ID, persist to
 *   AsyncStorage, and navigate back to the Chat screen.
 */

import React, { useEffect, useState } from "react"
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import AsyncStorage from "@react-native-async-storage/async-storage"
import type { StackNavigationProp } from "@react-navigation/stack"
import { useNavigation } from "@react-navigation/native"
import type { RootStackParamList } from "../App"

const STORAGE_URL_KEY = "edith_gateway_url"
const STORAGE_UID_KEY = "edith_user_id"
const DEFAULT_URL = "ws://192.168.1.1:18789/ws"
const DEFAULT_UID = "owner"

export default function Settings() {
  const nav = useNavigation<StackNavigationProp<RootStackParamList, "Settings">>()
  const [url, setUrl] = useState(DEFAULT_URL)
  const [userId, setUserId] = useState(DEFAULT_UID)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState("")

  // ── Load persisted settings ─────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      const [savedUrl, savedUid] = await Promise.all([
        AsyncStorage.getItem(STORAGE_URL_KEY),
        AsyncStorage.getItem(STORAGE_UID_KEY),
      ])
      if (savedUrl) setUrl(savedUrl)
      if (savedUid) setUserId(savedUid)
    })()
  }, [])

  async function testConnection() {
    setTesting(true)
    setTestResult("")
    try {
      const ws = new WebSocket(url)
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => { resolve(); ws.close() }
        ws.onerror = reject
        setTimeout(reject, 5000)
      })
      setTestResult("Connected")
    } catch {
      setTestResult("Failed — check URL and gateway")
    }
    setTesting(false)
  }

  async function save() {
    await Promise.all([
      AsyncStorage.setItem(STORAGE_URL_KEY, url),
      AsyncStorage.setItem(STORAGE_UID_KEY, userId),
    ])
    Alert.alert("Saved", "Gateway settings saved. Reconnecting...", [
      { text: "OK", onPress: () => nav.goBack() },
    ])
  }

  return (
    <ScrollView style={s.container}>
      <Text style={s.title}>Settings</Text>

      <Text style={s.label}>Gateway URL</Text>
      <TextInput
        style={s.input}
        value={url}
        onChangeText={setUrl}
        placeholder="ws://192.168.1.1:18789/ws"
        placeholderTextColor="#555"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={s.hint}>
        Your EDITH gateway address. Run ipconfig (Windows) or ifconfig (Mac/Linux) to find your IP.
      </Text>

      <Text style={s.label}>User ID</Text>
      <TextInput
        style={s.input}
        value={userId}
        onChangeText={setUserId}
        placeholder="owner"
        placeholderTextColor="#555"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <TouchableOpacity style={s.testBtn} onPress={testConnection} disabled={testing}>
        <Text style={s.btnText}>{testing ? "Testing..." : "Test Connection"}</Text>
      </TouchableOpacity>

      {testResult ? (
        <Text style={[s.result, { color: testResult === "Connected" ? "#22c55e" : "#ef4444" }]}>
          {testResult}
        </Text>
      ) : null}

      <View style={s.spacer} />

      <TouchableOpacity style={s.saveBtn} onPress={save}>
        <Text style={s.btnText}>Save & Go Back</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", padding: 20 },
  title: { color: "#fff", fontSize: 22, 
    fontWeight: "bold", marginBottom: 24 },
  label: { color: "#aaa", fontSize: 13, marginBottom: 6 },
  input: { 
    backgroundColor: "#1a1a1a", color: "#fff",
    borderRadius: 10, padding: 12, 
    fontSize: 15, marginBottom: 8 
  },
  hint: { color: "#555", fontSize: 12, marginBottom: 20 },
  testBtn: { 
    backgroundColor: "#1a1a1a", borderRadius: 10,
    padding: 14, alignItems: "center", marginBottom: 12 
  },
  saveBtn: { 
    backgroundColor: "#1d4ed8", borderRadius: 10,
    padding: 14, alignItems: "center", marginTop: 8 
  },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  result: { textAlign: "center", marginBottom: 12, fontSize: 14 },
  spacer: { height: 16 },
})
