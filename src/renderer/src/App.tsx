import { useEffect, useRef } from 'react'
import { usePushInvalidation, useSettings } from './api/hooks'
import { ipcInvoke } from './api/client'
import { isDisplayClient } from './lib/clientMode'
import { useTheme } from './lib/useTheme'
import { usePersonTheme } from './lib/usePersonTheme'
import { useUi } from './stores/uiStore'
import { HomeView } from './features/home/HomeView'
import { Header } from './features/shell/Header'
import { Toasts } from './features/shell/Toasts'
import { UpdateBanner } from './features/shell/UpdateBanner'
import { WeekView } from './features/calendar/WeekView'
import { DayView } from './features/calendar/DayView'
import { MonthView } from './features/calendar/MonthView'
import { AgendaView } from './features/calendar/AgendaView'
import { EventEditorHost } from './features/calendar/EventEditorHost'
import { AddEventFab } from './features/calendar/EditingControls'
import { ChoresView } from './features/chores/ChoresView'
import { ListsView } from './features/lists/ListsView'
import { SettingsSheet } from './features/settings/SettingsSheet'
import { KioskOverlays } from './features/kiosk/KioskOverlays'
import { OskTray } from './components/Osk'
import { PersonalizationPrototype } from './features/personalization/PersonalizationPrototype'

export default function App() {
  // PE01 is intentionally a development-only interaction study. It has no
  // server routes, persistence, or production entry point.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('prototype') === 'personalization') {
    return <PersonalizationPrototype />
  }

  usePushInvalidation()
  useTheme()
  usePersonTheme()

  // A kiosk normally stays open for weeks. Poll the server's bundle digest so
  // a completed deployment replaces the already-loaded bundle without anyone
  // needing to visit the display. The digest, not the release tag: every
  // Portainer build is tagged `dev`, and keying on that left screens stale.
  const displayVersion = useRef<string | null>(null)
  const householdDate = useRef<string | null>(null)
  useEffect(() => {
    if (!isDisplayClient()) return
    let cancelled = false
    const checkForUpdate = async (): Promise<void> => {
      try {
        const { buildId, zone, householdDate: serverDate } = await ipcInvoke('app:getInfo', undefined)
        if (cancelled) return
        // Keep the date used by every display-side chore action in the same
        // household timezone that the server authorizes.  Do not disturb a
        // user who intentionally navigated to a different calendar day.
        const previousDate = householdDate.current
        const state = useUi.getState()
        if (previousDate === null || (previousDate !== serverDate && state.focusedDate === previousDate)) {
          state.setHouseholdClock(zone, serverDate)
        } else if (state.timezone !== zone) {
          state.setHouseholdClock(zone, state.focusedDate)
        }
        householdDate.current = serverDate
        if (displayVersion.current !== null && displayVersion.current !== buildId) {
          window.location.reload()
          return
        }
        displayVersion.current = buildId
      } catch {
        // Keep the current display usable while the server is restarting.
      }
    }
    void checkForUpdate()
    const interval = window.setInterval(() => void checkForUpdate(), 60_000)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [])
  const view = useUi((s) => s.view)
  // Subscribe so changing from the device timezone to the household timezone
  // re-renders date-dependent children even when the date text is identical.
  useUi((s) => s.timezone)
  const { data: settings } = useSettings()

  // Apply the configured default screen once at boot (only if the user
  // hasn't already navigated away from the initial view).
  const bootApplied = useRef(false)
  useEffect(() => {
    if (!settings || bootApplied.current) return
    bootApplied.current = true
    const state = useUi.getState()
    if (settings.defaultView !== state.view && state.view === 'home') {
      state.setView(settings.defaultView)
    }
  }, [settings])

  return (
    <div className="kiosk-app-shell flex h-full flex-col">
      <Header />
      <main className="min-h-0 flex-1">
        {view === 'home' && <HomeView />}
        {view === 'week' && <WeekView />}
        {view === 'day' && <DayView />}
        {view === 'month' && <MonthView />}
        {view === 'agenda' && <AgendaView />}
        {view === 'chores' && <ChoresView />}
        {view === 'lists' && <ListsView />}
      </main>
      <SettingsSheet />
      <EventEditorHost />
      <AddEventFab />
      <OskTray />
      <Toasts />
      <UpdateBanner />
      <KioskOverlays />
    </div>
  )
}
