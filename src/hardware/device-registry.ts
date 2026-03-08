/**
 * @file device-registry.ts
 * @description Prisma-backed registry of all known hardware devices per user.
 *
 * ARCHITECTURE:
 *   Single source of truth for device state. All hardware modules query here
 *   instead of the DB directly. Maintains an in-memory cache for hot reads.
 *   All hardware is gated behind per-user permission (HARDWARE_ENABLED must
 *   be true and the device must be registered).
 */

import { createLogger } from "../logger.js"
import { prisma } from "../database/index.js"
import config from "../config.js"
import type { HardwareDevice, DeviceStatus, DeviceType, ProtocolType, DeviceCapability } from "./hardware-schema.js"

const log = createLogger("hardware.device-registry")

/** Input for registering a new device. */
export interface RegisterDeviceInput {
  userId: string
  name: string
  type: DeviceType
  protocol: ProtocolType
  address: string
  capabilities?: DeviceCapability[]
  metadata?: Record<string, unknown>
}

/**
 * Manages the registry of physical devices connected to EDITH.
 */
export class DeviceRegistry {
  /** In-memory cache: userId → devices. */
  private readonly cache = new Map<string, HardwareDevice[]>()

  /**
   * Registers a new device or updates an existing one (by userId+address).
   */
  async register(input: RegisterDeviceInput): Promise<HardwareDevice> {
    if (!config.HARDWARE_ENABLED) {
      throw new Error("Hardware module is disabled (HARDWARE_ENABLED=false)")
    }

    const row = await prisma.hardwareDevice.upsert({
      where: { userId_address: { userId: input.userId, address: input.address } },
      create: {
        userId: input.userId,
        name: input.name,
        type: input.type,
        protocol: input.protocol,
        address: input.address,
        capabilities: (input.capabilities ?? []) as object[],
        metadata: (input.metadata ?? {}) as object,
        status: "unknown",
        confirmed: false,
        lastSeen: new Date(),
      },
      update: {
        name: input.name,
        type: input.type,
        protocol: input.protocol,
        capabilities: (input.capabilities ?? []) as object[],
        metadata: (input.metadata ?? {}) as object,
        lastSeen: new Date(),
      },
    })

    const device = this.rowToDevice(row)
    this.updateCache(input.userId, device)
    log.info("device registered", { userId: input.userId, deviceId: device.id, protocol: device.protocol })
    return device
  }

  /**
   * Sets the confirmed flag (user acknowledged first-use for physical safety).
   */
  async confirm(deviceId: string): Promise<void> {
    await prisma.hardwareDevice.update({ where: { id: deviceId }, data: { confirmed: true } })
    log.info("device confirmed by user", { deviceId })
  }

  /**
   * Updates device status (online/offline/unknown).
   */
  async setStatus(deviceId: string, status: DeviceStatus): Promise<void> {
    await prisma.hardwareDevice.update({
      where: { id: deviceId },
      data: { status, lastSeen: status === "online" ? new Date() : undefined },
    })
  }

  /**
   * Lists all registered devices for a user.
   */
  async list(userId: string): Promise<HardwareDevice[]> {
    const cached = this.cache.get(userId)
    if (cached) return cached

    const rows = await prisma.hardwareDevice.findMany({ where: { userId } })
    const devices = rows.map(r => this.rowToDevice(r))
    this.cache.set(userId, devices)
    return devices
  }

  /**
   * Finds a specific device by ID.
   */
  async get(deviceId: string): Promise<HardwareDevice | null> {
    const row = await prisma.hardwareDevice.findUnique({ where: { id: deviceId } })
    return row ? this.rowToDevice(row) : null
  }

  /** Maps a Prisma row to a HardwareDevice interface. */
  private rowToDevice(row: {
    id: string; userId: string; name: string; type: string; protocol: string;
    address: string; capabilities: unknown; status: string; confirmed: boolean;
    lastSeen: Date | null; metadata: unknown; createdAt: Date; updatedAt: Date;
  }): HardwareDevice {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      type: row.type as DeviceType,
      protocol: row.protocol as ProtocolType,
      address: row.address,
      capabilities: (row.capabilities as DeviceCapability[]) ?? [],
      status: row.status as DeviceStatus,
      confirmed: row.confirmed,
      lastSeen: row.lastSeen ?? undefined,
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  /** Updates the in-memory cache entry for a device. */
  private updateCache(userId: string, device: HardwareDevice): void {
    const current = this.cache.get(userId) ?? []
    const idx = current.findIndex(d => d.id === device.id)
    if (idx >= 0) current[idx] = device
    else current.push(device)
    this.cache.set(userId, current)
  }
}

export const deviceRegistry = new DeviceRegistry()
