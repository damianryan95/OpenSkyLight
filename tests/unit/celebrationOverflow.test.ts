import { describe, expect, it } from 'vitest'
import { celebrationQueueReducer, type CelebrationQueueState } from '../../src/shared/celebration'
import type { CelebrationEvent } from '../../src/shared/api/contract'

const event = (completionId: string): CelebrationEvent => ({
  completionId, choreId: 'chore', personId: 'person', stars: 1,
  completedAt: '2026-01-01T00:00:00Z', initiatingDisplayId: 'display'
})

function enqueueAll(ids: string[]): CelebrationQueueState {
  let state: CelebrationQueueState = { active: null, pending: [], overflowCount: 0 }
  for (const id of ids) state = celebrationQueueReducer(state, { type: 'enqueue', event: event(id) })
  return state
}

describe('celebration queue overflow', () => {
  it('caps the visible backlog at three and counts the rest', () => {
    const state = enqueueAll(['a', 'b', 'c', 'd', 'e'])
    expect(state.active?.completionId).toBe('a')
    expect(state.pending).toHaveLength(2)
    expect(state.overflowCount).toBe(2)
  })

  it('still knows about overflow once the backlog drains', () => {
    // The teamwork summary can only be shown at the moment the queue empties,
    // so the count has to survive every dismiss that gets there.
    let state = enqueueAll(['a', 'b', 'c', 'd', 'e'])
    state = celebrationQueueReducer(state, { type: 'dismiss' })
    state = celebrationQueueReducer(state, { type: 'dismiss' })
    expect(state.overflowCount).toBe(2)

    state = celebrationQueueReducer(state, { type: 'dismiss' })

    expect(state.active).toBeNull()
    expect(state.overflowCount).toBe(2)
  })
})
