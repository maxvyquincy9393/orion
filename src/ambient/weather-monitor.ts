/**
 * @file weather-monitor.ts
 * @description Hyperlocal weather awareness — fetches and caches weather data.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Uses Open-Meteo (free, no API key required).
 *   30-minute cache to avoid rate limits.
 *   Graceful degradation if coords not set in config.
 *   Used by morning briefing for weather context.
 */
import { createLogger } from '../logger.js'
import config from '../config.js'

const log = createLogger('ambient.weather')

/** Open-Meteo forecast API base URL. */
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'

/** Current weather conditions snapshot. */
export interface WeatherData {
  description: string
  temp: number
  feelsLike: number
  humidity: number
  rainChance: number
  windSpeed: number
  fetchedAt: Date
}

/** Raw response shape from Open-Meteo. */
interface OpenMeteoResponse {
  current: {
    temperature_2m: number
    relative_humidity_2m: number
    wind_speed_10m: number
    precipitation_probability: number
  }
}

class WeatherMonitor {
  private cache: WeatherData | null = null
  private cacheExpiry = 0
  private readonly CACHE_TTL_MS = 30 * 60 * 1000

  /**
   * Get current weather, using cache if still fresh.
   * @returns WeatherData or null if coords not configured or fetch fails.
   */
  async getCurrent(): Promise<WeatherData | null> {
    if (this.cache && Date.now() < this.cacheExpiry) return this.cache

    const lat = config.USER_LATITUDE
    const lon = config.USER_LONGITUDE
    if (!lat || !lon) return null

    try {
      const url = new URL(OPEN_METEO_URL)
      url.searchParams.set('latitude', lat)
      url.searchParams.set('longitude', lon)
      url.searchParams.set(
        'current',
        'temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation_probability',
      )

      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`Weather API ${res.status}`)
      const data = await res.json() as OpenMeteoResponse

      this.cache = {
        description: this.describeWeather(data.current),
        temp: data.current.temperature_2m,
        feelsLike: data.current.temperature_2m,
        humidity: data.current.relative_humidity_2m,
        rainChance: data.current.precipitation_probability,
        windSpeed: data.current.wind_speed_10m,
        fetchedAt: new Date(),
      }
      this.cacheExpiry = Date.now() + this.CACHE_TTL_MS
      return this.cache
    } catch (err) {
      log.warn('weather fetch failed', { err })
      return null
    }
  }

  /** Produce a human-readable weather description from raw readings. */
  private describeWeather(c: { temperature_2m: number; precipitation_probability: number }): string {
    if (c.precipitation_probability > 70) return 'rainy'
    if (c.precipitation_probability > 40) return 'cloudy, chance of rain'
    if (c.temperature_2m > 32) return 'hot and sunny'
    if (c.temperature_2m > 28) return 'partly cloudy'
    return 'clear'
  }
}

/** Singleton weather monitor. */
export const weatherMonitor = new WeatherMonitor()
