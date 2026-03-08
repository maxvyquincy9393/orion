/**
 * @file ambient-scheduler.ts
 * @description Schedules periodic ambient data refreshes (weather, news, market).
 *
 * ARCHITECTURE / INTEGRATION:
 *   Runs a 30-minute refresh loop for all ambient monitors.
 *   Started from startup.ts to warm up caches before first morning briefing.
 */
import { createLogger } from '../logger.js'
import { weatherMonitor } from './weather-monitor.js'
import { marketMonitor } from './market-monitor.js'

const log = createLogger('ambient.scheduler')

class AmbientScheduler {
  private timer: ReturnType<typeof setInterval> | null = null

  /** Start periodic ambient data refresh. Interval: 30 minutes. */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.refresh().catch(err => log.warn('ambient refresh failed', { err }))
    }, 30 * 60 * 1000)

    // Initial fetch to warm up cache
    void this.refresh().catch(err => log.debug('initial ambient fetch failed', { err }))
    log.info('ambient scheduler started')
  }

  /** Stop the scheduler and clear the timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Refresh all ambient data sources concurrently. */
  private async refresh(): Promise<void> {
    await Promise.allSettled([
      weatherMonitor.getCurrent(),
      marketMonitor.getSummary(),
    ])
    log.debug('ambient data refreshed')
  }
}

/** Singleton ambient scheduler. */
export const ambientScheduler = new AmbientScheduler()
