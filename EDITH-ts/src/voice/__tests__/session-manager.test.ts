import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  transcribeTurn: vi.fn(),
  speakStreaming: vi.fn(),
  loadRuntimeVoiceConfig: vi.fn(),
}))

vi.mock("../providers.js", () => ({
  createTurnSttProvider: () => ({
    transcribeTurn: mocks.transcribeTurn,
  }),
}))

vi.mock("../bridge.js", () => ({
  voice: {
    speakStreaming: mocks.speakStreaming,
  },
}))

vi.mock("../runtime-config.js", () => ({
  loadRuntimeVoiceConfig: mocks.loadRuntimeVoiceConfig,
}))

import { VoiceSessionManager, type VoiceSessionEvent } from "../session-manager.js"

describe("VoiceSessionManager", () => {
  beforeEach(() => {
    mocks.transcribeTurn.mockReset()
    mocks.speakStreaming.mockReset()
    mocks.loadRuntimeVoiceConfig.mockReset()

    mocks.loadRuntimeVoiceConfig.mockResolvedValue({
      enabled: true,
      mode: "push-to-talk",
      stt: {
        engine: "auto",
        language: "auto",
        whisperModel: "base",
        providers: {
          deepgram: {},
        },
      },
      tts: {
        engine: "edge",
        voice: "en-US-GuyNeural",
      },
      wake: {
        engine: "openwakeword",
        keyword: "hey-edith",
        providers: {
          picovoice: {},
        },
      },
      vad: {
        engine: "silero",
      },
    })

    mocks.transcribeTurn.mockResolvedValue({
      text: "hello edith",
      provider: "python-whisper",
    })

    mocks.speakStreaming.mockImplementation(async (_text: string, _profile: string, onChunk: (chunk: Buffer) => void) => {
      onChunk(Buffer.from("audio-chunk"))
    })
  })

  it("processes a buffered turn and emits transcript, response, audio, and stop", async () => {
    const events: VoiceSessionEvent[] = []
    const manager = new VoiceSessionManager({
      generateResponse: vi.fn().mockResolvedValue("hello back"),
    })

    await manager.startSession({
      userId: "owner",
      requestId: "voice-1",
      mimeType: "audio/webm",
    }, (event) => events.push(event))

    await manager.stopSession({
      userId: "owner",
      requestId: "voice-1",
      data: Buffer.from("voice-input").toString("base64"),
    })

    await vi.waitFor(() => {
      expect(events.some((event) => event.type === "voice_stopped")).toBe(true)
    })

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "voice_transcript", text: "hello edith" }),
      expect.objectContaining({ type: "assistant_transcript", text: "hello back" }),
      expect.objectContaining({ type: "voice_audio" }),
      expect.objectContaining({ type: "voice_stopped", reason: "completed" }),
    ]))
  })

  it("cancels the previous session when a new turn starts for the same user", async () => {
    const firstEvents: VoiceSessionEvent[] = []
    const secondEvents: VoiceSessionEvent[] = []
    const manager = new VoiceSessionManager({
      generateResponse: vi.fn().mockResolvedValue("unused"),
    })

    await manager.startSession({
      userId: "owner",
      requestId: "voice-1",
    }, (event) => firstEvents.push(event))

    await manager.startSession({
      userId: "owner",
      requestId: "voice-2",
    }, (event) => secondEvents.push(event))

    expect(firstEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "voice_stopped", reason: "superseded" }),
    ]))
    expect(secondEvents).toEqual([])
  })
})
