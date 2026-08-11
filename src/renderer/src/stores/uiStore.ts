import { create } from 'zustand'
import { DateTime } from 'luxon'
import type { CalendarViewKind } from '@shared/types'
import { personContext, type ViewingContext } from '@shared/viewingContext'

/**
 * The kiosk's calendar must follow the household clock, rather than the
 * timezone configured on the display device.  A Pi image commonly defaults to
 * UTC, which otherwise makes it submit yesterday's chore date after local
 * midnight.
 */
export let ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

export function setHouseholdZone(zone: string): void {
  ZONE = zone
}

interface UiState {
  view: CalendarViewKind
  /** The timezone currently supplied by the authenticated household server. */
  timezone: string
  /** YYYY-MM-DD in the current household timezone. */
  focusedDate: string
  /** Ephemeral by design: every fresh kiosk launch begins in Family. */
  viewingContext: ViewingContext
  settingsOpen: boolean

  setView(view: CalendarViewKind): void
  setFocusedDate(date: string): void
  goToday(): void
  step(direction: 1 | -1): void
  selectFamily(): void
  selectPerson(id: string): void
  setSettingsOpen(open: boolean): void
  setHouseholdClock(zone: string, date: string): void
}

const today = (): string => DateTime.now().setZone(ZONE).toISODate()!

export const useUi = create<UiState>((set, get) => ({
  view: 'home',
  timezone: ZONE,
  focusedDate: today(),
  viewingContext: 'family',
  settingsOpen: false,

  setView: (view) => set({ view }),
  setFocusedDate: (focusedDate) => set({ focusedDate }),
  goToday: () => set({ focusedDate: today() }),
  step: (direction) => {
    const { view, focusedDate } = get()
    if (view === 'home' || view === 'lists') return
    const d = DateTime.fromISO(focusedDate, { zone: ZONE })
    const next =
      view === 'day' || view === 'chores'
        ? d.plus({ days: direction })
        : view === 'month'
          ? d.plus({ months: direction })
          : d.plus({ weeks: direction })
    set({ focusedDate: next.toISODate()! })
  },
  selectFamily: () => set({ viewingContext: 'family' }),
  selectPerson: (id) => set({ viewingContext: personContext(id) }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setHouseholdClock: (zone, date) => {
    setHouseholdZone(zone)
    set({ timezone: zone, focusedDate: date })
  }
}))
