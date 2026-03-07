/**
 * weatherTimeTool — Current time, timezone info, and weather data.
 *
 * Actions:
 *   time     — Current time in any timezone
 *   weather  — Current weather for a location (Open-Meteo, no API key needed)
 *
 * Uses Open-Meteo free API for weather — no API key required.
 * Uses worldtimeapi.org for accurate timezone-aware time.
 *
 * @module agents/tools/weather-time
 */
import { tool } from "ai"
import { z } from "zod"
import { createLogger } from "../../logger.js"

const log = createLogger("tools.weather-time")

const WEATHER_CODES: Record<number, string> = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Foggy", 48: "Icy fog", 51: "Light drizzle", 53: "Drizzle",
  55: "Heavy drizzle", 61: "Slight rain", 63: "Rain", 65: "Heavy rain",
  71: "Slight snow", 73: "Snow", 75: "Heavy snow", 80: "Slight showers",
  81: "Showers", 82: "Heavy showers", 95: "Thunderstorm", 99: "Heavy thunderstorm",
}

async function getWeather(location: string): Promise<string> {
  // Step 1: geocode location
  const geoRes = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`
  )
  const geoData = await geoRes.json() as {
    results?: Array<{ latitude: number; longitude: number; name: string; country: string }>
  }

  if (!geoData.results?.length) {
    return `Location '${location}' not found.`
  }

  const { latitude, longitude, name, country } = geoData.results[0]

  // Step 2: get weather
  const weatherRes = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&hourly=relative_humidity_2m,apparent_temperature&timezone=auto`
  )
  const weatherData = await weatherRes.json() as {
    current_weather: { temperature: number; windspeed: number; weathercode: number; time: string }
    timezone: string
  }

  const cw = weatherData.current_weather
  const condition = WEATHER_CODES[cw.weathercode] ?? `Code ${cw.weathercode}`

  log.info("weather fetched", { location, temp: cw.temperature })

  return [
    `Weather in ${name}, ${country}:`,
    `  Condition: ${condition}`,
    `  Temperature: ${cw.temperature}°C`,
    `  Wind: ${cw.windspeed} km/h`,
    `  Timezone: ${weatherData.timezone}`,
    `  Updated: ${cw.time}`,
  ].join("\n")
}

export const weatherTimeTool = tool({
  description: `Get current time (any timezone) or weather for any city.
Actions: time(timezone?), weather(location).
Use for: telling the time, checking weather before suggesting outdoor plans, timezone conversions.`,
  inputSchema: z.object({
    action: z.enum(["time", "weather"]),
    timezone: z.string().optional().describe("IANA timezone (e.g. 'Asia/Jakarta', 'America/New_York')"),
    location: z.string().optional().describe("City name for weather (e.g. 'Jakarta', 'Tokyo, Japan')"),
  }),
  execute: async ({ action, timezone, location }) => {
    try {
      if (action === "time") {
        const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
        const now = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          dateStyle: "full",
          timeStyle: "long",
        }).format(new Date())
        return `Current time (${tz}): ${now}`
      }

      if (action === "weather") {
        if (!location) return "Error: location required for weather"
        return await getWeather(location)
      }

      return "Unknown action"
    } catch (err) {
      return `Weather/time failed: ${String(err)}`
    }
  },
})
