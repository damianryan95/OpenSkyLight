import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { openServerDatabase } from '../../src/server/db'
import { createGooglePullSynchronizer, createGoogleSyncStatusService, GOOGLE_SYNC_STALE_AFTER_MS, type GoogleEventsRemote } from '../../src/server/sync/google'
import { handleApiRequest } from '../../src/server/api/router'

const directories: string[] = []
let time = new Date('2026-08-02T00:00:00.000Z')

function setup(remote?: GoogleEventsRemote) {
  const directory = mkdtempSync(join(tmpdir(), 'openskylight-google-health-'))
  directories.push(directory)
  const db = openServerDatabase(join(directory, 'server.sqlite'))
  db.sqlite.prepare('INSERT INTO google_accounts (id, email, refresh_token_enc, scopes, connected_at) VALUES (?, ?, ?, ?, ?)')
    .run('account-1', 'parent@example.test', Buffer.from('encrypted'), 'calendar.readonly', time.toISOString())
  db.sqlite.prepare('INSERT INTO calendars (id, google_account_id, google_calendar_id, name, selected) VALUES (?, ?, ?, ?, 1)')
    .run('calendar-1', 'account-1', 'family', 'Family')
  const published: unknown[] = []
  const status = createGoogleSyncStatusService(db.sqlite, { now: () => time, publish: (value) => published.push(value) })
  return { db, status, published, sync: remote === undefined ? undefined : createGooglePullSynchronizer(db.sqlite, remote, () => 'UTC', status) }
}

afterEach(() => {
  time = new Date('2026-08-02T00:00:00.000Z')
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Google sync health', () => {
  it('distinguishes never-synced, syncing, fresh, stale, and failed states', () => {
    const { status } = setup()
    expect(status.get().state).toBe('never_synced')
    status.start('calendar-1')
    expect(status.get().state).toBe('syncing')
    status.succeed('calendar-1')
    expect(status.get()).toMatchObject({ state: 'fresh', lastSucceededAt: '2026-08-02T00:00:00.000Z', staleAfter: '2026-08-02T00:15:00.000Z' })
    time = new Date(time.getTime() + GOOGLE_SYNC_STALE_AFTER_MS)
    expect(status.get().state).toBe('stale')
    status.start('calendar-1')
    status.fail('calendar-1')
    expect(status.get()).toMatchObject({ state: 'failed', calendars: [{ error: 'Google calendar sync failed. Cached events are still available.' }] })
  })

  it('retains cached events on failure and clears stale/error state after recovery without exposing remote errors', async () => {
    let online = true
    const { db, status, published, sync } = setup({
      async listEvents() {
        if (!online) throw new Error('refresh_token=do-not-leak')
        return { items: [{ id: 'event', etag: '1', summary: 'Keep this', start: { dateTime: '2026-08-03T10:00:00Z' }, end: { dateTime: '2026-08-03T11:00:00Z' } }], nextSyncToken: 'token' }
      }
    })
    await sync!.pullCalendar('calendar-1')
    online = false
    await expect(sync!.pullCalendar('calendar-1')).rejects.toThrow('refresh_token=do-not-leak')
    expect(db.sqlite.prepare('SELECT title FROM events').all()).toEqual([{ title: 'Keep this' }])
    expect(JSON.stringify(status.get())).not.toContain('refresh_token')
    expect(status.get().state).toBe('failed')
    online = true
    await sync!.pullCalendar('calendar-1')
    expect(status.get()).toMatchObject({ state: 'fresh', calendars: [{ error: null }] })
    expect(published).toContainEqual(expect.objectContaining({ state: 'failed' }))
    expect(published).toContainEqual(expect.objectContaining({ state: 'fresh' }))
  })

  it('exposes the typed, secret-free health query through the API', async () => {
    const { status } = setup()
    const response = new class extends EventEmitter {
      statusCode = 0
      body = ''
      writeHead(statusCode: number): this { this.statusCode = statusCode; return this }
      end(body?: string): this { this.body = body ?? ''; return this }
      setHeader(): this { return this }
    }()
    await handleApiRequest({ method: 'GET', url: '/api/v1/sync/status', headers: {} } as IncomingMessage, response as unknown as ServerResponse, { googleSyncStatus: status })
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({ state: 'never_synced', calendars: [{ id: 'calendar-1', error: null }] })
    expect(response.body).not.toContain('encrypted')
  })
})
