import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openServerDatabase } from '../../src/server/db'
import { createGoogleSyncScheduler, type GooglePullSynchronizer } from '../../src/server/sync/google'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function database() {
  const directory = mkdtempSync(join(tmpdir(), 'osl-google-scheduler-')); directories.push(directory)
  const db = openServerDatabase(join(directory, 'server.sqlite'))
  const now = '2026-08-05T00:00:00.000Z'
  db.sqlite.prepare('INSERT INTO google_accounts (id, email, refresh_token_enc, scopes, connected_at) VALUES (?, ?, ?, ?, ?)').run('account', 'parent@example.test', Buffer.from('encrypted'), 'calendar.readonly', now)
  db.sqlite.prepare('INSERT INTO calendars (id, google_account_id, google_calendar_id, name, selected) VALUES (?, ?, ?, ?, ?)').run('selected', 'account', 'selected-calendar', 'Selected', 1)
  db.sqlite.prepare('INSERT INTO calendars (id, google_account_id, google_calendar_id, name, selected) VALUES (?, ?, ?, ?, ?)').run('unselected', 'account', 'unselected-calendar', 'Unselected', 0)
  return db
}

describe('Google sync scheduler', () => {
  it('pulls only selected calendars, reports safe diagnostics, and invalidates events after changes', async () => {
    const db = database()
    const pulled: string[] = []; const logs: string[] = []; let invalidations = 0
    const synchronizer: GooglePullSynchronizer = { pullCalendar: async (id: string) => { pulled.push(id); return { changed: true, full: true } } }
    const scheduler = createGoogleSyncScheduler({ sqlite: db.sqlite, getSynchronizer: () => synchronizer, onEventsChanged: () => { invalidations += 1 }, logger: { info: (line: string) => logs.push(line), warn: (line: string) => logs.push(line) } })

    await scheduler.syncNow()
    expect(pulled).toEqual(['selected'])
    expect(invalidations).toBe(1)
    expect(logs.map((line) => JSON.parse(line).event)).toEqual(['google.sync.started', 'google.sync.calendar_succeeded', 'google.sync.completed'])
    db.close()
  })

  it('keeps other calendars running when one pull fails without logging provider details', async () => {
    const db = database()
    db.sqlite.prepare('INSERT INTO calendars (id, google_account_id, google_calendar_id, name, selected) VALUES (?, ?, ?, ?, 1)').run('failing', 'account', 'failing-calendar', 'Failing')
    const logs: string[] = []
    const synchronizer: GooglePullSynchronizer = { pullCalendar: async (id: string) => { if (id === 'failing') throw new Error('https://provider.test/?access_token=secret'); return { changed: false, full: false } } }
    const scheduler = createGoogleSyncScheduler({ sqlite: db.sqlite, getSynchronizer: () => synchronizer, onEventsChanged: () => {}, logger: { info: (line: string) => logs.push(line), warn: (line: string) => logs.push(line) } })

    await scheduler.syncNow()
    expect(logs.join('\n')).not.toContain('access_token')
    expect(logs.map((line) => JSON.parse(line).event)).toContain('google.sync.calendar_failed')
    db.close()
  })
})
