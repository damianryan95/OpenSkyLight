import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openServerDatabase, type ServerDatabase } from '../../src/server/db'
import { createChoresRewardsService } from '../../src/server/domain/choresRewards'

const directories: string[] = []

function database(): ServerDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'openskylight-chores-'))
  directories.push(directory)
  const db = openServerDatabase(join(directory, 'server.sqlite'))
  db.sqlite.prepare("INSERT INTO people (id, name, color, role, created_at) VALUES ('child-1', 'Ari', '#fff', 'child', '2026-06-01T00:00:00.000Z')").run()
  return db
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('server chores and rewards domain', () => {
  it('allows the same imported icon on multiple chores for one child', () => {
    const db = database()
    const service = createChoresRewardsService(db.sqlite)
    const icon = 'data:image/svg+xml;base64,PHN2Zy8+'
    service.createChore({ title: 'Brush hair', icon, personId: 'child-1', starsValue: 1, dueDate: '2026-06-01' })
    service.createChore({ title: 'Brush teeth', icon, personId: 'child-1', starsValue: 1, dueDate: '2026-06-01' })
    expect(service.listChores().map((chore) => chore.icon)).toEqual([icon, icon])
    db.close()
  })

  it('makes duplicate completion idempotent and records one corresponding award', () => {
    const db = database()
    const service = createChoresRewardsService(db.sqlite, () => '2026-06-10T10:00:00.000Z')
    const choreId = service.createChore({ title: 'Make bed', personId: 'child-1', starsValue: 3, dueDate: '2026-06-01', scheduleRrule: 'FREQ=DAILY' })

    const first = service.complete({ choreId, dueDate: '2026-06-10', actor: 'display', authorizedDate: '2026-06-10' })
    const second = service.complete({ choreId, dueDate: '2026-06-10', actor: 'display', authorizedDate: '2026-06-10' })

    expect(first).toMatchObject({ created: true, balance: 3 })
    expect(second).toMatchObject({ completionId: first.completionId, created: false, balance: 3 })
    expect(db.sqlite.prepare("SELECT count(*) AS count FROM star_ledger WHERE reason = 'chore'").get()).toEqual({ count: 1 })
    db.close()
  })

  it('undoes only the award attached to that completion and is idempotent', () => {
    const db = database()
    const service = createChoresRewardsService(db.sqlite)
    const choreId = service.createChore({ title: 'Dishes', personId: 'child-1', starsValue: 2, dueDate: '2026-06-01', scheduleRrule: 'FREQ=DAILY' })
    service.complete({ choreId, dueDate: '2026-06-10', actor: 'parent' })
    service.complete({ choreId, dueDate: '2026-06-11', actor: 'parent' })

    expect(service.undo({ choreId, dueDate: '2026-06-10', actor: 'parent' })).toMatchObject({ created: true, balance: 2 })
    expect(service.undo({ choreId, dueDate: '2026-06-10', actor: 'parent' })).toMatchObject({ created: false, balance: 2 })
    expect(db.sqlite.prepare('SELECT due_date FROM chore_completions ORDER BY due_date').all()).toEqual([{ due_date: '2026-06-11' }])
    expect(db.sqlite.prepare("SELECT delta FROM star_ledger WHERE reason = 'chore'").all()).toEqual([{ delta: 2 }])
    db.close()
  })

  it('permits parent historical corrections while requiring displays to use their authorized date', () => {
    const db = database()
    const service = createChoresRewardsService(db.sqlite)
    const choreId = service.createChore({ title: 'Homework', personId: 'child-1', starsValue: 1, dueDate: '2026-06-01', scheduleRrule: 'FREQ=DAILY' })

    expect(() => service.complete({ choreId, dueDate: '2026-06-09', actor: 'display', authorizedDate: '2026-06-10' })).toThrow(/authorized household date/)
    expect(service.complete({ choreId, dueDate: '2026-06-09', actor: 'parent' })).toMatchObject({ created: true, balance: 1 })
    db.close()
  })

  it('keeps corrections and redemption debits as append-only ledger entries', () => {
    const db = database()
    const service = createChoresRewardsService(db.sqlite)
    const choreId = service.createChore({ title: 'Vacuum', personId: 'child-1', starsValue: 10, dueDate: '2026-06-01' })
    service.complete({ choreId, dueDate: '2026-06-01', actor: 'parent' })
    expect(service.adjustStars({ personId: 'child-1', delta: -2 })).toBe(8)
    const rewardId = service.createReward({ title: 'Movie night', costStars: 5 })
    service.redeem(rewardId, 'child-1')

    expect(service.balanceOf('child-1')).toBe(3)
    expect(db.sqlite.prepare('SELECT reason, delta FROM star_ledger ORDER BY rowid').all()).toEqual([
      { reason: 'chore', delta: 10 },
      { reason: 'manual_adjust', delta: -2 },
      { reason: 'redemption', delta: -5 }
    ])
    expect(db.sqlite.prepare('SELECT count(*) AS count FROM reward_redemptions').get()).toEqual({ count: 1 })
    db.close()
  })

  it('uses recurrence for due-date validation', () => {
    const db = database()
    const service = createChoresRewardsService(db.sqlite)
    const choreId = service.createChore({ title: 'Bins', personId: 'child-1', starsValue: 1, dueDate: '2026-06-01', scheduleRrule: 'FREQ=WEEKLY;BYDAY=MO,FR' })

    expect(service.isDueOn(choreId, '2026-06-08')).toBe(true)
    expect(service.isDueOn(choreId, '2026-06-09')).toBe(false)
    expect(() => service.complete({ choreId, dueDate: '2026-06-09', actor: 'parent' })).toThrow(/not due/)
    db.close()
  })

  it('publishes one post-commit completion event without coupling notification failure to the completion', () => {
    const db = database()
    const events: unknown[] = []
    const service = createChoresRewardsService(
      db.sqlite,
      () => '2026-06-10T10:00:00.000Z',
      (event) => events.push(event)
    )
    const choreId = service.createChore({ title: 'Feed cat', personId: 'child-1', starsValue: 2, dueDate: '2026-06-10' })

    service.complete({ choreId, dueDate: '2026-06-10', actor: 'display', authorizedDate: '2026-06-10', initiatingDeviceId: 'display-1' })
    service.complete({ choreId, dueDate: '2026-06-10', actor: 'display', authorizedDate: '2026-06-10', initiatingDeviceId: 'display-1' })

    expect(events).toEqual([
      expect.objectContaining({ type: 'chore.completed', choreId, personId: 'child-1', stars: 2, initiatingDeviceId: 'display-1' })
    ])
    const resilientService = createChoresRewardsService(db.sqlite, () => '2026-06-10T10:00:00.000Z', () => {
      throw new Error('event stream unavailable')
    })
    const secondChore = resilientService.createChore({ title: 'Brush teeth', personId: 'child-1', starsValue: 1, dueDate: '2026-06-10' })
    expect(resilientService.complete({ choreId: secondChore, dueDate: '2026-06-10', actor: 'parent' }).balance).toBe(3)
    db.close()
  })
})
