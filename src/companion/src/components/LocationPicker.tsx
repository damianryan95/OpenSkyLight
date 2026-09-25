import { useState } from 'react'
import { ApiError, parentGet } from '../api/client'
import { GhostButton, TextInput } from './ui'

/**
 * Where the household is: its timezone, and optionally a town for the weather.
 *
 * One component because the same question is asked twice — once in first-run
 * setup and again on the Home tab whenever a family moves house — and the two
 * had drifted into two copies of the same search-and-geolocate logic. The
 * timezone is the part that matters: it decides which calendar day a chore
 * belongs to on every display. The weather is decoration, and optional.
 */

export interface LocationValue {
  timezone: string
  label: string
  lat: string
  lon: string
}

/** The phone's own zone is nearly always the household's. Offer it, do not
 * assume it — a parent setting up a screen for a relative abroad is real. */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function emptyLocation(timezone: string = deviceTimezone()): LocationValue {
  return { timezone, label: '', lat: '', lon: '' }
}

/** What the server accepts, or the sentence to show a parent instead. A blank
 * town is a deliberate "no weather", not a mistake. */
export function locationToSettings(value: LocationValue):
  | { ok: true; settings: { timezone: string; weather: { label: string; lat: number; lon: number } | null } }
  | { ok: false; message: string } {
  const timezone = value.timezone.trim()
  if (timezone === '') return { ok: false, message: 'Choose a time zone. It decides which day a chore belongs to on every screen.' }
  if (value.label.trim() === '') return { ok: true, settings: { timezone, weather: null } }
  const lat = Number(value.lat)
  const lon = Number(value.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, message: 'Pick your town from the search results, or use this phone’s location, so the weather knows where to look.' }
  }
  return { ok: true, settings: { timezone, weather: { label: value.label.trim(), lat, lon } } }
}

/** A datalist of every zone this WebView knows, so a parent can type "Perth"
 * and pick rather than remembering "Australia/Perth". Older engines lack the
 * API; they fall back to a plain text field, which still works. */
function knownTimezones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    return intl.supportedValuesOf?.('timeZone') ?? []
  } catch {
    return []
  }
}

export function LocationPicker({ value, onChange }: { value: LocationValue; onChange: (next: LocationValue) => void }) {
  const [results, setResults] = useState<Array<{ label: string; lat: number; lon: number }>>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const zones = knownTimezones()

  const search = async () => {
    if (value.label.trim().length < 2) return
    setSearching(true)
    setError(null)
    try {
      const found = await parentGet<{ locations: Array<{ label: string; lat: number; lon: number }> }>(`/api/v1/weather/locations?q=${encodeURIComponent(value.label)}`)
      setResults(found.locations)
      if (found.locations.length === 0) setError('Nothing matched that. Try the nearest larger town.')
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Could not search for that town right now.')
    } finally {
      setSearching(false)
    }
  }

  const locate = () => {
    if (navigator.geolocation === undefined) { setError('This phone cannot share its location. Search for your town instead.'); return }
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setResults([])
        onChange({ ...value, lat: String(position.coords.latitude), lon: String(position.coords.longitude), label: value.label.trim() === '' ? 'Home' : value.label })
      },
      () => setError('Location permission was not available. Search for your town instead.')
    )
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-sm font-extrabold">Time zone</span>
        <input
          list={zones.length > 0 ? 'osl-timezones' : undefined}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="min-h-11 w-full rounded-xl border border-line bg-paper px-3 text-base font-semibold outline-none placeholder:text-ink-faint focus:border-ember"
          value={value.timezone}
          onChange={(event) => onChange({ ...value, timezone: event.target.value })}
          placeholder="e.g. Australia/Perth"
        />
        {zones.length > 0 && <datalist id="osl-timezones">{zones.map((zone) => <option key={zone} value={zone} />)}</datalist>}
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-extrabold">Town or city <span className="font-semibold text-ink-faint">(for the weather — optional)</span></span>
        <div className="flex gap-2">
          <TextInput value={value.label} onChange={(label) => onChange({ ...value, label })} placeholder="e.g. Fremantle" />
          <GhostButton onClick={() => void search()}>{searching ? 'Searching…' : 'Search'}</GhostButton>
        </div>
      </label>

      {results.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line" role="listbox" aria-label="Matching towns">
          {results.map((result) => (
            <button
              key={`${result.lat},${result.lon}`}
              type="button"
              role="option"
              aria-selected={value.lat === String(result.lat) && value.lon === String(result.lon)}
              className="block min-h-11 w-full border-b border-line px-3 py-2 text-left font-semibold last:border-0 hover:bg-paper-deep"
              onClick={() => { onChange({ ...value, label: result.label, lat: String(result.lat), lon: String(result.lon) }); setResults([]) }}
            >
              {result.label}
              <span className="block text-xs text-ink-faint">{result.lat.toFixed(3)}, {result.lon.toFixed(3)}</span>
            </button>
          ))}
        </div>
      )}

      <GhostButton onClick={locate}>Use this phone’s location</GhostButton>
      {value.lat !== '' && value.lon !== '' && (
        <p className="text-sm font-semibold text-ink-faint">Weather will be shown for {value.label || 'this spot'}.</p>
      )}
      {error !== null && <p className="text-sm font-bold text-red-800" role="alert">{error}</p>}
    </div>
  )
}
