/**
 * @file hardware-schema.ts
 * @description Type definitions for Phase 23 Hardware & Physical World Bridge.
 *
 * ARCHITECTURE:
 *   Shared types used by device-registry.ts, protocol-router.ts,
 *   device-scanner.ts, and all protocol handlers.
 */

/** Supported physical communication protocols. */
export type ProtocolType = "serial" | "mqtt" | "ble" | "ddc" | "http" | "gpio"

/** Device categories EDITH understands. */
export type DeviceType =
  | "arduino"
  | "esp32"
  | "monitor"
  | "led"
  | "printer3d"
  | "sensor"
  | "relay"
  | "ble"
  | "generic"

/** Current device connectivity status. */
export type DeviceStatus = "online" | "offline" | "unknown"

/** A capability flag declared by a device. */
export interface DeviceCapability {
  name: string
  type: "read" | "write" | "read_write"
  unit?: string
  description?: string
}

/** Persisted device record (mirrors HardwareDevice Prisma model). */
export interface HardwareDevice {
  id: string
  userId: string
  name: string
  type: DeviceType
  protocol: ProtocolType
  /** Address: COM port, MQTT topic prefix, BLE UUID, IP, etc. */
  address: string
  capabilities: DeviceCapability[]
  status: DeviceStatus
  /** Whether user confirmed first-use for safety-critical devices. */
  confirmed: boolean
  lastSeen?: Date
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

/** A command sent to a device. */
export interface HardwareCommand {
  deviceId: string
  action: string
  params?: Record<string, unknown>
  /** Physical safety: commands to relays/motors require prior user confirmation. */
  requiresConfirmation?: boolean
}

/** Response from executing a hardware command. */
export interface HardwareResponse {
  deviceId: string
  action: string
  success: boolean
  result?: unknown
  error?: string
  latencyMs: number
}

/** Retry schedule for hardware errors (soft failure policy). */
export const HARDWARE_RETRY_DELAYS_MS: readonly number[] = [3_000, 10_000, 30_000]
