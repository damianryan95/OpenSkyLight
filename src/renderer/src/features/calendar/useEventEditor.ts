import { create } from 'zustand'
import type { OccurrenceDto } from '@shared/types'
import { useAuthStatus } from '../../api/hooks'

/**
 * Which event the display is editing, if any (`N15`).
 *
 * A store rather than local state in each view because all four calendar views
 * open the same editor, and the editor is mounted once at the app shell so it
 * survives a view change mid-edit — a parent who taps "Week" while typing should
 * not silently lose what they typed.
 */
interface EventEditorState {
  open: boolean
  occurrence: OccurrenceDto | null
  /** The day a create was started from, so a new event lands where they tapped. */
  date: string
  edit: (occurrence: OccurrenceDto) => void
  createOn: (date: string) => void
  close: () => void
}

export const useEventEditor = create<EventEditorState>((set) => ({
  open: false,
  occurrence: null,
  date: '',
  edit: (occurrence) => set({ open: true, occurrence, date: '' }),
  createOn: (date) => set({ open: true, occurrence: null, date }),
  close: () => set({ open: false, occurrence: null, date: '' })
}))

/**
 * What a calendar view needs to offer editing, in one call.
 *
 * `editOccurrence` is undefined while the display is locked, which is what lets a
 * view pass it straight to `EventCard`'s optional `onSelect` and get a
 * non-interactive card without writing the condition out again in four places.
 */
export function useCalendarEditing(): {
  unlocked: boolean
  editOccurrence: ((occurrence: OccurrenceDto) => void) | undefined
  createOn: (date: string) => void
} {
  const { data: status } = useAuthStatus()
  const edit = useEventEditor((state) => state.edit)
  const createOn = useEventEditor((state) => state.createOn)
  const unlocked = status?.unlocked === true
  return { unlocked, editOccurrence: unlocked ? edit : undefined, createOn }
}
