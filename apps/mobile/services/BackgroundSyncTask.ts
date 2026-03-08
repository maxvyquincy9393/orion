/**
 * @file BackgroundSyncTask.ts
 * @description Background sync task using expo-background-task.
 *
 * ARCHITECTURE:
 *   Menggunakan expo-background-task (bukan expo-background-fetch yang deprecated).
 *   expo-background-task pakai:
 *     - iOS: BGTaskScheduler API (iOS 13+)
 *     - Android: WorkManager API
 *   Kedua API ini battery-optimal dan modern.
 *
 * SYNC INTERVAL:
 *   Minimum 15 menit (OS bisa delay lebih lama berdasarkan battery + usage patterns).
 *   OS yang menentukan waktu exact — kita hanya set minimum interval.
 *
 * BATTERY AWARENESS:
 *   expo-background-task secara native hanya jalan saat battery cukup.
 *   WorkManager (Android) punya requiresBatteryNotLow = true by default.
 *   BGTaskScheduler (iOS) auto-defer saat battery rendah.
 *
 * OFFLINE HANDLING:
 *   Jika network tidak tersedia, task complete dengan NoData (tidak retry crash).
 *   OS akan retry di interval berikutnya.
 *
 * TASK REGISTRATION:
 *   WAJIB dipanggil di global scope (luar React component).
 *   Sudah di-export untuk dipanggil di App.tsx sebelum mount.
 *
 * REF:
 *   https://docs.expo.dev/versions/latest/sdk/background-task/
 *   https://expo.dev/blog/goodbye-background-fetch-hello-expo-background-task
 */

import * as BackgroundTask from "expo-background-task"
import * as TaskManager from "expo-task-manager"
import * as SecureStore from "expo-secure-store"
import NetInfo from "@react-native-community/netinfo"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { offlineQueue } from "./OfflineQueue"

/** Identifier unik untuk background task — harus konsisten */
export const BACKGROUND_SYNC_TASK_ID = "com.edith.background-sync"

/** Key untuk menyimpan last sync timestamp */
const LAST_SYNC_KEY = "edith_last_sync_at"

/** Minimum interval background task (detik) */
const SYNC_INTERVAL_SECONDS = 15 * 60 // 15 menit

// ── Task Definition (HARUS di global scope) ───────────────────────────────────

/**
 * Define background task.
 * WAJIB dipanggil di global scope — sebelum React component mount.
 * Ini adalah registration, bukan eksekusi.
 */
TaskManager.defineTask(BACKGROUND_SYNC_TASK_ID, async () => {
  console.log("[BackgroundSync] Task triggered:", new Date().toISOString())

  try {
    return await performSync()
  } catch (err) {
    console.error("[BackgroundSync] Task error:", err)
    return BackgroundTask.BackgroundTaskResult.Failed
  }
})

// ── Sync Logic ────────────────────────────────────────────────────────────────

/**
 * Perform delta sync dengan gateway.
 *
 * @returns BackgroundTaskResult untuk dilaporkan ke OS
 */
async function performSync(): Promise<BackgroundTask.BackgroundTaskResult> {
  // 1. Check network connectivity
  const netState = await NetInfo.fetch()
  if (!netState.isConnected) {
    console.log("[BackgroundSync] No network — skip sync")
    return BackgroundTask.BackgroundTaskResult.NoData
  }

  // 2. Get credentials dari secure store
  const [authToken, rawGatewayUrl, userId] = await Promise.all([
    SecureStore.getItemAsync("edith_auth_token"),
    SecureStore.getItemAsync("edith_gateway_url"),
    SecureStore.getItemAsync("edith_user_id"),
  ])

  if (!authToken || !rawGatewayUrl) {
    console.log("[BackgroundSync] No credentials — skip sync")
    return BackgroundTask.BackgroundTaskResult.NoData
  }

  // 3. Convert WebSocket URL ke HTTP URL
  const httpUrl = rawGatewayUrl
    .replace("ws://", "http://")
    .replace("wss://", "https://")
    .replace("/ws", "")

  // 4. Flush any queued offline messages via HTTP POST (no active WebSocket in background)
  if (userId) {
    const httpSend = (msg: string): void => {
      // Fire-and-forget HTTP delivery — errors are non-fatal for the sync task
      void fetch(`${httpUrl}/api/message`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: msg,
        signal: AbortSignal.timeout(15_000),
      }).catch((err: unknown) => {
        console.warn("[BackgroundSync] Offline queue HTTP delivery failed:", err)
      })
    }

    await offlineQueue.flush(httpSend, userId).catch((err: unknown) => {
      console.warn("[BackgroundSync] Offline queue flush failed:", err)
    })
  }

  // 5. Get lastSyncAt
  const lastSyncAt = await AsyncStorage.getItem(LAST_SYNC_KEY)
  const since =
    lastSyncAt ??
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // 6. Fetch delta dari gateway
  let response: Response
  try {
    response = await fetch(
      `${httpUrl}/api/sync/delta?since=${encodeURIComponent(since)}`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
        signal: AbortSignal.timeout(30_000),
      },
    )
  } catch (err) {
    console.warn("[BackgroundSync] Network fetch failed:", err)
    return BackgroundTask.BackgroundTaskResult.Failed
  }

  if (!response.ok) {
    console.warn("[BackgroundSync] Sync API error:", response.status)
    return BackgroundTask.BackgroundTaskResult.Failed
  }

  const data = (await response.json()) as {
    messages: unknown[]
    widgetData: Record<string, unknown>
    syncedAt: string
  }

  // 7. Cache synced data ke AsyncStorage
  await Promise.all([
    AsyncStorage.setItem(LAST_SYNC_KEY, data.syncedAt),
    AsyncStorage.setItem("edith_widget_data", JSON.stringify(data.widgetData)),
    data.messages.length > 0
      ? AsyncStorage.setItem(
          "edith_cached_messages",
          JSON.stringify(data.messages.slice(-100)),
        )
      : Promise.resolve(),
  ])

  console.log("[BackgroundSync] Sync complete:", {
    messages: data.messages.length,
    syncedAt: data.syncedAt,
  })

  return data.messages.length > 0
    ? BackgroundTask.BackgroundTaskResult.NewData
    : BackgroundTask.BackgroundTaskResult.NoData
}

// ── Registration API ──────────────────────────────────────────────────────────

/**
 * Register background sync task.
 * Dipanggil dari App.tsx useEffect — hanya perlu 1x setelah user login.
 */
export async function registerBackgroundSync(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(
      BACKGROUND_SYNC_TASK_ID,
    )
    if (isRegistered) {
      console.log("[BackgroundSync] Task already registered")
      return
    }

    await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK_ID, {
      minimumInterval: SYNC_INTERVAL_SECONDS,
    })

    console.log(
      "[BackgroundSync] Task registered, interval:",
      SYNC_INTERVAL_SECONDS,
      "s",
    )
  } catch (err) {
    console.warn("[BackgroundSync] Registration failed:", err)
    // Tidak throw — app tetap jalan tanpa background sync
  }
}

/**
 * Unregister background task (saat logout).
 */
export async function unregisterBackgroundSync(): Promise<void> {
  await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK_ID).catch(
    () => {
      // Ignore jika belum terdaftar
    },
  )
}

/**
 * Trigger sync manual (saat app dibuka dari background).
 * Tidak menunggu background task — sync segera.
 */
export async function syncNow(): Promise<void> {
  await performSync().catch((err) => {
    console.warn("[BackgroundSync] Manual sync failed:", err)
  })
}
