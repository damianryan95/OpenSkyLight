import { describe, expect, it } from 'vitest'
import { celebrationQueueReducer, isCelebrationForDisplay, type CelebrationQueueState } from '../../src/shared/celebration'
import type { CelebrationEvent } from '../../src/shared/api/contract'

const first: CelebrationEvent = {
  completionId: 'complete-1', choreId: 'chore-1', personId: 'person-1', stars: 2,
  completedAt: '2026-08-04T00:00:00.000Z', initiatingDisplayId: 'kitchen'
}
const second: CelebrationEvent = { ...first, completionId: 'complete-2', choreId: 'chore-2', stars: 3 }
const empty: CelebrationQueueState = { active: null, pending: [] }

describe('CelebrationOverlay seam', () => {
  it('routes an event only to its initiating display', () => {
    expect(isCelebrationForDisplay(first, 'kitchen')).toBe(true)
    expect(isCelebrationForDisplay(first, 'bedroom')).toBe(false)
    expect(isCelebrationForDisplay({ ...first, initiatingDisplayId: null }, 'kitchen')).toBe(false)
  })

  it('has a deterministic FIFO lifecycle for rapid completions and dismissals', () => {
    const queued = celebrationQueueReducer(celebrationQueueReducer(empty, { type: 'enqueue', event: first }), { type: 'enqueue', event: second })
    expect(queued).toEqual({ active: first, pending: [second] })
    const next = celebrationQueueReducer(queued, { type: 'dismiss' })
    expect(next).toEqual({ active: second, pending: [] })
    expect(celebrationQueueReducer(next, { type: 'dismiss' })).toEqual(empty)
  })

  it('keeps queue transitions local when a placeholder subscriber/view fails', () => {
    // Completion was already committed before SSE delivery; reducer operations
    // neither call a command nor throw when moving to the next item.
    expect(() => celebrationQueueReducer({ active: first, pending: [second] }, { type: 'dismiss' })).not.toThrow()
  })
})
