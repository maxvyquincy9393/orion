/**
 * @file PushHandler.test.ts
 * @description Unit tests for PushHandler (push token registration) and
 * NotificationRouter (notification → screen routing).
 *
 * ARCHITECTURE:
 *   Mocks Expo SDK modules to control device/permission state without a
 *   real device.  `global.fetch` is mocked for gateway registration calls.
 *   `vi.doMock` + isolated module imports are used for the non-device test
 *   to override per-test the `expo-device` `isDevice` flag.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Module-level mocks (hoisted) ──────────────────────────────────────────────

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Alert: { alert: vi.fn() },
}))

vi.mock("expo-device", () => ({ isDevice: true }))

vi.mock("expo-notifications", () => ({
  setNotificationHandler: vi.fn(),
  getPermissionsAsync: vi.fn().mockResolvedValue({ status: "granted" }),
  requestPermissionsAsync: vi.fn().mockResolvedValue({ status: "granted" }),
  getExpoPushTokenAsync: vi
    .fn()
    .mockResolvedValue({ data: "ExponentPushToken[test-token-123]" }),
  setNotificationChannelAsync: vi.fn().mockResolvedValue(null),
  addNotificationReceivedListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
  addNotificationResponseReceivedListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
  AndroidImportance: { HIGH: 4, DEFAULT: 3, MAX: 5, LOW: 2, MIN: 1 },
}))

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn().mockResolvedValue("test-auth-token"),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal NotificationResponse fixture for routeNotification. */
function makeNotifResponse(category: string, actionId = "default") {
  return {
    notification: {
      request: {
        content: {
          data: { category },
        },
      },
    },
    actionIdentifier: actionId,
  } as import("expo-notifications").NotificationResponse
}

// ── PushHandler tests ─────────────────────────────────────────────────────────

describe("registerForPushNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch
  })

  it("returns a valid Expo push token on success", async () => {
    const { registerForPushNotifications } = await import("../PushHandler")

    const token = await registerForPushNotifications()

    expect(token).toBe("ExponentPushToken[test-token-123]")
  })

  it("saves token to SecureStore after successful registration", async () => {
    const SecureStore = await import("expo-secure-store")
    const { registerForPushNotifications } = await import("../PushHandler")

    await registerForPushNotifications()

    expect(vi.mocked(SecureStore.setItemAsync)).toHaveBeenCalledWith(
      "edith_push_token",
      "ExponentPushToken[test-token-123]",
    )
  })

  it("registers token to gateway with Bearer auth", async () => {
    const { registerForPushNotifications } = await import("../PushHandler")

    await registerForPushNotifications()

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/mobile/register-token"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-auth-token",
        }),
      }),
    )
  })

  it("returns null when push permission is denied", async () => {
    const Notifications = await import("expo-notifications")
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({
      status: "denied",
    } as Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>)
    vi.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce({
      status: "denied",
    } as Awaited<ReturnType<typeof Notifications.requestPermissionsAsync>>)

    const { registerForPushNotifications } = await import("../PushHandler")

    const token = await registerForPushNotifications()

    expect(token).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("does not throw when gateway registration fails — app continues", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }) as unknown as typeof fetch

    const { registerForPushNotifications } = await import("../PushHandler")

    // Must resolve (not reject) even when gateway is down
    const token = await registerForPushNotifications()
    expect(token).toBe("ExponentPushToken[test-token-123]")
  })

  it("returns null when running on a simulator / non-physical device", async () => {
    // Override the isDevice flag for this test only via doMock + resetModules
    vi.resetModules()
    vi.doMock("expo-device", () => ({ isDevice: false }))
    vi.doMock("expo-notifications", () => ({
      setNotificationHandler: vi.fn(),
      getPermissionsAsync: vi.fn(),
      requestPermissionsAsync: vi.fn(),
      getExpoPushTokenAsync: vi.fn(),
      setNotificationChannelAsync: vi.fn(),
      addNotificationReceivedListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
      addNotificationResponseReceivedListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
      AndroidImportance: { HIGH: 4, DEFAULT: 3, MAX: 5, LOW: 2, MIN: 1 },
    }))
    vi.doMock("expo-secure-store", () => ({
      getItemAsync: vi.fn().mockResolvedValue("test-auth-token"),
      setItemAsync: vi.fn().mockResolvedValue(undefined),
    }))
    vi.doMock("react-native", () => ({
      Platform: { OS: "ios" },
      Alert: { alert: vi.fn() },
    }))

    const { registerForPushNotifications } = await import("../PushHandler")
    const token = await registerForPushNotifications()

    expect(token).toBeNull()

    // Restore module registry so subsequent tests use the top-level vi.mock stubs
    vi.resetModules()
  })
})

describe("setupNotificationListeners", () => {
  it("returns a cleanup function that removes the response listener", async () => {
    // Import Notifications FIRST to get the (possibly freshly reset) mock instance,
    // then set up return values, THEN import PushHandler so it shares the same instance.
    const Notifications = await import("expo-notifications")
    const removeResponse = vi.fn()

    vi.mocked(Notifications.addNotificationResponseReceivedListener).mockReturnValue({
      remove: removeResponse,
    } as ReturnType<typeof Notifications.addNotificationResponseReceivedListener>)

    const { setupNotificationListeners } = await import("../PushHandler")
    const cleanup = setupNotificationListeners(vi.fn())

    // Cleanup should remove the tap/response listener
    cleanup()

    expect(removeResponse).toHaveBeenCalled()
  })
})

// ── NotificationRouter tests ──────────────────────────────────────────────────

describe("NotificationRouter.routeNotification", () => {
  it("routes meeting_reminder → Chat with autoMessage", async () => {
    const { routeNotification } = await import("../NotificationRouter")

    const action = routeNotification(makeNotifResponse("meeting_reminder"))

    expect(action.screen).toBe("Chat")
    expect(action.autoMessage).toContain("Brief")
  })

  it("routes security_alert → Settings", async () => {
    const { routeNotification } = await import("../NotificationRouter")

    const action = routeNotification(makeNotifResponse("security_alert"))

    expect(action.screen).toBe("Settings")
  })

  it("routes voice_request → Voice", async () => {
    const { routeNotification } = await import("../NotificationRouter")

    const action = routeNotification(makeNotifResponse("voice_request"))

    expect(action.screen).toBe("Voice")
  })

  it("routes unknown category → Chat as default", async () => {
    const { routeNotification } = await import("../NotificationRouter")

    const action = routeNotification(makeNotifResponse("completely_unknown"))

    expect(action.screen).toBe("Chat")
  })

  it("routes chat_message → Chat", async () => {
    const { routeNotification } = await import("../NotificationRouter")

    const action = routeNotification(makeNotifResponse("chat_message"))

    expect(action.screen).toBe("Chat")
  })
})
