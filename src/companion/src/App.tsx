import { FormEvent, useEffect, useState } from 'react'
import {
  ApiError,
  clearParentSession,
  disconnectFromHousehold,
  getApiBaseUrl,
  getParentAuthStatus,
  getParentCredential,
  isNativeApp,
  loginParent,
  logoutParent,
  setUnauthorizedHandler,
  setupParentPin,
  parentMutation,
  parentGet,
  type ParentAuthStatus
} from './api/client'
import { cancelPhoneCalendarSync, startPhoneCalendarSyncTriggers } from './api/phoneCalendarSync'
import { peekPendingEnrolmentCode } from './api/pendingEnrolment'
import { Card, GhostButton, PrimaryButton, TextInput } from './components/ui'
import { PeopleCalendarsPage } from './pages/PeopleCalendarsPage'
import { ChoresRewardsAdminPage } from './pages/ChoresRewardsAdminPage'
import { ListsMealsAdminPage } from './pages/ListsMealsAdminPage'
import { DisplaysDiagnosticsPage } from './pages/DisplaysDiagnosticsPage'
import { PairingScreen } from './pages/PairingScreen'

type SectionId = 'home' | 'household' | 'calendar' | 'chores' | 'planning' | 'displays'

const SECTIONS: { id: SectionId; label: string; description: string; icon: string }[] = [
  { id: 'home', label: 'Home', description: 'Household administration', icon: '⌂' },
  { id: 'household', label: 'Household', description: 'People and household roles', icon: '⌘' },
  { id: 'calendar', label: 'Calendar', description: 'Connected calendars', icon: '□' },
  { id: 'chores', label: 'Chores', description: 'Chores, rewards, and corrections', icon: '★' },
  { id: 'planning', label: 'Planning', description: 'Lists and meals', icon: '✓' },
  { id: 'displays', label: 'Displays', description: 'Registered screens and diagnostics', icon: '▤' }
]

export default function App() {
  const [status, setStatus] = useState<ParentAuthStatus | null>(null)
  // A parent who scanned the screen's QR with their phone's own camera arrives
  // here with the code already captured by `main.tsx`, and no idea that
  // Displays is where it is spent. Take them there — through the PIN screen
  // first, if the session has lapsed.
  const [section, setSection] = useState<SectionId>(() => (peekPendingEnrolmentCode() === null ? 'home' : 'displays'))
  // Bumped when a pairing is made or dropped, purely to re-read the two stored
  // values below. They live in localStorage rather than state because the API
  // client owns them and signs every request with them.
  const [pairingGeneration, setPairingGeneration] = useState(0)
  const native = isNativeApp()
  const paired = !native || (getApiBaseUrl() !== '' && getParentCredential() !== null)

  useEffect(() => {
    // An unpaired app has no address to ask, so asking would only produce a
    // failure the pairing screen is already showing the way out of.
    if (!paired) return
    let cancelled = false
    const refresh = async () => {
      try {
        const next = await getParentAuthStatus()
        if (!cancelled) setStatus(next)
      } catch (reason) {
        if (cancelled) return
        // In the browser a failed status check means the session is gone. In
        // the app the credential is held locally and survives the Wi-Fi
        // dropping out, so a transport failure must not throw a working phone
        // back to pairing — only a refusal the server actually made does.
        const transient = native && !(reason instanceof ApiError)
        setStatus((current) => (transient && current !== null ? current : { configured: true, authenticated: false, expiresAt: null }))
      }
    }
    setUnauthorizedHandler(() => {
      clearParentSession()
      setStatus((current) => ({ configured: current?.configured ?? true, authenticated: false, expiresAt: null }))
    })
    void refresh()
    const interval = window.setInterval(() => void refresh(), 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      setUnauthorizedHandler(() => {})
    }
  }, [paired, native, pairingGeneration])

  // This phone's own calendars are pushed while the app is open: on launch, and
  // on every return from the background. Android grants no dependable
  // background execution, so there is no schedule beyond that — which is what
  // the calendar section tells the parent in as many words.
  useEffect(() => {
    if (!native || !paired || status?.authenticated !== true) return
    return startPhoneCalendarSyncTriggers()
  }, [native, paired, status?.authenticated, pairingGeneration])

  const unpair = () => {
    cancelPhoneCalendarSync()
    disconnectFromHousehold()
    setStatus(null)
    setSection('home')
    setPairingGeneration((generation) => generation + 1)
  }

  // Three ways an app is not usable yet: never paired, pointed at nothing, or
  // revoked from another device. All three want the same screen, and the
  // browser reaches none of them.
  if (native && (!paired || status?.authenticated === false)) {
    return <PairingScreen onPaired={(next) => { setStatus(next); setPairingGeneration((generation) => generation + 1) }} />
  }
  if (status === null) return <LoadingScreen />
  if (!status.authenticated) {
    return <PinScreen configured={status.configured} onAuthenticated={setStatus} />
  }

  const active = SECTIONS.find((item) => item.id === section)!

  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-4 pb-6" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
      <header className="flex items-center justify-between gap-3 py-3">
        <div>
          <p className="text-xs font-extrabold tracking-[0.18em] text-ember uppercase">OpenSkyLight</p>
          <h1 className="font-display text-3xl font-semibold">{active.label}</h1>
        </div>
        <button type="button" className="pressable min-h-11 rounded-xl px-3 text-sm font-extrabold text-ink-soft" onClick={() => void signOut(setStatus)}>
          Sign out
        </button>
      </header>

      <main className="flex-1 py-3">
        <section key={section} className="animate-rise" aria-labelledby="section-title">
          {section !== 'household' && section !== 'calendar' && section !== 'chores' && section !== 'planning' && section !== 'displays' && <Card>
            <p className="text-xs font-extrabold tracking-[0.16em] text-ember uppercase">Administration</p>
            <h2 id="section-title" className="mt-1 font-display text-2xl font-semibold">{active.label}</h2>
            <p className="mt-2 text-base leading-6 text-ink-soft">{active.description}. Setup tools will appear here as they are added.</p>
          </Card>}
          {section === 'home' && <><WeatherLocation /><AdminOverview onNavigate={setSection} /></>}
          {(section === 'household' || section === 'calendar') && <PeopleCalendarsPage section={section} />}
          {section === 'chores' && <ChoresRewardsAdminPage />}
          {section === 'planning' && <ListsMealsAdminPage />}
          {section === 'displays' && <DisplaysDiagnosticsPage onUnpair={native ? unpair : undefined} />}
        </section>
      </main>

      <nav className="sticky bottom-0 grid grid-cols-3 gap-1 rounded-2xl border border-line bg-card p-1 shadow-card" aria-label="Administration navigation">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSection(item.id)}
            aria-current={section === item.id ? 'page' : undefined}
            className={`pressable flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-extrabold ${
              section === item.id ? 'bg-paper-deep text-ember' : 'text-ink-faint'
            }`}
          >
            <span className="text-base leading-none" aria-hidden="true">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

function WeatherLocation() {
  const [label, setLabel] = useState(''); const [lat, setLat] = useState(''); const [lon, setLon] = useState(''); const [timezone, setTimezone] = useState(''); const [saved, setSaved] = useState(false); const [error, setError] = useState<string | null>(null); const [results, setResults] = useState<Array<{ label: string; lat: number; lon: number }>>([]); const [searching, setSearching] = useState(false)
  useEffect(() => { void parentGet<{ timezone: string; weather: { label: string; lat: number; lon: number } | null }>('/api/v1/household/settings').then((settings) => { setTimezone(settings.timezone); if (settings.weather) { setLabel(settings.weather.label); setLat(String(settings.weather.lat)); setLon(String(settings.weather.lon)) } }).catch(() => undefined) }, [])
  const save = async (event: FormEvent) => { event.preventDefault(); setSaved(false); setError(null); const parsedLat = Number(lat); const parsedLon = Number(lon); if (!timezone.trim() || !label.trim() || !Number.isFinite(parsedLat) || !Number.isFinite(parsedLon)) { setError('Enter a valid IANA timezone, location name, latitude, and longitude.'); return }; try { await parentMutation('/api/v1/household/settings', 'PATCH', { timezone: timezone.trim(), weather: { label, lat: parsedLat, lon: parsedLon } }); setSaved(true) } catch (reason) { setError(reason instanceof ApiError ? reason.message : 'Could not save household settings.') } }
  const search = async () => { if (label.trim().length < 2) return; setSearching(true); setError(null); try { setResults((await parentGet<{ locations: Array<{ label: string; lat: number; lon: number }> }>(`/api/v1/weather/locations?q=${encodeURIComponent(label)}`)).locations) } catch (reason) { setError(reason instanceof ApiError ? reason.message : 'Could not search locations.') } finally { setSearching(false) } }
  return <Card className="mt-4"><form className="space-y-3" onSubmit={save}><h2 className="font-display text-xl font-semibold">Household location & time</h2><p className="text-sm leading-5 text-ink-soft">This timezone controls the household day used by chore completion and all displays.</p><label className="block"><span className="mb-1 block text-sm font-extrabold">Time zone</span><TextInput value={timezone} onChange={(value) => { setTimezone(value); setSaved(false) }} placeholder="e.g. Australia/Perth" /></label><label className="block"><span className="mb-1 block text-sm font-extrabold">Town or city</span><div className="flex gap-2"><TextInput value={label} onChange={(value) => { setLabel(value); setSaved(false) }} placeholder="e.g. Fremantle" /><GhostButton onClick={() => void search()}>{searching ? 'Searching…' : 'Search'}</GhostButton></div></label>{results.length > 0 && <div className="overflow-hidden rounded-xl border border-line">{results.map((result) => <button key={`${result.lat},${result.lon}`} type="button" className="block min-h-11 w-full border-b border-line px-3 py-2 text-left font-semibold last:border-0 hover:bg-paper-deep" onClick={() => { setLabel(result.label); setLat(String(result.lat)); setLon(String(result.lon)); setResults([]); setSaved(false) }}>{result.label}<span className="block text-xs text-ink-faint">{result.lat.toFixed(3)}, {result.lon.toFixed(3)}</span></button>)}</div>}<details><summary className="cursor-pointer text-sm font-extrabold text-ink-soft">Advanced coordinates</summary><div className="mt-2 grid grid-cols-2 gap-2"><label className="text-sm font-extrabold">Latitude<TextInput value={lat} onChange={setLat} inputMode="text" placeholder="-32.056" /></label><label className="text-sm font-extrabold">Longitude<TextInput value={lon} onChange={setLon} inputMode="text" placeholder="115.745" /></label></div></details><GhostButton onClick={() => navigator.geolocation?.getCurrentPosition((position) => { setLat(String(position.coords.latitude)); setLon(String(position.coords.longitude)); setSaved(false); setResults([]) }, () => setError('Location permission was not available. Search instead.'))}>Use this phone’s coordinates</GhostButton>{error && <p className="text-sm font-bold text-red-800">{error}</p>}{saved && <p className="text-sm font-bold text-green-800">Household settings saved.</p>}<PrimaryButton type="submit">Save household settings</PrimaryButton></form></Card>
}

function LoadingScreen() {
  return <div className="flex min-h-full items-center justify-center p-6 text-center text-base font-bold text-ink-faint">Opening your household…</div>
}

function PinScreen({ configured, onAuthenticated }: { configured: boolean; onAuthenticated: (status: ParentAuthStatus) => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const isValid = /^\d{4,64}$/.test(pin)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!isValid || busy) return
    setBusy(true)
    setError(null)
    try {
      onAuthenticated(await (configured ? loginParent(pin) : setupParentPin(pin)))
    } catch (reason) {
      if (reason instanceof ApiError) {
        setError(reason.retryAfterSeconds === undefined ? reason.message : `${reason.message} Please try again in ${reason.retryAfterSeconds} seconds.`)
      } else {
        setError('Could not reach the household server. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md items-center p-5" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))', paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
      <Card className="w-full p-6">
        <p className="text-xs font-extrabold tracking-[0.18em] text-ember uppercase">OpenSkyLight</p>
        <h1 className="mt-2 font-display text-3xl font-semibold">{configured ? 'Parent sign in' : 'Set your household PIN'}</h1>
        <p className="mt-3 text-base leading-6 text-ink-soft">{configured ? 'Enter your household PIN to manage OpenSkyLight.' : 'Choose a PIN with at least 4 digits. It protects household settings on your local network.'}</p>
        <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
          <label className="block">
            <span className="mb-2 block text-sm font-extrabold text-ink-soft">Household PIN</span>
            <input
              aria-describedby={error === null ? 'pin-help' : 'pin-error'}
              aria-invalid={error === null ? undefined : true}
              autoComplete={configured ? 'current-password' : 'new-password'}
              autoFocus
              className="min-h-14 w-full rounded-xl border border-line bg-paper px-4 text-xl font-bold tracking-[0.35em] outline-none focus:border-ember"
              inputMode="numeric"
              maxLength={64}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
              pattern="[0-9]*"
              type="password"
              value={pin}
            />
            <span id="pin-help" className="mt-2 block text-sm font-semibold text-ink-faint">Digits only, 4 to 64 characters.</span>
          </label>
          {error !== null && <p id="pin-error" className="rounded-xl bg-red-100 p-3 text-sm font-bold text-red-800" role="alert">{error}</p>}
          <PrimaryButton type="submit" disabled={!isValid || busy}>{busy ? 'Please wait…' : configured ? 'Sign in' : 'Create PIN and continue'}</PrimaryButton>
        </form>
      </Card>
    </main>
  )
}

function AdminOverview({ onNavigate }: { onNavigate: (section: SectionId) => void }) {
  return (
    <div className="mt-4 grid gap-3">
      {SECTIONS.filter((item) => item.id !== 'home').map((item) => (
        <button key={item.id} type="button" onClick={() => onNavigate(item.id)} className="pressable flex min-h-16 items-center gap-3 rounded-card bg-card p-4 text-left shadow-card">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-paper-deep text-xl text-ember" aria-hidden="true">{item.icon}</span>
          <span><span className="block font-display text-lg font-semibold">{item.label}</span><span className="block text-sm font-semibold text-ink-faint">{item.description}</span></span>
        </button>
      ))}
    </div>
  )
}

async function signOut(setStatus: (status: ParentAuthStatus) => void) {
  try {
    await logoutParent()
  } finally {
    setStatus({ configured: true, authenticated: false, expiresAt: null })
  }
}
