import { useEffect, useState, type FormEvent } from 'react'
import type { DisplayDevice, ParentDeviceDto, RegisteredDisplay, SyncStatus } from '@shared/api/contract'
import { ApiError, listParentDevices, parentGet, parentMutation, revokeParentDevice } from '../api/client'
import { Card, EmptyNote, GhostButton, PrimaryButton, TextInput } from '../components/ui'
import { DEFAULT_HOME_LAYOUT, findFreeSpot, sanitizeLayout, TILE_SPECS } from '@shared/home'
import type { HomeTile, HomeTileType } from '@shared/types'

/** Parent-only device administration. A credential is shown only once, directly
 * after registration, as a fragment-based enrollment link for the kiosk. */
export function DisplaysDiagnosticsPage({ onUnpair }: { onUnpair?: () => void } = {}) {
  const [displays, setDisplays] = useState<DisplayDevice[]>([])
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const load = async () => {
    try {
      const [deviceResult, syncResult] = await Promise.all([
        parentGet<{ displays: DisplayDevice[] }>('/api/v1/displays'),
        parentGet<SyncStatus>('/api/v1/sync/status')
      ])
      setDisplays(deviceResult.displays); setSync(syncResult); setError(null)
    } catch (reason) { setError(message(reason)) }
  }
  useEffect(() => { void load() }, [])
  return <div className="mt-4 space-y-5">
    {error && <ErrorNote>{error}</ErrorNote>}
    <section aria-labelledby="displays-heading"><div className="mb-2 flex items-center justify-between gap-2"><div><h3 id="displays-heading" className="font-display text-xl font-semibold">Displays</h3><p className="text-sm font-semibold text-ink-faint">Each screen has its own name and display settings.</p></div><GhostButton onClick={() => setAdding(true)}>Register display</GhostButton></div>
      {adding && <RegisterDisplay onDone={async () => { setAdding(false); await load() }} onCancel={() => setAdding(false)} />}
      {displays.length === 0 && !adding ? <EmptyNote>No displays are registered yet.</EmptyNote> : displays.map((display) => <DisplayCard key={display.id} display={display} onChanged={load} />)}
    </section>
    <ParentPhones />
    <Diagnostics sync={sync} onRefresh={load} />
    {onUnpair && <UnpairThisPhone onUnpair={onUnpair} />}
  </div>
}

/** The way out of a wedged installed app: a phone revoked from elsewhere, or
 * one connected to an address that turned out to be wrong, would otherwise
 * have to be reinstalled. Present only in the native shell — the browser at
 * `/admin/` has nothing to unpair. */
function UnpairThisPhone({ onUnpair }: { onUnpair: () => void }) {
  const [confirming, setConfirming] = useState(false)
  return <section aria-labelledby="unpair-heading"><div className="mb-2"><h3 id="unpair-heading" className="font-display text-xl font-semibold">This phone</h3><p className="text-sm font-semibold text-ink-faint">Forget the household on this phone and connect it again — to a different address, or after it has been revoked.</p></div>
    <Card>{confirming
      ? <div className="rounded-xl bg-red-50 p-3"><p className="text-sm font-bold text-red-900">Unpair this phone? You will need the household server address and the household PIN to connect it again. It stays listed under Parent phones until someone revokes it there.</p><div className="mt-2 flex gap-2"><button type="button" className="pressable min-h-11 rounded-xl bg-red-700 px-4 font-extrabold text-white" onClick={onUnpair}>Unpair phone</button><GhostButton onClick={() => setConfirming(false)}>Cancel</GhostButton></div></div>
      : <button type="button" className="min-h-11 text-sm font-extrabold text-red-700" onClick={() => setConfirming(true)}>Unpair this phone</button>}</Card>
  </section>
}

/** Paired phones are listed and revoked here, never created here: a phone pairs
 * itself by scanning a screen and proving the household PIN (ADR 0006), so this
 * surface exists purely so a lost phone can be killed from another device. */
function ParentPhones() {
  const [phones, setPhones] = useState<ParentDeviceDto[]>([])
  const [error, setError] = useState<string | null>(null)
  const load = async () => {
    try {
      const result = await listParentDevices()
      setPhones(result.parentDevices); setError(null)
    } catch (reason) { setError(message(reason)) }
  }
  useEffect(() => { void load() }, [])
  return <section aria-labelledby="parent-phones-heading"><div className="mb-2"><h3 id="parent-phones-heading" className="font-display text-xl font-semibold">Parent phones</h3><p className="text-sm font-semibold text-ink-faint">Phones add themselves: scan a screen with the OpenSkyLight app and enter the household PIN. Revoke one here if it is lost or should no longer administer the household.</p></div>
    {error && <ErrorNote>{error}</ErrorNote>}
    {phones.length === 0 && error === null ? <EmptyNote>No phones are paired yet.</EmptyNote> : phones.map((phone) => <ParentPhoneCard key={phone.id} phone={phone} onChanged={load} />)}
  </section>
}

function ParentPhoneCard({ phone, onChanged }: { phone: ParentDeviceDto; onChanged: () => Promise<void> }) {
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const revoke = async () => { if (busy) return; setBusy(true); setError(null); try { await revokeParentDevice(phone.id); setConfirmingRevoke(false); await onChanged() } catch (reason) { setError(message(reason)) } finally { setBusy(false) } }
  return <Card className="mb-3"><div className="flex items-start gap-3"><span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${phone.revokedAt ? 'bg-red-500' : phone.lastSeenAt ? 'bg-green-500' : 'bg-amber-500'}`} aria-hidden="true" /><div className="min-w-0 flex-1"><p className="font-display text-xl font-semibold">{phone.name}</p><p className="text-sm font-semibold text-ink-faint">{phone.revokedAt ? `Revoked ${formatTime(phone.revokedAt)}` : phone.lastSeenAt ? `Last seen ${formatTime(phone.lastSeenAt)}` : `Paired ${formatTime(phone.pairedAt)} — not used yet`}</p></div></div>
    {error && <ErrorNote>{error}</ErrorNote>}
    {!phone.revokedAt && (confirmingRevoke ? <div className="mt-3 rounded-xl bg-red-50 p-3"><p className="text-sm font-bold text-red-900">Revoke {phone.name}? It will immediately lose household access, and it can only get back in with the household PIN.</p><div className="mt-2 flex gap-2"><button type="button" className="pressable min-h-11 rounded-xl bg-red-700 px-4 font-extrabold text-white disabled:opacity-40" disabled={busy} onClick={() => void revoke()}>{busy ? 'Revoking…' : 'Revoke phone'}</button><GhostButton onClick={() => setConfirmingRevoke(false)}>Cancel</GhostButton></div></div> : <button type="button" className="mt-3 min-h-11 text-sm font-extrabold text-red-700" onClick={() => setConfirmingRevoke(true)}>Revoke this phone</button>)}
  </Card>
}

function RegisterDisplay({ onDone, onCancel }: { onDone: () => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(''); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [registered, setRegistered] = useState<RegisteredDisplay | null>(null)
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!name.trim() || busy) return; setBusy(true); setError(null)
    try {
      const result = await parentMutation<RegisteredDisplay>('/api/v1/displays', 'POST', { name: name.trim() })
      setRegistered(result)
    } catch (reason) { setError(message(reason)) } finally { setBusy(false) }
  }
  if (registered !== null) return <EnrollmentLink display={registered} onDone={onDone} />
  return <Card className="mb-3"><form onSubmit={submit} className="space-y-3"><label className="block"><span className="mb-1 block text-sm font-extrabold">Display name</span><TextInput value={name} onChange={setName} autoFocus placeholder="e.g. Kitchen wall" /></label><p className="text-sm leading-5 text-ink-soft">Register a screen, then open its private enrollment link on that screen.</p>{error && <ErrorNote>{error}</ErrorNote>}<div className="flex gap-2"><PrimaryButton type="submit" disabled={!name.trim() || busy}>{busy ? 'Registering…' : 'Register'}</PrimaryButton><GhostButton onClick={onCancel}>Cancel</GhostButton></div></form></Card>
}

function EnrollmentLink({ display, onDone }: { display: RegisteredDisplay; onDone: () => Promise<void> }) {
  const [copied, setCopied] = useState(false)
  const link = `${window.location.origin}/#displayCredential=${encodeURIComponent(display.credential)}&displayId=${encodeURIComponent(display.id)}`
  const copy = async () => {
    await navigator.clipboard.writeText(link)
    setCopied(true)
  }
  return <Card className="mb-3 space-y-3"><p className="font-display text-xl font-semibold">Enroll {display.name}</p><p className="text-sm leading-5 text-ink-soft">Open this private link in the kiosk browser. Its secret stays in the URL fragment and is removed from the address bar after the kiosk saves it locally.</p><TextInput value={link} onChange={() => {}} /><div className="flex gap-2"><PrimaryButton type="button" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy enrollment link'}</PrimaryButton><GhostButton onClick={() => void onDone()}>Done</GhostButton></div><p className="text-sm font-semibold text-amber-800">Treat this link like a password. It is shown only for this registration.</p></Card>
}

function DisplayCard({ display, onChanged }: { display: DisplayDevice; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const revoke = async () => { setBusy(true); setError(null); try { await parentMutation(`/api/v1/displays/${encodeURIComponent(display.id)}/revoke`, 'POST'); setConfirmingRevoke(false); await onChanged() } catch (reason) { setError(message(reason)) } finally { setBusy(false) } }
  return <Card className="mb-3"><div className="flex items-start gap-3"><span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${display.revokedAt ? 'bg-red-500' : display.lastSeenAt ? 'bg-green-500' : 'bg-amber-500'}`} aria-hidden="true" /><div className="min-w-0 flex-1"><p className="font-display text-xl font-semibold">{display.name}</p><p className="text-sm font-semibold text-ink-faint">{display.revokedAt ? `Revoked ${formatTime(display.revokedAt)}` : display.lastSeenAt ? `Last seen ${formatTime(display.lastSeenAt)}` : 'Registered — not connected yet'}</p></div>{!display.revokedAt && <button type="button" className="pressable min-h-11 px-2 font-extrabold text-ember" onClick={() => setEditing((value) => !value)}>Edit</button>}</div>
    {error && <ErrorNote>{error}</ErrorNote>}
    {editing && <DisplaySettingsForm display={display} onSaved={async () => { setEditing(false); await onChanged() }} />}
    {!display.revokedAt && (confirmingRevoke ? <div className="mt-3 rounded-xl bg-red-50 p-3"><p className="text-sm font-bold text-red-900">Disconnect {display.name}? It will immediately lose household access.</p><div className="mt-2 flex gap-2"><button type="button" className="pressable min-h-11 rounded-xl bg-red-700 px-4 font-extrabold text-white disabled:opacity-40" disabled={busy} onClick={() => void revoke()}>{busy ? 'Revoking…' : 'Revoke display'}</button><GhostButton onClick={() => setConfirmingRevoke(false)}>Cancel</GhostButton></div></div> : <button type="button" className="mt-3 min-h-11 text-sm font-extrabold text-red-700" onClick={() => setConfirmingRevoke(true)}>Revoke this display</button>)}
  </Card>
}

function DisplaySettingsForm({ display, onSaved }: { display: DisplayDevice; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(display.name); const [theme, setTheme] = useState(display.themePreference === 'light' || display.themePreference === 'dark' || display.themePreference === 'auto' ? display.themePreference : 'auto')
  const currentSleep = sleep(display.sleepSettings); const [sleepEnabled, setSleepEnabled] = useState(currentSleep.enabled); const [start, setStart] = useState(currentSleep.start); const [end, setEnd] = useState(currentSleep.end)
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  const [layout, setLayout] = useState<HomeTile[]>(() => display.homeLayout === null ? DEFAULT_HOME_LAYOUT.map((tile) => ({ ...tile })) : sanitizeLayout(display.homeLayout))
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(null); try { await parentMutation(`/api/v1/displays/${encodeURIComponent(display.id)}`, 'PATCH', { name: name.trim(), themePreference: theme, sleepSettings: { enabled: sleepEnabled, start, end }, homeLayout: layout }); await onSaved() } catch (reason) { setError(message(reason)) } finally { setBusy(false) } }
  return <form onSubmit={submit} className="mt-4 space-y-3 border-t border-line pt-3"><label className="block"><span className="mb-1 block text-sm font-extrabold">Name</span><TextInput value={name} onChange={setName} /></label><label className="block"><span className="mb-1 block text-sm font-extrabold">Theme</span><select aria-label={`Theme for ${display.name}`} value={theme} onChange={(event) => setTheme(event.target.value as 'light' | 'dark' | 'auto')} className="min-h-11 w-full rounded-xl border border-line bg-paper px-3 font-semibold"><option value="auto">Auto</option><option value="light">Light</option><option value="dark">Dark</option></select></label><LayoutEditor layout={layout} onChange={setLayout} /><label className="flex min-h-11 items-center gap-2 font-extrabold"><input aria-label={`Enable sleep for ${display.name}`} className="h-5 w-5 accent-ember" type="checkbox" checked={sleepEnabled} onChange={(event) => setSleepEnabled(event.target.checked)} />Sleep this display</label>{sleepEnabled && <div className="grid grid-cols-2 gap-2"><label className="text-sm font-extrabold">Start<input aria-label={`Sleep start for ${display.name}`} type="time" value={start} onChange={(event) => setStart(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-paper px-3" /></label><label className="text-sm font-extrabold">End<input aria-label={`Sleep end for ${display.name}`} type="time" value={end} onChange={(event) => setEnd(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-paper px-3" /></label></div>}<p className="text-sm leading-5 text-ink-faint">Only parent administration can change a display layout. The kiosk can still only tick today’s chores.</p>{error && <ErrorNote>{error}</ErrorNote>}<PrimaryButton type="submit" disabled={!name.trim() || busy}>{busy ? 'Saving…' : 'Save display settings'}</PrimaryButton></form>
}

function LayoutEditor({ layout, onChange }: { layout: HomeTile[]; onChange: (layout: HomeTile[]) => void }) {
  const add = (type: HomeTileType) => { const spec = TILE_SPECS[type]; const spot = findFreeSpot(layout, spec.minW, spec.minH); if (spot) onChange([...layout, { id: `${type}-${crypto.randomUUID()}`, type, ...spot, w: spec.minW, h: spec.minH }]) }
  return <fieldset className="space-y-2 rounded-xl bg-paper-deep/50 p-3"><legend className="px-1 text-sm font-extrabold">Home screen tiles</legend><p className="text-sm text-ink-soft">Remove tiles to make room, or add a compact tile to the first free space.</p>{layout.map((tile) => <div key={tile.id} className="flex items-center justify-between gap-2 rounded-lg bg-card px-2 py-1"><span className="font-bold">{tile.type === 'weekAgenda' ? 'This week' : tile.type === 'choresProgress' ? 'Chores today' : tile.type === 'familyChores' ? 'Family chores' : tile.type === 'familyRewards' ? 'Family rewards' : tile.type}</span><button type="button" className="min-h-10 px-2 text-sm font-extrabold text-red-700" onClick={() => onChange(layout.filter((candidate) => candidate.id !== tile.id))}>Remove</button></div>)}<div className="flex flex-wrap gap-2"><button type="button" className="min-h-10 rounded-lg bg-card px-3 text-sm font-extrabold" onClick={() => onChange(DEFAULT_HOME_LAYOUT.map((tile) => ({ ...tile })))}>Restore recommended</button>{(['weekAgenda', 'weather', 'meals', 'starBalances', 'choresProgress', 'familyChores', 'familyRewards'] as HomeTileType[]).map((type) => <button key={type} type="button" className="min-h-10 rounded-lg bg-card px-3 text-sm font-extrabold" onClick={() => add(type)}>Add {type === 'weekAgenda' ? 'week' : type === 'familyChores' ? 'family chores' : type === 'familyRewards' ? 'family rewards' : type}</button>)}</div></fieldset>
}

function Diagnostics({ sync, onRefresh }: { sync: SyncStatus | null; onRefresh: () => Promise<void> }) {
  const title = sync === null ? 'Checking server…' : sync.state === 'not_configured' ? 'No calendar is connected yet' : sync.state === 'fresh' ? 'Calendar is current' : sync.state === 'syncing' ? 'Calendar sync in progress' : sync.state === 'stale' ? 'Cached calendar data is stale' : sync.state === 'failed' ? 'Calendar sync needs attention' : 'Calendar has not synced yet'
  return <section aria-labelledby="diagnostics-heading"><div className="mb-2 flex items-center justify-between"><h3 id="diagnostics-heading" className="font-display text-xl font-semibold">Diagnostics</h3><GhostButton onClick={() => void onRefresh()}>Refresh</GhostButton></div><Card><p className="font-bold">Server reachable</p><p className="mt-1 text-sm font-semibold text-ink-faint">This phone can reach the household server.</p><div className="mt-4 border-t border-line pt-3"><p className="font-bold">{title}</p>{sync && <><p className="mt-1 text-sm font-semibold text-ink-faint">Last successful sync: {sync.lastSucceededAt ? formatTime(sync.lastSucceededAt) : 'Never'}</p>{(sync.calendars ?? []).some((calendar) => calendar.error) && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm font-bold text-amber-900">Calendar data remains cached. Check the calendar connection and try sync again.</p>}</>}</div></Card></section>
}

function sleep(value: unknown): { enabled: boolean; start: string; end: string } { return typeof value === 'object' && value !== null && typeof (value as { enabled?: unknown }).enabled === 'boolean' && typeof (value as { start?: unknown }).start === 'string' && typeof (value as { end?: unknown }).end === 'string' ? value as { enabled: boolean; start: string; end: string } : { enabled: false, start: '21:30', end: '06:30' } }
function formatTime(value: string): string { const time = new Date(value); return Number.isNaN(time.getTime()) ? 'Unknown' : time.toLocaleString() }
function ErrorNote({ children }: { children: string }) { return <p className="mt-3 rounded-xl bg-red-100 p-3 text-sm font-bold text-red-800" role="alert">{children}</p> }
function message(reason: unknown): string { return reason instanceof ApiError ? reason.message : 'Could not reach the household server. Please try again.' }
