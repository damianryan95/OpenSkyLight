import type { CelebrationEvent } from './api/contract'

export interface CelebrationQueueState {
  active: CelebrationEvent | null
  pending: CelebrationEvent[]
  overflowCount?: number
}

export type CelebrationQueueAction =
  | { type: 'enqueue'; event: CelebrationEvent }
  | { type: 'dismiss' }

/** The initiating display is the default (and only) celebration recipient. */
export function isCelebrationForDisplay(event: CelebrationEvent, currentDisplayId: string | null): boolean {
  return event.initiatingDisplayId !== null && event.initiatingDisplayId === currentDisplayId
}

/** FIFO lifecycle isolated from the eventual animation implementation. */
export function celebrationQueueReducer(state: CelebrationQueueState, action: CelebrationQueueAction): CelebrationQueueState {
  if (action.type === 'enqueue') {
    if (state.active?.completionId === action.event.completionId || state.pending.some((event) => event.completionId === action.event.completionId)) return state
    // At most three individual celebrations (active plus two waiting) can be
    // retained; later completions are represented by one bounded summary.
    if (state.active !== null && state.pending.length >= 2) return { ...state, overflowCount: (state.overflowCount ?? 0) + 1 }
    return state.active === null
      ? { active: action.event, pending: state.pending, overflowCount: state.overflowCount }
      : { active: state.active, pending: [...state.pending, action.event], overflowCount: state.overflowCount }
  }
  if (state.pending.length === 0) return { active: null, pending: [] }
  const [active, ...pending] = state.pending
  return { active, pending, overflowCount: state.overflowCount }
}
