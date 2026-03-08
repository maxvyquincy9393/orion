/**
 * @file relationship-reminders.ts
 * @description Generates proactive relationship reminders: dormant contacts,
 * upcoming birthdays, and custom follow-up triggers. Called by the background
 * daemon to inject reminders into the proactive message queue.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Called from `src/background/daemon.ts` on a scheduled interval
 *   - Uses `dormant-detector.ts` for dormant contact detection
 *   - Birthday checks query the `Person.birthday` field from Prisma
 *   - Returns `RelationshipReminder[]` for the daemon to format and deliver
 */

import { createLogger } from "../../logger.js"
import { prisma } from "../../database/index.js"
import { dormantDetector } from "./dormant-detector.js"
import type { RelationshipReminder } from "./people-schema.js"

const log = createLogger("memory.people.relationship-reminders")

/** Days ahead to warn about an upcoming birthday */
const BIRTHDAY_WARN_DAYS = 7

// ── RelationshipReminders ──────────────────────────────────────────────────────

/**
 * Aggregates all types of relationship reminders for a user.
 */
export class RelationshipReminders {
  /**
   * Collect all pending reminders for `userId`.
   * Combines dormant contacts, upcoming birthdays, and any follow-ups.
   *
   * @param userId - User scope
   * @returns Array of reminders, may be empty
   */
  async collectReminders(userId: string): Promise<RelationshipReminder[]> {
    const [dormant, birthdays] = await Promise.all([
      dormantDetector.detectDormant(userId),
      this.checkBirthdays(userId),
    ])

    const all = [...dormant, ...birthdays]
    if (all.length > 0) {
      log.info("reminders collected", { userId, count: all.length })
    }
    return all
  }

  /**
   * Check for people with upcoming birthdays within `BIRTHDAY_WARN_DAYS` days.
   *
   * @param userId - User scope
   * @returns Birthday reminder array
   */
  async checkBirthdays(userId: string): Promise<RelationshipReminder[]> {
    const people = await prisma.person.findMany({
      where: { userId, birthday: { not: null } },
    })

    const now = new Date()
    const reminders: RelationshipReminder[] = []

    for (const person of people) {
      if (!person.birthday) continue

      const upcoming = this.nextBirthday(person.birthday, now)
      const daysUntil = Math.ceil(
        (upcoming.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      )

      if (daysUntil >= 0 && daysUntil <= BIRTHDAY_WARN_DAYS) {
        const isToday = daysUntil === 0
        reminders.push({
          userId,
          personId: person.id,
          personName: person.name,
          type: "birthday",
          message: isToday
            ? `Today is ${person.name}'s birthday! 🎂`
            : `${person.name}'s birthday is in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.`,
          dueAt: upcoming,
          priority: isToday ? "high" : "medium",
        })
        log.debug("birthday upcoming", { name: person.name, daysUntil })
      }
    }

    return reminders
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Compute the next occurrence of `birthday` from `now`.
   * Handles the case where the birthday this year has already passed.
   */
  private nextBirthday(birthday: Date, now: Date): Date {
    const next = new Date(now.getFullYear(), birthday.getMonth(), birthday.getDate())
    if (next < now) next.setFullYear(now.getFullYear() + 1)
    return next
  }
}

/** Singleton relationship reminders */
export const relationshipReminders = new RelationshipReminders()
