# Building Skills for EDITH

Skills are lightweight, declarative capabilities that EDITH can load and invoke at runtime. Unlike tool extensions (which are TypeScript code), skills are primarily described in a `SKILL.md` file that EDITH reads to understand what the skill does and when to use it.

For skills that require logic, an optional `handler.ts` file provides the implementation.

---

## Skill File Format

Every skill lives in its own directory under `src/skills/` or `workspace/skills/`:

```
src/skills/
└── my-skill/
    ├── SKILL.md       ← required: describes the skill
    └── handler.ts     ← optional: TypeScript implementation
```

---

## SKILL.md — Required Fields

```markdown
# Skill Name

## Description
One clear sentence describing what this skill does.

## Trigger
Natural language patterns that activate this skill.
Examples:
- "search the web for ..."
- "look up ..."
- "find information about ..."

## Parameters
- `query` (string, required): The search query
- `limit` (number, optional, default: 5): Max results to return

## Returns
A summary of the search results as plain text.

## Examples
User: "Search the web for TypeScript best practices"
EDITH: [invokes this skill with query="TypeScript best practices"]

## Notes
- Requires SERPAPI_KEY in .env
- Results are cached for 5 minutes
```

---

## Required Fields Summary

| Field | Required | Description |
|-------|----------|-------------|
| `# Name` | Yes | Skill name (H1 heading) |
| `## Description` | Yes | What it does |
| `## Trigger` | Yes | When EDITH should use it |
| `## Parameters` | Yes | Input parameter definitions |
| `## Returns` | Yes | What the skill returns |
| `## Examples` | Recommended | Input/output examples |
| `## Notes` | Optional | Caveats, dependencies, limits |

---

## Example Skill — Weather Lookup

`src/skills/weather/SKILL.md`:

```markdown
# Weather Lookup

## Description
Get the current weather and forecast for a given location.

## Trigger
- "what's the weather in ..."
- "weather forecast for ..."
- "is it raining in ..."
- "temperature in ..."

## Parameters
- `location` (string, required): City name or coordinates
- `units` (string, optional, default: "metric"): "metric" or "imperial"

## Returns
Current conditions and 3-day forecast as plain text.

## Examples
User: "What's the weather in Jakarta?"
EDITH: [invokes weather skill with location="Jakarta", units="metric"]

## Notes
- Requires OPENWEATHER_API_KEY in .env
- Location is geocoded via OpenWeatherMap API
```

`src/skills/weather/handler.ts`:

```typescript
/**
 * @file handler.ts
 * @description Weather skill handler — fetches current conditions via OpenWeatherMap.
 */
import { createLogger } from '../../logger.js'

const log = createLogger('skills.weather')

/**
 * Fetch weather data for a location.
 * @param location - City name or coordinates
 * @param units - Unit system: "metric" or "imperial"
 * @returns Weather summary string
 */
export async function execute(
  location: string,
  units: string = 'metric'
): Promise<string> {
  const apiKey = process.env['OPENWEATHER_API_KEY']
  if (!apiKey) return 'Weather API key not configured.'

  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&units=${units}&appid=${apiKey}`

  const res = await fetch(url)
  if (!res.ok) {
    log.warn('Weather API error', { status: res.status, location })
    return `Could not fetch weather for "${location}".`
  }

  const data = await res.json() as { main: { temp: number }; weather: Array<{ description: string }> }
  return `${location}: ${data.weather[0]?.description ?? 'unknown'}, ${data.main.temp}°${units === 'metric' ? 'C' : 'F'}`
}
```

---

## Testing a Skill

1. Create a test file:

```typescript
// src/skills/weather/__tests__/weather.test.ts
import { describe, it, expect, vi } from 'vitest'
import { execute } from '../handler.js'

describe('weather skill', () => {
  it('returns weather data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        main: { temp: 28 },
        weather: [{ description: 'sunny' }],
      }),
    }))
    process.env['OPENWEATHER_API_KEY'] = 'test-key'

    const result = await execute('Jakarta')
    expect(result).toContain('Jakarta')
    expect(result).toContain('28')
  })
})
```

2. Run the test:

```bash
pnpm vitest run src/skills/weather/__tests__/
```

---

## Auto-Generated Skills (Phase 24)

EDITH's self-improvement engine can automatically generate new skills from recurring patterns. Auto-generated skills are saved to `workspace/skills/auto-<id>/SKILL.md` and suggested to the user for approval before activation.
