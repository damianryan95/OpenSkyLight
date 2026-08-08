import { create } from 'zustand'
import { DateTime } from 'luxon'
import type { CalendarViewKind } from '@shared/types'
import { personContext, type ViewingContext } from '@shared/viewingContext'

export const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

interface UiState {
  view: CalendarViewKind
  /** YYYY-MM-DD in the device zone */
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
}

const today = (): string => DateTime.now().setZone(ZONE).toISODate()!

export const useUi = create<UiState>((set, get) => ({
  view: 'home',
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
  setSettingsOpen: (settingsOpen) => set({ settingsOpen })
}))
