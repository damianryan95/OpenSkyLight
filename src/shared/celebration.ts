import type { CelebrationEvent } from './api/contract'

export interface CelebrationQueueState {
  active: CelebrationEvent | null
  pending: CelebrationEvent[]
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
    return state.active === null
      ? { active: action.event, pending: state.pending }
      : { active: state.active, pending: [...state.pending, action.event] }
  }
  if (state.pending.length === 0) return { active: null, pending: [] }
  const [active, ...pending] = state.pending
  return { active, pending }
}
