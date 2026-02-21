# Orion Mobile

React Native app that connects to Orion gateway.

## Architecture

Same as desktop - connects to gateway WebSocket.
Gateway runs on local machine or remote server.
Mobile app is a thin client - no AI logic on device.

## Stack

- React Native 0.74+
- Expo (for easier cross-platform)
- expo-av (voice)
- React Native WebSocket (built-in)

## Setup (when ready to implement)

```bash
npx create-expo-app@latest orion-mobile
cd orion-mobile
npx expo install expo-av expo-notifications
```

## Connection

```javascript
const ws = new WebSocket("ws://YOUR_IP:18789/ws")

// Same message protocol as desktop
ws.onopen = () => {
  ws.send(JSON.stringify({ type: "message", content: "Hello", userId: "owner" }))
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.type === "response") {
    console.log("Response:", msg.content)
  }
}
```

## Message Protocol

| Type | Direction | Fields |
|------|-----------|--------|
| message | Client -> Server | type, content, userId |
| response | Server -> Client | type, content |
| status | Client -> Server | type |
| status | Server -> Client | type, engines, channels, daemon |

## Screens planned

- Chat (main)
- Voice mode
- Settings / onboarding

## Status

Foundation README only. Full implementation in Phase 4.
