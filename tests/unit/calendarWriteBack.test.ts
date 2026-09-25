import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openServerDatabase, type ServerDatabase } from '../../src/server/db'
import { createEventAuthoringService } from '../../src/server/domain/events'
import { createEventFeedService } from '../../src/server/domain/eventFeeds'
import { createEventWriteService, MAX_WRITE_ATTEMPTS } from '../../src/server/domain/eventWrites'
import { createCalendarSourceService } from '../../src/server/sync/sources'
import { buildIcsDocument, resourceNameFor } from '../../src/server/sync/icalWrite'
import { mapCalendarDocument } from '../../src/server/sync/ical'
import { LOCAL_CALENDAR_ID } from '../../src/shared/localCalendar'

/**
 * N06 write-back and the routing rule from ADR 0007.
 *
 * The CalDAV half is driven against a fake collection that actually stores what
 * is written and enforces the same preconditions a real server does, because the
 * properties under test — exactly-once replay, `If-Match`, conflict resolution —
 * are entirely about those preconditions and a fetcher that always says 200
 * would prove none of them.
 */

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function database(): ServerDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'osl-writeback-'))
  directories.push(directory)
  return openServerDatabase(join(directory, 'test.db'))
}

const COLLECTION = 'https://caldav.example.test/12345678/calendars/home/'
const WINDOW = { start: '2026-06-01T00:00:00Z', end: '2026-07-01T00:00:00Z' }

/** A CalDAV collection with real storage, etags and preconditions. */
class FakeCollection {
  readonly resources = new Map<string, { etag: string; body: string }>()
  /** Every request, so a test can assert a replay did not become a second PUT. */
  readonly calls: { method: string; path: string; ifMatch: string | null; ifNoneMatch: string | null }[] = []
  private etagCounter = 0
  /** Set to fail the next N writes, standing in for an unreachable server. */
  unreachableWrites = 0

  private discovery(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
 <response>
  <href>/12345678/calendars/home/</href>
  <propstat><prop>
   <resourcetype><collection/><C:calendar/></resourcetype>
   <displayname>Home</displayname>
   <current-user-privilege-set><privilege><write/></privilege></current-user-privilege-set>
   <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
  </prop><status>HTTP/1.1 200 OK</status></propstat>
 </response>
</multistatus>`
  }

  private report(): string {
    const entries = [...this.resources.entries()].map(([name, resource]) => `
 <response>
  <href>/12345678/calendars/home/${name}</href>
  <propstat><prop>
   <getetag>"${resource.etag}"</getetag>
   <C:calendar-data>${resource.body.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</C:calendar-data>
  </prop><status>HTTP/1.1 200 OK</status></propstat>
 </response>`).join('')
    return `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${entries}
</multistatus>`
  }

  get fetcher(): typeof fetch {
    return (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      const headers = (init?.headers ?? {}) as Record<string, string>
      const name = url.slice(COLLECTION.length)
      this.calls.push({
        method, path: name,
        ifMatch: headers['if-match'] ?? null,
        ifNoneMatch: headers['if-none-match'] ?? null
      })

      if (method === 'PROPFIND') return new Response(this.discovery(), { status: 207 })
      if (method === 'REPORT') return new Response(this.report(), { status: 207 })

      if (method === 'GET') {
        const existing = this.resources.get(name)
        if (existing === undefined) return new Response('', { status: 404 })
        return new Response(existing.body, { status: 200, headers: { etag: `"${existing.etag}"` } })
      }

      if (method === 'PUT' || method === 'DELETE') {
        if (this.unreachableWrites > 0) {
          this.unreachableWrites -= 1
          throw new Error('socket hang up')
        }
        const existing = this.resources.get(name)
        const ifMatch = headers['if-match'] ?? null
        const ifNoneMatch = headers['if-none-match'] ?? null
        if (ifNoneMatch === '*' && existing !== undefined) return new Response('', { status: 412 })
        if (ifMatch !== null && (existing === undefined || `"${existing.etag}"` !== ifMatch)) return new Response('', { status: 412 })
        if (method === 'DELETE') {
          if (existing === undefined) return new Response('', { status: 404 })
          this.resources.delete(name)
          return new Response('', { status: 204 })
        }
        this.etagCounter += 1
        const etag = `v${this.etagCounter}`
        this.resources.set(name, { etag, body: String(init?.body ?? '') })
        return new Response('', { status: 201, headers: { etag: `"${etag}"` } })
      }
      return new Response('', { status: 405 })
    }) as unknown as typeof fetch
  }

  /** The stored document for a UID, parsed back into the cache's row shape. */
  parsed(icalUid: string) {
    const resource = this.resources.get(resourceNameFor(icalUid))
    if (resource === undefined) return null
    return mapCalendarDocument(resource.body, 'Europe/London')[0] ?? null
  }

  /** Rewrites a stored event as if somebody edited it in their calendar app. */
  editRemotely(icalUid: string, changes: { title: string; lastModified: string }): void {
    const name = resourceNameFor(icalUid)
    const existing = this.resources.get(name)
    if (existing === undefined) throw new Error('no such resource')
    this.etagCounter += 1
    this.resources.set(name, {
      etag: `v${this.etagCounter}`,
      body: existing.body
        .replace(/SUMMARY:.*/, `SUMMARY:${changes.title}`)
        .replace(/LAST-MODIFIED:.*/, `LAST-MODIFIED:${changes.lastModified}`)
    })
  }
}

interface Harness {
  db: ServerDatabase
  writes: ReturnType<typeof createEventWriteService>
  events: ReturnType<typeof createEventAuthoringService>
  sources: ReturnType<typeof createCalendarSourceService>
  collection: FakeCollection
}

function harness(options: { now?: () => Date } = {}): Harness {
  const db = database()
  const collection = new FakeCollection()
  const writes = createEventWriteService(db.sqlite, { now: options.now })
  const events = createEventAuthoringService(db.sqlite, writes, { now: options.now })
  const sources = createCalendarSourceService(db.sqlite, () => 'Europe/London', {
    fetcher: collection.fetcher, writes, now: options.now
  })
  return { db, writes, events, sources, collection }
}

function person(h: Harness, name: string): string {
  const id = `person-${name.toLowerCase()}`
  h.db.sqlite.prepare("INSERT INTO people (id, name, color, role, created_at) VALUES (?, ?, '#ff0000', 'child', '2026-01-01T00:00:00Z')")
    .run(id, name)
  return id
}

/** Connects the fake CalDAV account and maps its collection to one person. */
async function connectCalDav(h: Harness, personId: string | null, options: { readOnly?: boolean } = {}): Promise<string> {
  const source = await h.sources.connectCalDav({ name: 'iCloud', baseUrl: COLLECTION, username: 'alice', password: 'app-password' })
  const discovered = await h.sources.discoverCollections(source.id)
  const target = discovered[0]!
  h.sources.setCalendarSelection({
    sourceId: source.id, url: target.url, name: target.name, color: target.color,
    selected: true, audiencePersonId: personId, readOnly: options.readOnly ?? false
  })
  return source.id
}

const draft = (over: Partial<Parameters<Harness['events']['create']>[0]> = {}) => ({
  title: 'Dentist',
  description: null,
  location: null,
  startAt: '2026-06-15T09:00:00.000Z',
  endAt: '2026-06-15T10:00:00.000Z',
  timezone: 'Europe/London',
  allDay: false,
  recurrence: null,
  personId: null,
  ...over
})

describe('the routing rule', () => {
  it('keeps an untagged event on the board and queues nothing', () => {
    const h = harness()
    const created = h.events.create(draft())

    expect(created.calendarId).toBe(LOCAL_CALENDAR_ID)
    expect(created.destinationCalendarId).toBeNull()
    expect(h.db.sqlite.prepare('SELECT count(*) AS count FROM event_writes').get()).toEqual({ count: 0 })
    // Visible on the board, which is the whole point of staying local.
    expect(createEventFeedService(h.db.sqlite).family(WINDOW).map((o) => o.title)).toEqual(['Dentist'])
    h.db.close()
  })

  it('keeps an event tagged with a person who has no calendar local, with no error anywhere', () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const created = h.events.create(draft({ personId: ava }))

    expect(created.destinationCalendarId).toBeNull()
    expect(h.db.sqlite.prepare('SELECT count(*) AS count FROM event_writes').get()).toEqual({ count: 0 })
    // Tagged, so it shows in Ava's personal feed even though it never syncs.
    expect(createEventFeedService(h.db.sqlite).personal(ava, WINDOW).map((o) => o.title)).toEqual(['Dentist'])
    h.db.close()
  })

  it('treats a person whose only calendar is read-only exactly like a person with none', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    await connectCalDav(h, ava, { readOnly: true })

    expect(h.events.create(draft({ personId: ava })).destinationCalendarId).toBeNull()
    expect(h.db.sqlite.prepare('SELECT count(*) AS count FROM event_writes').get()).toEqual({ count: 0 })
    h.db.close()
  })

  it('never targets an ICS feed, because a subscription cannot be written', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const feedFetcher = (async () => new Response('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR', { status: 200 })) as unknown as typeof fetch
    const sources = createCalendarSourceService(h.db.sqlite, () => 'Europe/London', { fetcher: feedFetcher, writes: h.writes })
    const source = await sources.connectIcs({ name: 'School', url: 'https://feeds.example.test/school.ics' })
    h.db.sqlite.prepare('UPDATE calendars SET audience_person_id = ? WHERE source_id = ?').run(ava, source.id)

    expect(h.events.create(draft({ personId: ava })).destinationCalendarId).toBeNull()
    h.db.close()
  })

  it('queues an outward write when the tagged person has a writable calendar', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    await connectCalDav(h, ava)

    const created = h.events.create(draft({ personId: ava }))
    expect(created.destinationCalendarId).not.toBeNull()
    expect(h.db.sqlite.prepare('SELECT operation, state FROM event_writes').get()).toEqual({ operation: 'create', state: 'pending' })
    h.db.close()
  })
})

describe('CalDAV write-back', () => {
  it('creates the event in the collection and shows exactly one copy afterwards', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const sourceId = await connectCalDav(h, ava)
    const created = h.events.create(draft({ personId: ava, title: 'Dentist' }))

    await h.sources.syncSource(sourceId)

    // It really is in the collection, as a document a calendar client can read.
    const stored = h.collection.parsed(created.icalUid)
    expect(stored).toMatchObject({ title: 'Dentist', startAt: '2026-06-15T09:00:00Z' })
    expect(h.db.sqlite.prepare('SELECT state FROM event_writes').get()).toEqual({ state: 'sent' })

    // And the copy the pull just read back does not double it on the wall.
    expect(createEventFeedService(h.db.sqlite).family(WINDOW).map((o) => o.title)).toEqual(['Dentist'])
    h.db.close()
  })

  it('uses If-None-Match for a create, so a replay cannot produce a second event', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const sourceId = await connectCalDav(h, ava)
    const created = h.events.create(draft({ personId: ava }))
    await h.sources.syncSource(sourceId)

    expect(h.collection.calls.filter((call) => call.method === 'PUT')).toEqual([
      { method: 'PUT', path: resourceNameFor(created.icalUid), ifMatch: null, ifNoneMatch: '*' }
    ])

    // Re-queue the same create, as a crash between the PUT and the acknowledgement
    // would. The collection answers 412, which is the resource already being
    // exactly what we wanted, so it settles rather than duplicating.
    h.db.sqlite.prepare("UPDATE event_writes SET state = 'pending'").run()
    await h.sources.syncSource(sourceId)

    expect(h.collection.resources.size).toBe(1)
    expect(h.db.sqlite.prepare('SELECT state FROM event_writes').get()).toEqual({ state: 'sent' })
    h.db.close()
  })

  it('updates with If-Match against the etag it read', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const sourceId = await connectCalDav(h, ava)
    const created = h.events.create(draft({ personId: ava }))
    await h.sources.syncSource(sourceId)

    h.events.update(created.id, { title: 'Dentist (moved)' })
    await h.sources.syncSource(sourceId)

    expect(h.collection.parsed(created.icalUid)).toMatchObject({ title: 'Dentist (moved)' })
    const puts = h.collection.calls.filter((call) => call.method === 'PUT')
    expect(puts).toHaveLength(2)
    expect(puts[1]!.ifMatch).not.toBeNull()
    expect(h.collection.resources.size).toBe(1)
    h.db.close()
  })

  it('deletes the remote copy when the event is deleted on the board', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const sourceId = await connectCalDav(h, ava)
    const created = h.events.create(draft({ personId: ava }))
    await h.sources.syncSource(sourceId)
    expect(h.collection.resources.size).toBe(1)

    h.events.remove(created.id)
    await h.sources.syncSource(sourceId)

    expect(h.collection.resources.size).toBe(0)
    expect(createEventFeedService(h.db.sqlite).family(WINDOW)).toEqual([])
    h.db.close()
  })
})

describe('an unreachable calendar', () => {
  it('queues the edit and applies it exactly once on reconnect', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const sourceId = await connectCalDav(h, ava)
    const created = h.events.create(draft({ personId: ava }))

    h.collection.unreachableWrites = 1
    await h.sources.syncSource(sourceId)
    expect(h.collection.resources.size).toBe(0)
    expect(h.db.sqlite.prepare('SELECT state, attempts FROM event_writes').get()).toMatchObject({ state: 'pending', attempts: 1 })
    // The board still shows it: staying local while the source is down is not a
    // failure the household should see.
    expect(createEventFeedService(h.db.sqlite).family(WINDOW).map((o) => o.title)).toEqual(['Dentist'])

    await h.sources.syncSource(sourceId)

    expect(h.collection.resources.size).toBe(1)
    expect(h.collection.calls.filter((call) => call.method === 'PUT')).toHaveLength(2)
    expect(h.db.sqlite.prepare('SELECT state FROM event_writes').get()).toEqual({ state: 'sent' })
    expect(createEventFeedService(h.db.sqlite).family(WINDOW).map((o) => o.title)).toEqual(['Dentist'])
    h.db.close()
  })

  it('coalesces repeated edits into one write carrying the final state', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const sourceId = await connectCalDav(h, ava)
    const created = h.events.create(draft({ personId: ava }))

    h.events.update(created.id, { title: 'Second' })
    h.events.update(created.id, { title: 'Third' })
    h.events.update(created.id, { title: 'Final' })

    // One row, and it is still a create because nothing has reached the source.
    expect(h.db.sqlite.prepare('SELECT count(*) AS count FROM event_writes').get()).toEqual({ count: 1 })
    expect(h.db.sqlite.prepare('SELECT operation FROM event_writes').get()).toEqual({ operation: 'create' })

    await h.sources.syncSource(sourceId)

    expect(h.collection.calls.filter((call) => call.method === 'PUT')).toHaveLength(1)
    expect(h.collection.parsed(created.icalUid)).toMatchObject({ title: 'Final' })
    h.db.close()
  })

  it('cancels a queued create outright when the event is deleted before it ever went out', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const sourceId = await connectCalDav(h, ava)
    const created = h.events.create(draft({ personId: ava }))

    h.events.remove(created.id)

    // Nothing was ever sent, so there is nothing out there to delete.
    expect(h.db.sqlite.prepare('SELECT count(*) AS count FROM event_writes').get()).toEqual({ count: 0 })
    await h.sources.syncSource(sourceId)
    expect(h.collection.calls.some((call) => call.method === 'PUT' || call.method === 'DELETE')).toBe(false)
    h.db.close()
  })

  it('parks a write that keeps failing rather than retrying for ever', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const sourceId = await connectCalDav(h, ava)
    h.events.create(draft({ personId: ava }))

    h.collection.unreachableWrites = MAX_WRITE_ATTEMPTS
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) await h.sources.syncSource(sourceId)

    expect(h.db.sqlite.prepare('SELECT state, attempts FROM event_writes').get())
      .toMatchObject({ state: 'failed', attempts: MAX_WRITE_ATTEMPTS })
    h.db.close()
  })
})

describe('concurrent edits', () => {
  it('lets the more recent remote edit win, and records what it discarded', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const sourceId = await connectCalDav(h, ava)
    const created = h.events.create(draft({ personId: ava, title: 'Dentist' }))
    await h.sources.syncSource(sourceId)

    // Somebody edits it in their own calendar app, a week after the board did.
    h.collection.editRemotely(created.icalUid, { title: 'Dentist (in the app)', lastModified: '20260620T120000Z' })
    // Then the board edits its stale copy, dated before that.
    h.db.sqlite.prepare('UPDATE events SET remote_updated_at = ? WHERE id = ?').run('2026-06-10T00:00:00.000Z', created.id)
    h.events.update(created.id, { title: 'Dentist (on the board)' })
    h.db.sqlite.prepare('UPDATE events SET remote_updated_at = ? WHERE id = ?').run('2026-06-10T00:00:00.000Z', created.id)

    await h.sources.syncSource(sourceId)

    // The remote version stands.
    expect(h.collection.parsed(created.icalUid)).toMatchObject({ title: 'Dentist (in the app)' })
    // And the edit that lost is recoverable rather than gone.
    const conflicts = h.writes.openConflicts()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ discardedSide: 'local' })
    expect(conflicts[0]!.discardedPayload).toMatchObject({ title: 'Dentist (on the board)' })
    h.db.close()
  })

  it('lets the more recent board edit win, and still records the remote version', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const sourceId = await connectCalDav(h, ava)
    const created = h.events.create(draft({ personId: ava }))
    await h.sources.syncSource(sourceId)

    // An older remote edit, which also invalidates the etag the board holds.
    h.collection.editRemotely(created.icalUid, { title: 'Stale remote edit', lastModified: '20260601T000000Z' })
    h.events.update(created.id, { title: 'Newer board edit' })

    await h.sources.syncSource(sourceId)

    expect(h.collection.parsed(created.icalUid)).toMatchObject({ title: 'Newer board edit' })
    const conflicts = h.writes.openConflicts()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ discardedSide: 'remote' })
    expect(conflicts[0]!.discardedPayload).toMatchObject({ title: 'Stale remote edit' })
    h.db.close()
  })
})

describe('re-tagging an event', () => {
  it('moves one the board authored, deleting it from where it was', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const ben = person(h, 'Ben')
    const sourceId = await connectCalDav(h, ava)
    const created = h.events.create(draft({ personId: ava }))
    await h.sources.syncSource(sourceId)
    expect(h.collection.resources.size).toBe(1)

    // Ben has no writable calendar, so the event comes home and stays local.
    h.events.update(created.id, { personId: ben })
    await h.sources.syncSource(sourceId)

    expect(h.collection.resources.size).toBe(0)
    expect(createEventFeedService(h.db.sqlite).personal(ben, WINDOW).map((o) => o.title)).toEqual(['Dentist'])
    expect(createEventFeedService(h.db.sqlite).personal(ava, WINDOW)).toEqual([])
    h.db.close()
  })

  it('never deletes a remotely authored event out of its own calendar', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const ben = person(h, 'Ben')
    const sourceId = await connectCalDav(h, ava)

    // An event that came from the calendar, not from the board.
    h.collection.resources.set('remote-event.ics', {
      etag: 'remote-1',
      body: buildIcsDocument({
        icalUid: 'remote-event', title: 'Piano', description: null, location: null,
        startAt: '2026-06-16T15:00:00.000Z', endAt: '2026-06-16T16:00:00.000Z',
        timezone: 'Europe/London', allDay: false, recurrence: null, recurrenceExdates: null,
        recurringEventId: null, originalStartAt: null, status: 'confirmed'
      }, new Date('2026-06-01T00:00:00Z'))
    })
    await h.sources.syncSource(sourceId)
    const stored = h.db.sqlite.prepare<[], { id: string; origin: string }>("SELECT id, origin FROM events WHERE ical_uid = 'remote-event'").get()!
    expect(stored.origin).toBe('remote')

    h.events.update(stored.id, { personId: ben })
    await h.sources.syncSource(sourceId)

    // Still in the calendar it came from; only the board's audience changed.
    expect(h.collection.resources.has('remote-event.ics')).toBe(true)
    expect(createEventFeedService(h.db.sqlite).personal(ben, WINDOW).map((o) => o.title)).toEqual(['Piano'])
    h.db.close()
  })
})

describe('recurrence', () => {
  it('edits one occurrence without rewriting the series', () => {
    const h = harness()
    const created = h.events.create(draft({ title: 'Swimming', recurrence: 'FREQ=WEEKLY;BYDAY=MO', startAt: '2026-06-01T09:00:00.000Z', endAt: '2026-06-01T10:00:00.000Z' }))

    h.events.updateOccurrence(created.id, '2026-06-15T09:00:00.000Z', { title: 'Swimming (gala)' })

    const titles = createEventFeedService(h.db.sqlite).family(WINDOW).map((o) => `${o.occurrenceStart} ${o.title}`)
    // Every Monday in June, with exactly one of them overridden.
    expect(titles).toEqual([
      '2026-06-01T09:00:00Z Swimming',
      '2026-06-08T09:00:00Z Swimming',
      '2026-06-15T09:00:00Z Swimming (gala)',
      '2026-06-22T09:00:00Z Swimming',
      '2026-06-29T09:00:00Z Swimming'
    ])
    // The master is untouched, which is the actual guarantee.
    expect(h.db.sqlite.prepare<[string], { title: string; recurrence: string }>('SELECT title, recurrence FROM events WHERE id = ?').get(created.id))
      .toEqual({ title: 'Swimming', recurrence: 'FREQ=WEEKLY;BYDAY=MO' })
    h.db.close()
  })

  it('cancels one occurrence by excluding it, leaving the rest of the series', () => {
    const h = harness()
    const created = h.events.create(draft({ title: 'Swimming', recurrence: 'FREQ=WEEKLY;BYDAY=MO', startAt: '2026-06-01T09:00:00.000Z', endAt: '2026-06-01T10:00:00.000Z' }))

    h.events.removeOccurrence(created.id, '2026-06-15T09:00:00.000Z')

    expect(createEventFeedService(h.db.sqlite).family(WINDOW).map((o) => o.occurrenceStart)).toEqual([
      '2026-06-01T09:00:00Z', '2026-06-08T09:00:00Z', '2026-06-22T09:00:00Z', '2026-06-29T09:00:00Z'
    ])
    h.db.close()
  })

  it('writes a recurring event with a VTIMEZONE, so it does not drift across DST', () => {
    const document = buildIcsDocument({
      icalUid: 'weekly', title: 'Swimming', description: null, location: null,
      // 09:00 London in June is 08:00Z; the same wall-clock time in December is 09:00Z.
      startAt: '2026-06-01T08:00:00.000Z', endAt: '2026-06-01T09:00:00.000Z',
      timezone: 'Europe/London', allDay: false, recurrence: 'FREQ=WEEKLY;BYDAY=MO',
      recurrenceExdates: null, recurringEventId: null, originalStartAt: null, status: 'confirmed'
    }, new Date('2026-06-01T00:00:00Z'))

    expect(document).toContain('BEGIN:VTIMEZONE')
    expect(document).toContain('TZID:Europe/London')
    // The wall-clock time is what repeats, so the start carries a zone rather
    // than being pinned to a UTC instant.
    expect(document).toContain('DTSTART;TZID=Europe/London:20260601T090000')
    expect(document).toContain('BEGIN:DAYLIGHT')
    expect(document).toContain('BEGIN:STANDARD')

    // And it reads back as the same instant it went in as.
    expect(mapCalendarDocument(document, 'Europe/London')[0]).toMatchObject({
      title: 'Swimming', startAt: '2026-06-01T08:00:00Z', recurrence: 'FREQ=WEEKLY;BYDAY=MO'
    })
  })

  it('writes a single timed event as a plain UTC instant', () => {
    const document = buildIcsDocument({
      icalUid: 'one-off', title: 'Dentist', description: null, location: null,
      startAt: '2026-06-15T09:00:00.000Z', endAt: '2026-06-15T10:00:00.000Z',
      timezone: 'Europe/London', allDay: false, recurrence: null,
      recurrenceExdates: null, recurringEventId: null, originalStartAt: null, status: 'confirmed'
    }, new Date('2026-06-01T00:00:00Z'))

    expect(document).not.toContain('BEGIN:VTIMEZONE')
    expect(document).toContain('DTSTART:20260615T090000Z')
    expect(mapCalendarDocument(document, 'Europe/London')[0]).toMatchObject({ startAt: '2026-06-15T09:00:00Z' })
  })

  it('round-trips an all-day event as a DATE, and a title needing escaping', () => {
    const document = buildIcsDocument({
      icalUid: 'holiday', title: 'Nan, upstairs; bring cake', description: null, location: null,
      startAt: '2026-06-15T00:00:00.000Z', endAt: '2026-06-15T00:00:00.000Z',
      timezone: 'Europe/London', allDay: true, recurrence: null,
      recurrenceExdates: null, recurringEventId: null, originalStartAt: null, status: 'confirmed'
    }, new Date('2026-06-01T00:00:00Z'))

    expect(document).toContain('DTSTART;VALUE=DATE:20260615')
    // An all-day DTEND is exclusive, so one day covers one day.
    expect(document).toContain('DTEND;VALUE=DATE:20260616')
    expect(mapCalendarDocument(document, 'Europe/London')[0]).toMatchObject({
      title: 'Nan, upstairs; bring cake', allDay: true
    })
  })
})
