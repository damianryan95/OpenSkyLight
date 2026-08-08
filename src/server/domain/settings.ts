import type Database from 'better-sqlite3'
import { DomainValidationError, HouseholdTimezoneRequiredError } from './errors'

const TIMEZONE_KEY = 'household.timezone'
const WEATHER_KEY = 'household.weather'

export interface HouseholdSettings {
  timezone: string
  weather: { lat: number; lon: number; label: string } | null
}

/** Household-wide settings only. Registered display settings belong to devices. */
export function createHouseholdSettingsService(sqlite: Database.Database) {
  const getStatement = sqlite.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
  const setStatement = sqlite.prepare<[string, string, string]>(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)

  function get(): HouseholdSettings {
    const timezone = getStatement.get(TIMEZONE_KEY)?.value
    if (!timezone) throw new HouseholdTimezoneRequiredError()
    validateTimezone(timezone)
    const weatherRaw = getStatement.get(WEATHER_KEY)?.value
    let weather: HouseholdSettings['weather'] = null
    if (weatherRaw) {
      try { const value = JSON.parse(weatherRaw) as { lat?: unknown; lon?: unknown; label?: unknown }; if (typeof value.lat === 'number' && typeof value.lon === 'number' && typeof value.label === 'string') weather = { lat: value.lat, lon: value.lon, label: value.label } } catch { /* unset invalid legacy value */ }
    }
    return { timezone, weather }
  }

  function setTimezone(timezone: string): HouseholdSettings {
    validateTimezone(timezone)
    setStatement.run(TIMEZONE_KEY, timezone, new Date().toISOString())
    return get()
  }

  function setWeather(weather: HouseholdSettings['weather']): HouseholdSettings {
    if (weather !== null && (!Number.isFinite(weather.lat) || !Number.isFinite(weather.lon) || weather.lat < -90 || weather.lat > 90 || weather.lon < -180 || weather.lon > 180 || !weather.label.trim())) throw new DomainValidationError('A valid weather location is required.')
    setStatement.run(WEATHER_KEY, weather === null ? '' : JSON.stringify({ lat: weather.lat, lon: weather.lon, label: weather.label.trim() }), new Date().toISOString())
    return get()
  }

  return { get, setTimezone, setWeather }
}

function validateTimezone(timezone: string): void {
  if (!timezone.trim()) throw new DomainValidationError('Household timezone is required.')
  try {
    Intl.DateTimeFormat('en', { timeZone: timezone })
  } catch {
    throw new DomainValidationError(`Invalid household timezone: ${timezone}`)
  }
}

export type HouseholdSettingsService = ReturnType<typeof createHouseholdSettingsService>
