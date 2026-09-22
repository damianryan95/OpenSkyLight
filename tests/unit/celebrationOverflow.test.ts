import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openServerDatabase } from '../../src/server/db'
import { createChoresRewardsService } from '../../src/server/domain/choresRewards'
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

describe('what must never celebrate', () => {
  const dirs: string[] = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'osl-celebrate-'))
    dirs.push(dir)
    const db = openServerDatabase(join(dir, 'c.db'))
    db.sqlite.prepare("INSERT INTO people (id, name, normalized_name, color, role, sort_order, created_at) VALUES ('ava','Ava','ava','#fff','child',0,'2026-01-01T00:00:00Z')").run()
    const events: { type: string }[] = []
    const chores = createChoresRewardsService(db.sqlite, undefined, (event) => { events.push(event) })
    const choreId = chores.createChore({ title: 'Tidy up', personId: 'ava', starsValue: 3, dueDate: '2026-06-15' })
    return { db, chores, choreId, events }
  }

  it('emits exactly one celebration for a completion', () => {
    const { db, chores, choreId, events } = setup()
    chores.complete({ choreId, dueDate: '2026-06-15', actor: 'parent' })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'chore.completed', personId: 'ava', stars: 3 })
    db.close()
  })

  it('never celebrates an idempotent repeat of the same completion', () => {
    const { db, chores, choreId, events } = setup()
    chores.complete({ choreId, dueDate: '2026-06-15', actor: 'parent' })
    chores.complete({ choreId, dueDate: '2026-06-15', actor: 'parent' })
    chores.complete({ choreId, dueDate: '2026-06-15', actor: 'parent' })
    // A child tapping twice must not produce a second celebration.
    expect(events).toHaveLength(1)
    db.close()
  })

  it('never celebrates an undo', () => {
    const { db, chores, choreId, events } = setup()
    chores.complete({ choreId, dueDate: '2026-06-15', actor: 'parent' })
    chores.undo({ choreId, dueDate: '2026-06-15', actor: 'parent' })
    expect(events).toHaveLength(1)
    expect(events.every((event) => event.type === 'chore.completed')).toBe(true)
    db.close()
  })

  it('does not re-enqueue a completion the queue has already seen', () => {
    let state = enqueueAll(['a'])
    state = celebrationQueueReducer(state, { type: 'enqueue', event: event('a') })
    expect(state.pending).toHaveLength(0)
    expect(state.overflowCount).toBe(0)
  })
})
