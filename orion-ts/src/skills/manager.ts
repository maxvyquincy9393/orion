import { createLogger } from "../logger.js"

const logger = createLogger("skills")

export class SkillManager {
  async init(): Promise<void> {
    logger.info("skills loaded")
  }

  getSkills(): string[] {
    return []
  }
}

export const skillManager = new SkillManager()
