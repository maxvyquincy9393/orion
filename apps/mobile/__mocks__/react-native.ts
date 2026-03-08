/**
 * @file react-native.ts
 * @description Minimal React Native shim for Vitest.
 * Avoids Rollup's inability to parse Flow's `import typeof` syntax in the real package.
 */

export const Platform = {
  OS: "ios" as "ios" | "android",
  select: <T>(obj: { ios?: T; android?: T; default?: T }): T | undefined =>
    obj.ios ?? obj.default,
}

export const Alert = {
  alert: (_title: string, _msg?: string) => {},
}

export const AppState = {
  addEventListener: (_event: string, _handler: (state: string) => void) => ({
    remove: () => {},
  }),
  currentState: "active" as string,
}

export const Linking = {
  addEventListener: (_event: string, _handler: (e: { url: string }) => void) => ({
    remove: () => {},
  }),
  getInitialURL: async (): Promise<string | null> => null,
}

export const StyleSheet = {
  create: <T extends Record<string, object>>(styles: T): T => styles,
  flatten: (style: unknown) => style,
}

export const View = "View"
export const Text = "Text"
export const TextInput = "TextInput"
export const TouchableOpacity = "TouchableOpacity"
export const ScrollView = "ScrollView"
export const FlatList = "FlatList"
export const ActivityIndicator = "ActivityIndicator"
export const Modal = "Modal"
export const SafeAreaView = "SafeAreaView"
export const KeyboardAvoidingView = "KeyboardAvoidingView"
export const Image = "Image"
export const Pressable = "Pressable"
export const StatusBar = {
  setBarStyle: () => {},
  currentHeight: 0,
}
export const Dimensions = {
  get: () => ({ width: 390, height: 844 }),
}
export const Keyboard = {
  dismiss: () => {},
  addListener: () => ({ remove: () => {} }),
}
