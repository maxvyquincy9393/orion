import { voice } from "../voice/bridge.js"
import { createLogger } from "../logger.js"

const log = createLogger("media-understanding.audio")

export class AudioTranscriber {
  async transcribe(audioSource: string): Promise<string> {
    try {
      const result = await voice.listen(10)

      if (!result) {
        return "Unable to transcribe audio"
      }

      return result
    } catch (error) {
      log.error("transcribe failed", error)
      return "Unable to transcribe audio"
    }
  }
}

export const audioTranscriber = new AudioTranscriber()
