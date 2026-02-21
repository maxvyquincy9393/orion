import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createLogger } from "../logger.js"

const log = createLogger("skills.manager")

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = path.join(__dirname, "..", "..", ".orion", "skills")

export interface Skill {
  name: string
  description: string
  trigger?: RegExp
  handler?: (input: string, userId: string) => Promise<string>
  execute?: (input: string, userId: string) => Promise<string>
}

export class SkillManager {
  private skills = new Map<string, Skill>()
  private initialized = false

  async init(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      await fs.mkdir(SKILLS_DIR, { recursive: true })
      await this.loadSkills()
      this.initialized = true
      log.info(`skill manager ready (${this.skills.size} skills)`)
    } catch (error) {
      log.error("failed to init skill manager", error)
    }
  }

  private async loadSkills(): Promise<void> {
    try {
      const files = await fs.readdir(SKILLS_DIR)
      for (const file of files) {
        if (file.endsWith(".yaml") || file.endsWith(".yml")) {
          const yaml = await import("js-yaml")
          const content = await fs.readFile(path.join(SKILLS_DIR, file), "utf-8")
          const skillDef = yaml.load(content) as Skill
          if (skillDef.name) {
            this.skills.set(skillDef.name, skillDef)
            log.debug("loaded skill", { name: skillDef.name })
          }
        }
      }
    } catch (error) {
      log.warn("failed to load skills", error)
    }
  }

  register(skill: Skill): void {
    this.skills.set(skill.name, skill)
    log.info("registered skill", { name: skill.name })
  }

  unregister(name: string): void {
    this.skills.delete(name)
    log.info("unregistered skill", { name })
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  getSkills(): string[] {
    return [...this.skills.keys()]
  }

  listSkills(): Skill[] {
    return Array.from(this.skills.values())
  }

  async execute(name: string, input: string, userId: string): Promise<string | null> {
    const skill = this.skills.get(name)
    if (!skill) {
      return null
    }

    if (skill.execute) {
      return skill.execute(input, userId)
    }

    if (skill.handler) {
      return skill.handler(input, userId)
    }

    return null
  }

  async matchTrigger(input: string): Promise<Skill | undefined> {
    for (const skill of this.skills.values()) {
      if (skill.trigger && skill.trigger.test(input)) {
        return skill
      }
    }
    return undefined
  }
}

export const skillManager = new SkillManager()
