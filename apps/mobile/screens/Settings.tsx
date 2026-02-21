import React, { useState } from "react"
import { 
  View, Text, TextInput, TouchableOpacity, 
  StyleSheet, Alert, ScrollView 
} from "react-native"

export default function Settings({ 
  onSave 
}: { onSave: (url: string) => void }) {
  const [url, setUrl] = useState("ws://192.168.1.1:18789/ws")
  const [userId, setUserId] = useState("owner")
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState("")

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
      />
      <Text style={s.hint}>
        Your Orion gateway IP. Run ipconfig (Windows) or 
        ifconfig (Mac/Linux) to find it.
      </Text>

      <Text style={s.label}>User ID</Text>
      <TextInput
        style={s.input}
        value={userId}
        onChangeText={setUserId}
        placeholder="owner"
        placeholderTextColor="#555"
      />

      <TouchableOpacity 
        style={s.testBtn} 
        onPress={testConnection}
        disabled={testing}
      >
        <Text style={s.btnText}>
          {testing ? "Testing..." : "Test Connection"}
        </Text>
      </TouchableOpacity>

      {testResult ? (
        <Text style={[s.result, {
          color: testResult === "Connected" ? "#22c55e" : "#ef4444"
        }]}>
          {testResult}
        </Text>
      ) : null}

      <TouchableOpacity 
        style={s.saveBtn}
        onPress={() => onSave(url)}
      >
        <Text style={s.btnText}>Save</Text>
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
  result: { textAlign: "center", marginBottom: 12, fontSize: 14 }
})
