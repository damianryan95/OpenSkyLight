import { FormEvent, useEffect, useState } from 'react'
import type { DiscoveredCalendarDto, GoogleAccountDto, PersonDto } from '@shared/api/contract'
import { ApiError, parentGet, parentMutation, parentUpload } from '../api/client'
import { Card, EmptyNote, GhostButton, PersonAvatar, PrimaryButton, TextInput } from '../components/ui'
import { AvatarCropDialog } from '../components/AvatarCropDialog'
import { PERSON_THEME_PACKS, type BuiltInPersonThemeId } from '@shared/personalization'

const COLORS = ['#DC6B49', '#3D8B7A', '#527BC4', '#A66AB0', '#C68A2C', '#57736B']
type GoogleConfiguration = { configured: boolean; unlocked: boolean; redirectUri: string | null }

export function PeopleCalendarsPage({ section }: { section: 'household' | 'calendar' }) {
  const [people, setPeople] = useState<PersonDto[]>([])
  const [peopleError, setPeopleError] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<GoogleAccountDto[]>([])
  const [accountId, setAccountId] = useState<string | null>(null)
  const [calendars, setCalendars] = useState<DiscoveredCalendarDto[]>([])
  const [calendarError, setCalendarError] = useState<string | null>(null)
  const [googleConfiguration, setGoogleConfiguration] = useState<GoogleConfiguration | null>(null)

  const loadPeople = async () => {
    try { setPeople((await parentGet<{ people: PersonDto[] }>('/api/v1/people')).people); setPeopleError(null) }
    catch (reason) { setPeopleError(message(reason)) }
  }
  const loadAccounts = async () => {
    try { setAccounts((await parentGet<{ accounts: GoogleAccountDto[] }>('/api/v1/google/accounts')).accounts); setCalendarError(null) }
    catch (reason) { setCalendarError(message(reason)) }
  }
  const loadGoogleConfiguration = async () => {
    try {
      const configuration = await parentGet<GoogleConfiguration>('/api/v1/google/configuration')
      setGoogleConfiguration(configuration)
      if (configuration.unlocked) await loadAccounts()
    } catch (reason) { setCalendarError(message(reason)) }
  }
  const loadCalendars = async (id: string) => {
    setAccountId(id)
    try { setCalendars((await parentGet<{ calendars: DiscoveredCalendarDto[] }>(`/api/v1/google/accounts/${encodeURIComponent(id)}/calendars`)).calendars); setCalendarError(null) }
    catch (reason) { setCalendarError(message(reason)) }
  }

  useEffect(() => { void loadPeople(); void loadGoogleConfiguration() }, [])

  if (section === 'household') {
    return <PeoplePanel people={people} error={peopleError} onChanged={loadPeople} />
  }
  return <CalendarPanel people={people} accounts={accounts} accountId={accountId} calendars={calendars} error={calendarError} configuration={googleConfiguration}
    onConfigured={async () => { await loadGoogleConfiguration() }}
    onConnect={async () => {
      try {
        const connection = await parentMutation<{ authorizationUrl: string }>('/api/v1/google/connect', 'POST')
        window.location.assign(connection.authorizationUrl)
      } catch (reason) { setCalendarError(message(reason)) }
    }}
    onChoose={loadCalendars}
    onDisconnect={async (id) => { try { await parentMutation(`/api/v1/google/accounts/${encodeURIComponent(id)}`, 'DELETE'); setAccountId(null); setCalendars([]); await loadAccounts() } catch (reason) { setCalendarError(message(reason)) } }}
    onSync={async () => { try { await parentMutation('/api/v1/google/sync', 'POST'); setCalendarError(null) } catch (reason) { setCalendarError(message(reason)) } }}
    onSave={async (calendar) => {
      if (!accountId) return
      try {
        await parentMutation(`/api/v1/google/accounts/${encodeURIComponent(accountId)}/calendars`, 'PUT', {
          calendar: { id: calendar.id, name: calendar.name, color: calendar.color, primary: calendar.primary, readOnly: calendar.readOnly },
          selected: calendar.selected, audiencePersonId: calendar.audiencePersonId
        })
        await loadCalendars(accountId)
      } catch (reason) { setCalendarError(message(reason)) }
    }} />
}

function PeoplePanel({ people, error, onChanged }: { people: PersonDto[]; error: string | null; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [personalizing, setPersonalizing] = useState<string | null>(null)
  return <div className="mt-4 space-y-4">
    <Card>
      <h3 className="font-display text-xl font-semibold">Who is in your household?</h3>
      <p className="mt-2 text-sm leading-5 text-ink-soft">Children’s exact names in a Google event title or description automatically add them to that event. Parent names never do. Give children distinct names so matching stays unambiguous.</p>
    </Card>
    {error && <ErrorNote>{error}</ErrorNote>}
    {people.length === 0 && !adding && <EmptyNote>Add everyone who should have a calendar or chores.</EmptyNote>}
    {people.map((person) => personalizing === person.id
      ? <PersonThemeForm key={person.id} person={person} onCancel={() => setPersonalizing(null)} onSaved={async () => { setPersonalizing(null); await onChanged() }} />
      : editing === person.id
      ? <PersonForm key={person.id} initial={person} submitLabel="Save person" onCancel={() => setEditing(null)} onSubmit={async (input) => { await parentMutation(`/api/v1/people/${encodeURIComponent(person.id)}`, 'PATCH', input); setEditing(null); await onChanged() }} />
      : <Card key={person.id} className="flex items-center gap-3">
          <PersonAvatar name={person.name} color={person.color} avatarUrl={person.avatarUrl} />
          <div className="min-w-0 flex-1"><p className="font-bold">{person.name}</p><p className="text-sm font-semibold text-ink-faint">{person.role === 'child' ? 'Child — included by exact-name matching' : 'Parent — not name-matched'}</p></div>
          <div className="flex shrink-0 flex-col items-end"><button type="button" className="pressable min-h-11 px-2 font-extrabold text-ember" onClick={() => setPersonalizing(person.id)}>Personalize</button><button type="button" className="pressable min-h-9 px-2 text-sm font-extrabold text-ink-soft" onClick={() => setEditing(person.id)}>Edit</button></div>
        </Card>)}
    {adding ? <PersonForm submitLabel="Add person" onCancel={() => setAdding(false)} onSubmit={async (input) => { await parentMutation('/api/v1/people', 'POST', input); setAdding(false); await onChanged() }} />
      : <PrimaryButton onClick={() => setAdding(true)}>Add a person</PrimaryButton>}
  </div>
}

function PersonThemeForm({ person, onCancel, onSaved }: { person: PersonDto; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [themeId, setThemeId] = useState<BuiltInPersonThemeId | null>(person.themeId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [celebrationAssetIds, setCelebrationAssetIds] = useState<string[]>(person.celebrationAssetIds)
  const [celebrationEnabled, setCelebrationEnabled] = useState(person.celebrationEnabled)
  const [duration, setDuration] = useState(person.celebrationDurationMs)
  const save = async () => {
    setBusy(true); setError(null)
    try { await parentMutation(`/api/v1/people/${encodeURIComponent(person.id)}`, 'PATCH', { themeId, celebrationAssetIds, celebrationEnabled, celebrationDurationMs: duration }); await onSaved() }
    catch (reason) { setError(message(reason)) }
    finally { setBusy(false) }
  }
  const addAnimations = async (files: FileList | null) => {
    if (files === null || files.length === 0) return
    setBusy(true); setError(null)
    const uploaded = await Promise.allSettled([...files].map((file) => parentUpload<{ id: string }>('/api/v1/media/celebrations', file)))
    const ids = uploaded.flatMap((result) => result.status === 'fulfilled' ? [result.value.id] : [])
    setCelebrationAssetIds((current) => [...new Set([...current, ...ids])])
    const failure = uploaded.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure !== undefined) setError(message(failure.reason))
    setBusy(false)
  }
  return <Card className="space-y-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-extrabold tracking-[0.14em] text-ember uppercase">Personalize {person.name}</p><h3 className="mt-1 font-display text-2xl font-semibold">Choose a dashboard theme</h3><p className="mt-1 text-sm leading-5 text-ink-soft">This follows {person.name} to every display when their avatar is selected. Family view stays warm and neutral.</p></div><PersonAvatar name={person.name} color={person.color} avatarUrl={person.avatarUrl} /></div>
    <div className="grid grid-cols-1 gap-3"><ThemeChoice id={null} name="OpenSkyLight" description="Warm paper planner" selected={themeId === null} onSelect={setThemeId} />{PERSON_THEME_PACKS.map((pack) => <ThemeChoice key={pack.id} id={pack.id} name={pack.name} description={pack.description} selected={themeId === pack.id} onSelect={setThemeId} />)}</div>
    <div className="rounded-xl border border-line bg-paper-deep/40 p-3"><p className="text-sm font-extrabold">Preview</p><p className="mt-1 text-xs font-semibold text-ink-soft">These samples are isolated previews; they do not restyle parent administration.</p><div className="mt-3 grid grid-cols-2 gap-2"><ThemeSample themeId={themeId} mode="light" /><ThemeSample themeId={themeId} mode="dark" /></div></div>
    <p className="text-sm font-semibold text-ink-faint">Display light, dark, and auto mode remain in each display’s settings.</p>
    <fieldset className="space-y-2 rounded-xl border border-line bg-paper-deep/40 p-3"><legend className="px-1 text-sm font-extrabold">Chore celebrations</legend><p className="text-sm text-ink-soft">Choose several PNG, GIF, or WebP animations (up to 25 MB each). One is picked at random for every completed job. They scale to half the display while keeping their proportions.</p><label className="flex min-h-11 items-center gap-2 font-bold"><input type="checkbox" checked={celebrationEnabled} onChange={(event) => setCelebrationEnabled(event.target.checked)} /> Enable celebrations</label><label className="block text-sm font-extrabold">Duration <select aria-label="Celebration duration" value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="ml-2 rounded border border-line bg-paper p-2"><option value={1500}>1.5 seconds</option><option value={2500}>2.5 seconds</option><option value={3500}>3.5 seconds</option><option value={5000}>5 seconds</option></select></label><label className="block text-sm font-extrabold">Add animations <input type="file" multiple accept="image/png,image/gif,image/webp" disabled={busy} className="mt-1 block w-full text-sm" onChange={(event) => { void addAnimations(event.target.files); event.target.value = '' }} /></label>{celebrationAssetIds.length > 0 && <div className="flex flex-wrap gap-2">{celebrationAssetIds.map((assetId) => <div key={assetId} className="relative"><img className="h-16 w-16 rounded-lg object-contain" src={`/api/v1/media/celebrations/${encodeURIComponent(assetId)}/content`} alt="Celebration preview" /><button type="button" aria-label="Remove animation" className="absolute -right-1 -top-1 rounded-full bg-paper px-1 text-sm font-extrabold text-ember" onClick={() => setCelebrationAssetIds((current) => current.filter((id) => id !== assetId))}>×</button></div>)}</div>}<p className="text-xs font-semibold text-ink-faint">Preview: {person.name} earns stars in the kiosk safe region. Reduced-motion displays use static stars.</p></fieldset>
    {error && <ErrorNote>{error}</ErrorNote>}<div className="flex gap-2"><PrimaryButton onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save personalization'}</PrimaryButton><GhostButton onClick={onCancel}>Cancel</GhostButton></div>
  </Card>
}

function ThemeChoice({ id, name, description, selected, onSelect }: { id: BuiltInPersonThemeId | null; name: string; description: string; selected: boolean; onSelect: (id: BuiltInPersonThemeId | null) => void }) {
  return <button type="button" aria-pressed={selected} onClick={() => onSelect(id)} className={`pressable flex min-h-12 items-center justify-between gap-3 rounded-xl border-2 p-3 text-left ${selected ? 'border-ember bg-ember/10' : 'border-line bg-paper'}`}><span><span className="block font-extrabold">{name}</span><span className="block text-sm font-semibold text-ink-soft">{description}</span></span><span aria-hidden="true" className="text-lg text-ember">{selected ? '✓' : ''}</span></button>
}

function ThemeSample({ themeId, mode }: { themeId: BuiltInPersonThemeId | null; mode: 'light' | 'dark' }) {
  const pack = themeId === null ? null : PERSON_THEME_PACKS.find((candidate) => candidate.id === themeId) ?? null
  const colors = pack === null
    ? mode === 'light' ? { paper: '#f5efe3', card: '#fffdf8', ink: '#34302a', accent: '#d95b3a' } : { paper: '#17130e', card: '#262019', ink: '#ece4d4', accent: '#f08a68' }
    : pack[mode]
  return <div aria-label={`${pack?.name ?? 'OpenSkyLight'} ${mode} preview`} className="rounded-lg p-2" style={{ backgroundColor: colors.paper, color: colors.ink }}><p className="text-[10px] font-extrabold uppercase tracking-wide opacity-70">{mode}</p><div className="mt-2 rounded-md p-2 shadow-sm" style={{ backgroundColor: colors.card }}><p className="text-xs font-extrabold">Today’s jobs</p><div className="mt-2 h-2 rounded-full" style={{ backgroundColor: colors.accent }} /></div></div>
}

function PersonForm({ initial, submitLabel, onSubmit, onCancel }: { initial?: PersonDto; submitLabel: string; onSubmit: (input: { name: string; color: string; role: 'parent' | 'child'; avatarData?: string | null }) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [role, setRole] = useState<'parent' | 'child'>(initial?.role ?? 'child')
  const [color, setColor] = useState(initial?.color ?? COLORS[0])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [avatarData, setAvatarData] = useState<string | null | undefined>(undefined)
  const [cropSource, setCropSource] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!name.trim() || busy) return
    setBusy(true); setError(null)
    try { await onSubmit({ name, color, role, ...(avatarData === undefined ? {} : { avatarData }) }) } catch (reason) { setError(message(reason)) } finally { setBusy(false) }
  }
  return <Card><form onSubmit={submit} className="space-y-3">
    <label className="block"><span className="mb-1 block text-sm font-extrabold">Name</span><TextInput value={name} onChange={setName} autoFocus placeholder="e.g. Alex" /></label>
    <label className="block"><span className="mb-1 block text-sm font-extrabold">Role</span><select value={role} onChange={(event) => setRole(event.target.value as 'parent' | 'child')} className="min-h-11 w-full rounded-xl border border-line bg-paper px-3 font-semibold"><option value="child">Child</option><option value="parent">Parent</option></select></label>
    <fieldset><legend className="mb-1 text-sm font-extrabold">Colour</legend><div className="flex gap-2">{COLORS.map((choice) => <button aria-label={`Use ${choice}`} aria-pressed={color === choice} key={choice} type="button" onClick={() => setColor(choice)} className="h-10 w-10 rounded-full border-4" style={{ backgroundColor: choice, borderColor: color === choice ? 'var(--color-ink)' : 'transparent' }} />)}</div></fieldset>
    <label className="block"><span className="mb-1 block text-sm font-extrabold">Photo</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 8_000_000) { setError('Choose an image smaller than 8 MB.'); return }; const reader = new FileReader(); reader.onload = () => setCropSource(typeof reader.result === 'string' ? reader.result : null); reader.readAsDataURL(file); event.target.value = '' }} className="block w-full text-sm font-semibold" />{(avatarData ?? initial?.avatarUrl) && <div className="mt-2 flex items-center gap-2"><PersonAvatar name={name || initial?.name || ''} color={color} avatarUrl={avatarData === undefined ? initial?.avatarUrl : avatarData} /><button type="button" className="text-sm font-extrabold text-ember" onClick={() => setAvatarData(null)}>Remove photo</button></div>}</label>
    {cropSource && <AvatarCropDialog source={cropSource} onCancel={() => setCropSource(null)} onApply={(result) => { setAvatarData(result); setCropSource(null) }} />}
    {error && <ErrorNote>{error}</ErrorNote>}<div className="flex gap-2"><PrimaryButton type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving…' : submitLabel}</PrimaryButton><GhostButton onClick={onCancel}>Cancel</GhostButton></div>
  </form></Card>
}

function CalendarPanel({ people, accounts, accountId, calendars, error, configuration, onConfigured, onConnect, onChoose, onDisconnect, onSync, onSave }: { people: PersonDto[]; accounts: GoogleAccountDto[]; accountId: string | null; calendars: DiscoveredCalendarDto[]; error: string | null; configuration: GoogleConfiguration | null; onConfigured: () => Promise<void>; onConnect: () => Promise<void>; onChoose: (id: string) => Promise<void>; onDisconnect: (id: string) => Promise<void>; onSync: () => Promise<void>; onSave: (calendar: DiscoveredCalendarDto) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const wrap = (operation: () => Promise<void>) => async () => { setBusy(true); try { await operation() } finally { setBusy(false) } }
  return <div className="mt-4 space-y-4"><Card><h3 className="font-display text-xl font-semibold">Google calendars</h3><p className="mt-2 text-sm leading-5 text-ink-soft">Choose calendars to read into OpenSkyLight. Map each one to Family or one household member. Events remain read-only here; use Google Calendar to edit them.</p></Card>
    {error && <ErrorNote>{error}</ErrorNote>}
    {configuration === null && <EmptyNote>Checking Google Calendar configuration…</EmptyNote>}
    {configuration !== null && !configuration.configured && <GoogleSetupForm onDone={onConfigured} />}
    {configuration?.configured && !configuration.unlocked && <><ErrorNote>Google’s previous configuration cannot be opened. Enter the Google client details again below; existing Google accounts will be disconnected and must be reconnected.</ErrorNote><GoogleSetupForm onDone={onConfigured} replacement /></>}
    {configuration?.unlocked && replacing && <GoogleSetupForm onDone={async () => { setReplacing(false); await onConfigured() }} replacement />}
    {configuration?.unlocked && !replacing && <>
    {accounts.map((account) => <Card key={account.id} className="space-y-3"><div className="flex items-center justify-between gap-2"><div><p className="font-bold">{account.email}</p><p className="text-sm font-semibold text-ink-faint">{account.state === 'connected' ? 'Connected' : 'Reauthorization required'}</p></div><button className="pressable min-h-11 px-2 font-extrabold text-ember" type="button" onClick={wrap(() => onDisconnect(account.id))} disabled={busy}>Disconnect</button></div>{account.error && <p className="text-sm font-bold text-red-800">{account.error}</p>}<GhostButton onClick={wrap(() => onChoose(account.id))}>{accountId === account.id ? 'Refresh calendars' : 'Choose calendars'}</GhostButton></Card>)}
    <div className="flex flex-wrap gap-2"><PrimaryButton onClick={wrap(onConnect)} disabled={busy}>{busy ? 'Please wait…' : accounts.length ? 'Connect another Google account' : 'Connect Google Calendar'}</PrimaryButton>{accounts.length > 0 && <GhostButton onClick={wrap(onSync)}>Sync selected calendars</GhostButton>}</div>
    {accountId && <div className="space-y-3"><h3 className="px-1 font-display text-xl font-semibold">Choose calendars</h3>{calendars.map((calendar) => <CalendarRow key={calendar.id} calendar={calendar} people={people} onSave={onSave} />)}{calendars.length === 0 && <EmptyNote>No calendars were found for this account.</EmptyNote>}</div>}
    <Card><h3 className="font-display text-xl font-semibold">Google OAuth configuration</h3><p className="mt-2 text-sm leading-5 text-ink-soft">Replace the saved Google client with a different Web application client. Disconnect all Google accounts first; replacing the client invalidates the existing connections.</p><GhostButton onClick={() => setReplacing(true)}>Replace Google OAuth setup</GhostButton></Card>
    </>}
  </div>
}

function GoogleSetupForm({ onDone, replacement = false }: { onDone: () => Promise<void>; replacement?: boolean }) {
  const [clientId, setClientId] = useState(''); const [clientSecret, setClientSecret] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(null); try { await parentMutation('/api/v1/google/configuration', 'PUT', { clientId, clientSecret, publicUrl: window.location.origin }); await onDone() } catch (reason) { setError(message(reason)) } finally { setBusy(false) } }
  return <Card><form className="space-y-3" onSubmit={submit}><h3 className="font-display text-xl font-semibold">{replacement ? 'Replace Google OAuth setup' : 'Set up Google OAuth'}</h3><p className="text-sm leading-5 text-ink-soft">Create a Google Cloud <strong>Web application</strong> client. Add this exact Authorized redirect URI in Google Cloud: <code className="break-all">{window.location.origin}/api/v1/google/callback</code>. HTTPS is required except when using localhost. OpenSkyLight automatically creates and retains its own local encryption key.</p><label className="block"><span className="mb-1 block text-sm font-extrabold">Google client ID</span><TextInput value={clientId} onChange={setClientId} /></label><label className="block"><span className="mb-1 block text-sm font-extrabold">Google client secret</span><TextInput type="password" value={clientSecret} onChange={setClientSecret} /></label>{error && <ErrorNote>{error}</ErrorNote>}<PrimaryButton type="submit" disabled={busy || !clientId || !clientSecret}>{busy ? 'Saving…' : replacement ? 'Replace configuration' : 'Save Google configuration'}</PrimaryButton></form></Card>
}

function CalendarRow({ calendar, people, onSave }: { calendar: DiscoveredCalendarDto; people: PersonDto[]; onSave: (calendar: DiscoveredCalendarDto) => Promise<void> }) {
  const [draft, setDraft] = useState(calendar)
  useEffect(() => setDraft(calendar), [calendar])
  const [busy, setBusy] = useState(false)
  const changed = draft.selected !== calendar.selected || draft.audiencePersonId !== calendar.audiencePersonId
  return <Card><div className="flex gap-3"><input aria-label={`Include ${calendar.name}`} className="mt-1 h-6 w-6 accent-ember" type="checkbox" checked={draft.selected} onChange={(event) => setDraft({ ...draft, selected: event.target.checked })} /><div className="min-w-0 flex-1"><p className="font-bold">{calendar.name}{calendar.primary ? ' (primary)' : ''}</p><p className="text-sm font-semibold text-ink-faint">{calendar.readOnly ? 'Read-only Google calendar' : 'Google calendar'}</p>{draft.selected && <label className="mt-3 block"><span className="mb-1 block text-sm font-extrabold">Show events as</span><select aria-label={`Audience for ${calendar.name}`} value={draft.audiencePersonId ?? ''} onChange={(event) => setDraft({ ...draft, audiencePersonId: event.target.value || null })} className="min-h-11 w-full rounded-xl border border-line bg-paper px-3 font-semibold"><option value="">Family — no default person</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}{changed && <PrimaryButton onClick={async () => { setBusy(true); try { await onSave(draft) } finally { setBusy(false) } }} disabled={busy}>{busy ? 'Saving…' : 'Save calendar'}</PrimaryButton>}</div></div></Card>
}

function ErrorNote({ children }: { children: string }) { return <p className="rounded-xl bg-red-100 p-3 text-sm font-bold text-red-800" role="alert">{children}</p> }
function message(reason: unknown): string { return reason instanceof ApiError ? reason.message : 'Could not reach the household server. Please try again.' }
