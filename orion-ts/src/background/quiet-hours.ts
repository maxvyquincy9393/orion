const QUIET_HOURS_START = 22
const QUIET_HOURS_END = 6

export function isWithinHardQuietHours(date = new Date()): boolean {
  const hour = date.getHours()
  return hour >= QUIET_HOURS_START || hour <= QUIET_HOURS_END
}

export const __quietHoursTestUtils = {
  QUIET_HOURS_START,
  QUIET_HOURS_END,
}
