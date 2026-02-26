import { describe, expect, it } from "vitest"

import { __discordTestUtils } from "../discord.js"

describe("discord channel helpers", () => {
  it("parses DISCORD_CHANNEL_ID allowlist from comma and newline separated values", () => {
    const ids = __discordTestUtils.parseAllowedDiscordChannelIds("123,456\n789")
    expect(Array.from(ids)).toEqual(["123", "456", "789"])
  })

  it("normalizes ! and / commands", () => {
    expect(__discordTestUtils.normalizeDiscordCommand("!help")).toBe("help")
    expect(__discordTestUtils.normalizeDiscordCommand("/ping now")).toBe("ping")
    expect(__discordTestUtils.normalizeDiscordCommand("hello")).toBeNull()
  })

  it("maps Orion user and channel target ids", () => {
    expect(__discordTestUtils.toDiscordOrionUserId("u123")).toBe("discord:u123")
    expect(__discordTestUtils.toDiscordChannelTargetId("c456")).toBe("discord:channel:c456")
    expect(__discordTestUtils.parseDiscordChannelTargetId("discord:channel:c456")).toBe("c456")
    expect(__discordTestUtils.parseDiscordChannelTargetId("discord:u123")).toBeNull()
  })

  it("extracts inbound text messages and ignores incomplete payloads", () => {
    expect(__discordTestUtils.extractDiscordInboundMessage({
      content: "hi",
      channelId: "c1",
      guildId: null,
      author: { id: "u1", bot: false },
      channel: { id: "c1", isDMBased: () => true },
    })).toMatchObject({
      channelId: "c1",
      authorId: "u1",
      authorIsBot: false,
      text: "hi",
      isDm: true,
    })

    expect(__discordTestUtils.extractDiscordInboundMessage({
      content: "",
      channelId: "c1",
      author: { id: "u1", bot: false },
    })).toBeNull()
  })

  it("defaults to DM-only when allowlist is empty", () => {
    expect(__discordTestUtils.isDiscordDmAllowed("c1", true, new Set())).toBe(true)
    expect(__discordTestUtils.isDiscordDmAllowed("c1", false, new Set())).toBe(false)
    expect(__discordTestUtils.isDiscordDmAllowed("c2", false, new Set(["c1"]))).toBe(false)
    expect(__discordTestUtils.isDiscordDmAllowed("c1", false, new Set(["c1"]))).toBe(true)
  })
})
