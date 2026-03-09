import { describe, it, expect, vi, beforeEach } from "vitest"
import { HomeAssistantTool } from "../tool.js"

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

describe("HomeAssistantTool", () => {
  let tool: HomeAssistantTool

  beforeEach(() => {
    tool = new HomeAssistantTool({
      baseUrl: "http://ha.local:8123",
      token: "fake",
    })
    mockFetch.mockReset()
  })

  it("isOnline returns true on 200", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    expect(await tool.isOnline()).toBe(true)
  })

  it("isOnline returns false on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"))
    expect(await tool.isOnline()).toBe(false)
  })

  it("getLights filters to light.* entities", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          entity_id: "light.bedroom",
          state: "on",
          attributes: {},
          last_changed: "",
        },
        {
          entity_id: "sensor.temp",
          state: "22",
          attributes: {},
          last_changed: "",
        },
      ],
    })
    const lights = await tool.getLights()
    expect(lights).toHaveLength(1)
    expect(lights[0]!.entity_id).toBe("light.bedroom")
  })

  it("turnOn calls correct service", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    await tool.turnOn("light.bedroom")
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/services/light/turn_on"),
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("setClimate calls climate.set_temperature", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    await tool.setClimate("climate.living_room", 22)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/services/climate/set_temperature"),
      expect.objectContaining({ method: "POST" }),
    )
  })
})
