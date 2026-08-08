import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openServerDatabase } from '../../src/server/db'
import { createGooglePullSynchronizer, type GoogleEventsRemote } from '../../src/server/sync/google'

const directories: string[] = []

function setup(remote: GoogleEventsRemote) {
  const directory = mkdtempSync(join(tmpdir(), 'openskylight-google-pull-'))
  directories.push(directory)
  const db = openServerDatabase(join(directory, 'server.sqlite'))
  const now = '2026-06-01T00:00:00.000Z'
  db.sqlite.prepare('INSERT INTO google_accounts (id, email, refresh_token_enc, scopes, connected_at) VALUES (?, ?, ?, ?, ?)')
    .run('account-1', 'parent@example.test', Buffer.from('encrypted'), 'calendar.readonly', now)
  db.sqlite.prepare('INSERT INTO calendars (id, google_account_id, google_calendar_id, name, selected) VALUES (?, ?, ?, ?, 1)')
    .run('calendar-1', 'account-1', 'family', 'Family')
  return { db, sync: createGooglePullSynchronizer(db.sqlite, remote, () => 'America/Chicago') }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Google pull-only event cache', () => {
  it('converges an initial paginated pull then applies an incremental cancellation without any write request', async () => {
    const requests: Parameters<GoogleEventsRemote['listEvents']>[0][] = []
    let phase = 0
    const { db, sync } = setup({
      async listEvents(input) {
        requests.push(input)
        if (phase++ === 0) return {
          items: [{ id: 'master', etag: 'm1', summary: 'Swimming', start: { dateTime: '2026-06-10T09:00:00-05:00', timeZone: 'America/Chicago' }, end: { dateTime: '2026-06-10T10:00:00-05:00', timeZone: 'America/Chicago' }, recurrence: ['RRULE:FREQ=WEEKLY'], updated: '2026-06-01T00:00:00Z' }],
          nextPageToken: 'page-2'
        }
        if (phase === 2) return {
          items: [{ id: 'master_20260617T140000Z', etag: 'x1', recurringEventId: 'master', originalStartTime: { dateTime: '2026-06-17T09:00:00-05:00', timeZone: 'America/Chicago' }, start: { dateTime: '2026-06-17T11:00:00-05:00', timeZone: 'America/Chicago' }, end: { dateTime: '2026-06-17T12:00:00-05:00', timeZone: 'America/Chicago' }, updated: '2026-06-02T00:00:00Z' }],
          nextSyncToken: 'sync-1'
        }
        return { items: [{ id: 'master_20260617T140000Z', status: 'cancelled', etag: 'x2', recurringEventId: 'master', updated: '2026-06-03T00:00:00Z' }], nextSyncToken: 'sync-2' }
      }
    })

    await expect(sync.pullCalendar('calendar-1')).resolves.toEqual({ changed: true, full: true })
    expect(db.sqlite.prepare('SELECT google_event_id, recurrence, status FROM events ORDER BY google_event_id').all()).toEqual([
      { google_event_id: 'master', recurrence: 'FREQ=WEEKLY', status: 'confirmed' },
      { google_event_id: 'master_20260617T140000Z', recurrence: null, status: 'confirmed' }
    ])
    await expect(sync.pullCalendar('calendar-1')).resolves.toEqual({ changed: true, full: false })
    expect(db.sqlite.prepare("SELECT status FROM events WHERE google_event_id = 'master_20260617T140000Z'").get()).toEqual({ status: 'cancelled' })
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ showDeleted: true, singleEvents: false }),
      expect.objectContaining({ syncToken: 'sync-1', showDeleted: true, singleEvents: false })
    ]))
  })

  it('keeps the complete previous cache and token when any remote page fails', async () => {
    let online = true
    const { db, sync } = setup({
      async listEvents() {
        if (!online) throw new Error('network unavailable')
        return { items: [{ id: 'event-1', etag: 'one', summary: 'Keep me', start: { date: '2026-06-10' }, end: { date: '2026-06-11' } }], nextSyncToken: 'sync-1' }
      }
    })
    await sync.pullCalendar('calendar-1')
    online = false
    await expect(sync.pullCalendar('calendar-1')).rejects.toThrow('network unavailable')
    expect(db.sqlite.prepare('SELECT title, status FROM events').all()).toEqual([{ title: 'Keep me', status: 'confirmed' }])
    expect(db.sqlite.prepare('SELECT sync_token FROM calendars WHERE id = ?').get('calendar-1')).toEqual({ sync_token: 'sync-1' })
  })

  it('does not apply a full-resync absence until the successful snapshot supplies its next token', async () => {
    let complete = true
    const { db, sync } = setup({
      async listEvents() {
        if (!complete) throw new Error('interrupted full sync')
        return { items: [], nextSyncToken: 'fresh-token' }
      }
    })
    db.sqlite.prepare(`INSERT INTO events (id, calendar_id, google_event_id, title, start_at, end_at, timezone, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('old-event', 'calendar-1', 'old-google-event', 'Old', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z', 'UTC', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    complete = false
    await expect(sync.pullCalendar('calendar-1')).rejects.toThrow('interrupted full sync')
    expect(db.sqlite.prepare('SELECT status FROM events WHERE id = ?').get('old-event')).toEqual({ status: 'confirmed' })
    complete = true
    await sync.pullCalendar('calendar-1')
    expect(db.sqlite.prepare('SELECT status FROM events WHERE id = ?').get('old-event')).toEqual({ status: 'cancelled' })
  })
})
