import { useEffect, useState, useSyncExternalStore } from 'react'
import { Card, GhostButton, PrimaryButton } from './ui'
import {
  getPhoneSyncState,
  grantPhoneCalendarPermission,
  initialisePhoneSyncState,
  refreshPhoneCalendarPermission,
  subscribeToPhoneSync,
  syncPhoneCalendars
} from '../api/phoneCalendarSync'
import { SYNC_WINDOW_FUTURE_DAYS, SYNC_WINDOW_PAST_DAYS } from '../api/phoneCalendarMapping'

/**
 * This phone's own calendars, in the section where every other calendar lives.
 *
 * The panel exists to say three things before a parent trips over them: what
 * OpenSkyLight reads, that it reads it only while the app is open, and that a
 * household needing better than that adds a calendar account instead. Saying
 * any of that in an error afterwards would be too late to act on.
 */
export function PhoneCalendarsCard({ onSynced }: { onSynced: () => Promise<void> }) {
  const state = useSyncExternalStore(subscribeToPhoneSync, getPhoneSyncState)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    initialisePhoneSyncState()
    // The parent may have changed calendar permission in system settings while
    // the app sat in the background, so believe the OS over what we last saw.
    // The answer lands in the sync service's own store rather than in this
    // component's state, so there is nothing to unwind if it unmounts first.
    void refreshPhoneCalendarPermission().catch(() => undefined)
  }, [])

  if (!state.supported) return null

  const busy = state.phase === 'syncing' || requesting
  const granted = state.permission === 'granted'

  const request = async () => {
    if (requesting) return
    setRequesting(true)
    try { await grantPhoneCalendarPermission(); await onSynced() } finally { setRequesting(false) }
  }

  const syncNow = async () => {
    if (busy) return
    await syncPhoneCalendars({ force: true })
    // The board's view of which calendars are shared changes with a push, and
    // the list below this card is what the parent maps people onto.
    await onSynced()
  }

  return <Card className="space-y-3">
    <div>
      <h3 className="font-display text-xl font-semibold">This phone’s calendars</h3>
      <p className="mt-2 text-sm leading-5 text-ink-soft">
        OpenSkyLight can read the calendars already on this phone and show them on your display. It reads them only — it never adds, changes, or deletes anything in your phone’s calendar — and it sends the next {SYNC_WINDOW_FUTURE_DAYS} days and the past {SYNC_WINDOW_PAST_DAYS} to your own household server. No account, password, or app password is needed.
      </p>
    </div>

    <p className="rounded-xl bg-paper-deep/60 p-3 text-sm leading-5 text-ink-soft">
      <strong className="font-extrabold">Worth knowing:</strong> phones do not let apps run in the background whenever they like, so this phone’s calendar is sent while the app is open and not while it is closed. If your display needs to be right to the minute without anyone touching this phone, connect your calendar account under “Connect a calendar account” below as well — the two work side by side, and shared events are not shown twice.
    </p>

    {state.permission === 'unknown' && <p className="text-sm font-semibold text-ink-faint">Checking what this phone allows…</p>}

    {state.permission === 'prompt' && <div className="space-y-2">
      <p className="text-sm font-semibold text-ink-soft">Your phone will ask you to allow calendar access. Nothing is sent until you do.</p>
      <PrimaryButton onClick={() => void request()} disabled={requesting}>{requesting ? 'Waiting for your phone…' : 'Allow calendar access'}</PrimaryButton>
    </div>}

    {state.permission === 'denied' && <div className="space-y-2">
      <p className="rounded-xl bg-red-100 p-3 text-sm font-bold text-red-800" role="alert">
        Calendar access is turned off for OpenSkyLight, so this phone has no calendars to share yet. Open your phone’s Settings, then Apps, then OpenSkyLight, then Permissions, and allow Calendar. Come back here and tap “Check again”.
      </p>
      <GhostButton onClick={() => void refreshPhoneCalendarPermission().then(() => undefined)}>Check again</GhostButton>
    </div>}

    {state.permission === 'unavailable' && <p className="rounded-xl bg-red-100 p-3 text-sm font-bold text-red-800" role="alert">
      This phone did not answer when OpenSkyLight asked about its calendars. Close the app fully and open it again. If that does not help, connect your calendar account under “Connect a calendar account” below instead — it does not depend on this phone at all.
    </p>}

    {granted && <div className="space-y-3">
      <div>
        <p className="text-sm font-extrabold">{state.calendars.length === 0 ? 'No calendars found on this phone' : `Found on this phone (${state.calendars.length})`}</p>
        {state.calendars.length === 0
          ? <p className="mt-1 text-sm font-semibold text-ink-faint">Your phone reports no calendars at all. Add one in your phone’s calendar app, then tap “Sync now”.</p>
          : <ul className="mt-2 space-y-1">
              {state.calendars.map((calendar) => <li key={calendar.sourceCalendarId} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate font-bold">{calendar.name}</span>
                <span className="shrink-0 font-semibold text-ink-faint">{calendar.shared ? `${calendar.events} on the board` : 'Not shown'}</span>
              </li>)}
            </ul>}
        {state.calendars.length > 0 && <p className="mt-2 text-sm leading-5 text-ink-soft">
          Choose which of these appear on your display, and who they belong to, under <strong className="font-extrabold">{`“Choose calendars”`}</strong> on this phone’s entry below.
        </p>}
      </div>

      {state.omittedCalendars > 0 && <p className="text-sm font-semibold text-ink-faint">
        This phone holds more than 50 calendars. The first 50 by name are shared; the other {state.omittedCalendars} are not.
      </p>}

      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton onClick={() => void syncNow()} disabled={busy}>{state.phase === 'syncing' ? 'Sending…' : 'Sync now'}</PrimaryButton>
        <p className="text-sm font-semibold text-ink-faint">{describeLastPush(state.lastPushedAt)}</p>
      </div>
    </div>}

    {state.lastError !== null && <p className="rounded-xl bg-red-100 p-3 text-sm font-bold text-red-800" role="alert">{state.lastError}</p>}
  </Card>
}

/** A timestamp is not an answer to "is my calendar on the wall?" — how long ago
 * it was is. */
function describeLastPush(lastPushedAt: string | null): string {
  if (lastPushedAt === null) return 'Not sent to your household yet.'
  const elapsed = Date.now() - Date.parse(lastPushedAt)
  if (!Number.isFinite(elapsed) || elapsed < 0) return 'Sent to your household.'
  if (elapsed < 60_000) return 'Sent to your household just now.'
  if (elapsed < 3_600_000) return `Sent to your household ${Math.round(elapsed / 60_000)} minutes ago.`
  if (elapsed < 86_400_000) return `Sent to your household ${Math.round(elapsed / 3_600_000)} hours ago.`
  return `Sent to your household ${Math.round(elapsed / 86_400_000)} days ago.`
}
