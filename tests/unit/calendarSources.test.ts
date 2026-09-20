import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openServerDatabase, type ServerDatabase } from '../../src/server/db'
import { createCalendarSourceService } from '../../src/server/sync/sources'
import { createCalendarSyncStatusService } from '../../src/server/sync/status'
import { createEventFeedService } from '../../src/server/domain/eventFeeds'
import { applicationKey, decryptSecret, encryptSecret, SecretError } from '../../src/server/sync/secrets'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function database(): ServerDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'osl-sources-'))
  directories.push(directory)
  return openServerDatabase(join(directory, 'test.db'))
}

const feed = (events: string): string => `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Test//EN\n${events}END:VCALENDAR`

const dinner = `BEGIN:VEVENT\nUID:dinner\nDTSTAMP:20260601T000000Z\nDTSTART;TZID=Europe/London:20260615T190000\nDTEND;TZID=Europe/London:20260615T200000\nSUMMARY:Dinner\nEND:VEVENT\n`
const swimming = `BEGIN:VEVENT\nUID:swimming\nDTSTAMP:20260601T000000Z\nDTSTART;TZID=Europe/London:20260616T100000\nDTEND;TZID=Europe/London:20260616T110000\nSUMMARY:Ava swimming\nEND:VEVENT\n`

function icsFetcher(bodyFor: () => string): typeof fetch {
  return (async () => new Response(bodyFor(), { status: 200 })) as unknown as typeof fetch
}

const window = { start: '2026-06-01T00:00:00Z', end: '2026-07-01T00:00:00Z' }

describe('calendar sources', () => {
  it('subscribes to an ICS feed and caches its events without any credential', async () => {
    const db = database()
    const sources = createCalendarSourceService(db.sqlite, () => 'Europe/London', { fetcher: icsFetcher(() => feed(dinner)) })

    const source = await sources.connectIcs({ name: 'School', url: 'https://feeds.example.test/school.ics' })
    expect(source).toMatchObject({ kind: 'ics', name: 'School' })
    await sources.syncSource(source.id)

    const occurrences = createEventFeedService(db.sqlite).family(window)
    expect(occurrences.map((occurrence) => occurrence.title)).toEqual(['Dinner'])
    // 19:00 London in June is BST, so the stored instant is 18:00Z.
    expect(occurrences[0]!.start).toBe('2026-06-15T18:00:00Z')
    db.close()
  })

  it('removes events that disappear from the feed instead of leaving them on the board', async () => {
    const db = database()
    let body = feed(dinner + swimming)
    const sources = createCalendarSourceService(db.sqlite, () => 'Europe/London', { fetcher: icsFetcher(() => body) })
    const source = await sources.connectIcs({ name: 'School', url: 'https://feeds.example.test/school.ics' })
    await sources.syncSource(source.id)
    expect(createEventFeedService(db.sqlite).family(window)).toHaveLength(2)

    body = feed(dinner)
    await sources.syncSource(source.id)

    expect(createEventFeedService(db.sqlite).family(window).map((occurrence) => occurrence.title)).toEqual(['Dinner'])
    db.close()
  })

  it('keeps the cached events and records a safe error when the feed becomes unreachable', async () => {
    const db = database()
    let failing = false
    const fetcher = (async () => {
      if (failing) return new Response('backend trace with https://user:secret@host/', { status: 503 })
      return new Response(feed(dinner), { status: 200 })
    }) as unknown as typeof fetch
    const status = createCalendarSyncStatusService(db.sqlite)
    const sources = createCalendarSourceService(db.sqlite, () => 'Europe/London', { fetcher, status })
    const source = await sources.connectIcs({ name: 'School', url: 'https://feeds.example.test/school.ics' })
    await sources.syncSource(source.id)

    failing = true
    await sources.syncSource(source.id)

    expect(createEventFeedService(db.sqlite).family(window)).toHaveLength(1)
    const stored = sources.list()[0]!
    expect(stored.error).toMatch(/returned an error \(503\)/)
    expect(stored.error).not.toContain('secret')
    expect(status.get().state).toBe('failed')
    db.close()
  })

  it('reports not_configured until a source exists, then reflects real sync health', async () => {
    const db = database()
    const status = createCalendarSyncStatusService(db.sqlite)
    expect(status.get().state).toBe('not_configured')

    const sources = createCalendarSourceService(db.sqlite, () => 'Europe/London', { fetcher: icsFetcher(() => feed(dinner)), status })
    const source = await sources.connectIcs({ name: 'School', url: 'https://feeds.example.test/school.ics' })
    expect(status.get().state).toBe('never_synced')

    await sources.syncSource(source.id)
    expect(status.get().state).toBe('fresh')
    db.close()
  })

  it('removing a source removes its calendars and cached events', async () => {
    const db = database()
    const sources = createCalendarSourceService(db.sqlite, () => 'Europe/London', { fetcher: icsFetcher(() => feed(dinner)) })
    const source = await sources.connectIcs({ name: 'School', url: 'https://feeds.example.test/school.ics' })
    await sources.syncSource(source.id)

    sources.remove(source.id)

    expect(sources.list()).toEqual([])
    expect(db.sqlite.prepare('SELECT count(*) AS count FROM calendars').get()).toEqual({ count: 0 })
    expect(db.sqlite.prepare('SELECT count(*) AS count FROM events').get()).toEqual({ count: 0 })
    db.close()
  })

  it('records a visible error when the household timezone is not set yet', async () => {
    const db = database()
    const sources = createCalendarSourceService(db.sqlite, () => { throw new Error('household timezone required') }, {
      fetcher: icsFetcher(() => feed(dinner))
    })
    const source = await sources.connectIcs({ name: 'School', url: 'https://feeds.example.test/school.ics' })

    await sources.syncSource(source.id)

    // A silent no-op here would leave the parent staring at an empty board
    // with nothing to act on.
    expect(sources.list()[0]!.error).toMatch(/household timezone/i)
    db.close()
  })

  it('refuses to store a CalDAV account whose credentials do not work', async () => {
    const db = database()
    const fetcher = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
    const sources = createCalendarSourceService(db.sqlite, () => 'Europe/London', { fetcher })

    await expect(sources.connectCalDav({ name: 'iCloud', baseUrl: 'https://caldav.example.test/', username: 'alice', password: 'wrong' }))
      .rejects.toThrow(/rejected the username or app password/)
    expect(sources.list()).toEqual([])
    db.close()
  })
})

describe('credential storage', () => {
  it('round-trips a secret and refuses one bound to a different source', () => {
    const db = database()
    const key = applicationKey(db.sqlite)
    const envelope = encryptSecret(key, 'source-a', 'app-password')

    expect(decryptSecret(key, 'source-a', envelope)).toBe('app-password')
    expect(() => decryptSecret(key, 'source-b', envelope)).toThrow(SecretError)
    // The stored bytes must not contain the plaintext.
    expect(envelope.toString('utf8')).not.toContain('app-password')
    db.close()
  })

  it('reuses the same key across opens so stored credentials survive a restart', () => {
    const db = database()
    const first = applicationKey(db.sqlite)
    const second = applicationKey(db.sqlite)
    expect(second.equals(first)).toBe(true)
    db.close()
  })
})
