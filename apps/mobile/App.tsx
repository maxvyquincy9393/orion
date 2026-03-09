/**
 * @file App.tsx
 * @description EDITH Mobile — navigation shell (Phase 16).
 *
 * ARCHITECTURE:
 *   NavigationContainer + Stack navigator with two screens:
 *   - Chat  (main screen — WebSocket + offline queue)
 *   - Settings (gateway URL + user ID, persisted in AsyncStorage)
 *
 *   Background services are registered in global scope so they are ready
 *   before any component mounts (required by expo-task-manager).
 */

// GLOBAL SCOPE: task definition must run before any component mounts
import "./services/BackgroundSyncTask"

import "react-native-gesture-handler"
import React from "react"
import { NavigationContainer } from "@react-navigation/native"
import { createStackNavigator } from "@react-navigation/stack"
import ChatScreen from "./screens/Chat"
import SettingsScreen from "./screens/Settings"

export type RootStackParamList = {
  Chat: undefined
  Settings: undefined
}

const Stack = createStackNavigator<RootStackParamList>()

const NAV_THEME = {
  dark: true,
  colors: {
    primary: "#1d4ed8",
    background: "#0a0a0a",
    card: "#111111",
    text: "#ffffff",
    border: "#1a1a1a",
    notification: "#ef4444",
  },
}

export default function App() {
  return (
    <NavigationContainer theme={NAV_THEME}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: "#111111" },
          headerTintColor: "#ffffff",
          headerTitleStyle: { fontWeight: "600" },
          cardStyle: { backgroundColor: "#0a0a0a" },
        }}
      >
        <Stack.Screen
          name="Chat"
          component={ChatScreen}
          options={{ title: "EDITH" }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: "Settings" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  )
}

