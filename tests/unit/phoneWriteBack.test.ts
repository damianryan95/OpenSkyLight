import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { HouseholdAuthService, ParentDeviceService } from '../../src/server/auth'
import { handleApiRequest, type ApiRouterDependencies } from '../../src/server/api/router'
import { openServerDatabase, type ServerDatabase } from '../../src/server/db'
import { createHouseholdSettingsService, createPeopleService } from '../../src/server/domain'
import { createEventAuthoringService, type EventAuthoringService } from '../../src/server/domain/events'
import { createEventFeedService } from '../../src/server/domain/eventFeeds'
import { createEventWriteService } from '../../src/server/domain/eventWrites'
import { createCalendarSourceService, type CalendarSourceService } from '../../src/server/sync/sources'
import { createPhoneWriteService } from '../../src/server/sync/phoneWrites'
import { createCalendarSyncStatusService } from '../../src/server/sync/status'
import type { PendingEventWritesResponse } from '../../src/shared/api/contract'

/**
 * Write-back to a phone, which inverts the direction every other source runs in:
 * the phone asks what is outstanding and applies it itself (ADR 0007). Driven
 * through the real HTTP routes with a paired phone's own credential, because the
 * ordering and ownership rules below are enforced there.
 */

const temporaryDirectories: string[] = []
afterEach(() => { for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function database(): ServerDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'osl-phone-writeback-'))
  temporaryDirectories.push(directory)
  return openServerDatabase(join(directory, 'openskylight.db'))
}

class TestResponse {
  status = 200
  readonly headers = new Map<string, string>()
  body = ''
  setHeader(name: string, value: string): this { this.headers.set(name.toLowerCase(), value); return this }
  writeHead(status: number, headers?: Record<string, string>): this { this.status = status; for (const [name, value] of Object.entries(headers ?? {})) this.setHeader(name, value); return this }
  end(body?: string): this { this.body = body ?? ''; return this }
}

function request(method: string, path: string, headers: Record<string, string>, body?: unknown): IncomingMessage {
  return Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method, url: path, headers }) as IncomingMessage
}

const JSON_HEADERS = { 'content-type': 'application/json' }
const WINDOW = { start: '2026-06-01T00:00:00Z', end: '2026-07-01T00:00:00Z' }

interface Harness {
  db: ServerDatabase
  deps: ApiRouterDependencies
  sources: CalendarSourceService
  events: EventAuthoringService
  call: (method: string, path: string, body?: unknown) => Promise<TestResponse>
}

function harness(): Harness {
  const db = database()
  const now = (): Date => new Date('2026-06-10T09:00:00Z')
  const auth = new HouseholdAuthService(db.sqlite)
  const parentDevices = new ParentDeviceService(db.sqlite)
  const settings = createHouseholdSettingsService(db.sqlite)
  settings.setTimezone('Europe/London')
  const writes = createEventWriteService(db.sqlite, { now })
  const sources = createCalendarSourceService(db.sqlite, () => settings.get().timezone, {
    now, status: createCalendarSyncStatusService(db.sqlite, { now }), writes
  })
  const events = createEventAuthoringService(db.sqlite, writes, { now })
  const deps: ApiRouterDependencies = {
    auth, parentDevices, settings, calendarSources: sources, people: createPeopleService(db.sqlite),
    phoneWrites: createPhoneWriteService(db.sqlite, writes), eventAuthoring: events, now
  }

  auth.setup('1234')
  let bearer: string | undefined
  const send = async (method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<TestResponse> => {
    const response = new TestResponse()
    await handleApiRequest(request(method, path, headers, body), response as unknown as ServerResponse, deps)
    return response
  }
  const call = async (method: string, path: string, body?: unknown): Promise<TestResponse> => {
    if (bearer === undefined) {
      const paired = await send('POST', '/api/v1/parent-devices', JSON_HEADERS, { pin: '1234', name: 'Mum phone' })
      bearer = (JSON.parse(paired.body) as { credential: string }).credential
    }
    return send(method, path, { ...JSON_HEADERS, authorization: `Bearer ${bearer}` }, body)
  }
  return { db, deps, sources, events, call }
}

/** Registers a phone, catalogues one calendar, and maps it to a person. */
async function phoneWithCalendar(h: Harness, personId: string): Promise<{ sourceId: string; sourceCalendarId: string }> {
  const source = h.sources.connectPhone({ name: 'Mum phone' })
  const sourceCalendarId = 'phone:1'
  await h.call('POST', `/api/v1/calendar-sources/${source.id}/push`, {
    pushedAt: '2026-06-10T09:00:00Z', window: { start: WINDOW.start, end: WINDOW.end },
    calendars: [{ sourceCalendarId, name: 'Personal', color: '#2F8FED', events: [] }]
  })
  h.sources.setCalendarSelection({
    sourceId: source.id, url: sourceCalendarId, name: 'Personal', color: '#2F8FED',
    selected: true, audiencePersonId: personId, readOnly: false
  })
  return { sourceId: source.id, sourceCalendarId }
}

function person(h: Harness, name: string): string {
  const id = `person-${name.toLowerCase()}`
  h.db.sqlite.prepare("INSERT INTO people (id, name, color, role, created_at) VALUES (?, ?, '#ff0000', 'child', '2026-01-01T00:00:00Z')")
    .run(id, name)
  return id
}

const draft = {
  title: 'Dentist', description: null, location: null,
  startAt: '2026-06-15T09:00:00.000Z', endAt: '2026-06-15T10:00:00.000Z',
  timezone: 'Europe/London', allDay: false, recurrence: null
}

async function pending(h: Harness, sourceId: string): Promise<PendingEventWritesResponse['writes']> {
  const response = await h.call('GET', `/api/v1/calendar-sources/${sourceId}/pending-writes`)
  expect(response.status).toBe(200)
  return (JSON.parse(response.body) as PendingEventWritesResponse).writes
}

describe('a phone draining the write queue', () => {
  it('is offered a create for an event tagged with the person who holds that calendar', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const { sourceId, sourceCalendarId } = await phoneWithCalendar(h, ava)

    const created = h.events.create({ ...draft, personId: ava })
    expect(created.destinationCalendarId).not.toBeNull()

    expect(await pending(h, sourceId)).toEqual([{
      id: expect.any(String),
      sourceCalendarId,
      operation: 'create',
      icalUid: created.icalUid,
      // Nothing to address yet: the phone has never seen this event.
      sourceEventId: null,
      event: {
        title: 'Dentist', description: null, location: null,
        startAt: '2026-06-15T09:00:00.000Z', endAt: '2026-06-15T10:00:00.000Z',
        timezone: 'Europe/London', allDay: false, recurrence: null,
        recurrenceExdates: null, originalStartAt: null
      }
    }])
    h.db.close()
  })

  it('stops offering a write once the phone says it applied it', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const { sourceId } = await phoneWithCalendar(h, ava)
    h.events.create({ ...draft, personId: ava })
    const [write] = await pending(h, sourceId)

    const ack = await h.call('POST', `/api/v1/calendar-sources/${sourceId}/pending-writes/ack`, {
      results: [{ id: write!.id, status: 'applied', sourceEventId: 'android-42:1781506800000' }]
    })
    expect(ack.status).toBe(200)
    expect(JSON.parse(ack.body)).toEqual({ applied: 1, failed: 0 })
    expect(await pending(h, sourceId)).toEqual([])
    h.db.close()
  })

  it('does not double the event on the board when the phone pushes it straight back', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const { sourceId, sourceCalendarId } = await phoneWithCalendar(h, ava)
    h.events.create({ ...draft, personId: ava })
    const [write] = await pending(h, sourceId)
    const assignedId = 'android-42:1781506800000'
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/pending-writes/ack`, {
      results: [{ id: write!.id, status: 'applied', sourceEventId: assignedId }]
    })

    // The phone now reads its own calendar and pushes what it found — including
    // the event the board just asked it to create. Android supplies no iCalendar
    // UID at all, so UID deduplication has nothing to work with here.
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, {
      pushedAt: '2026-06-10T10:00:00Z', window: { start: WINDOW.start, end: WINDOW.end },
      calendars: [{
        sourceCalendarId, name: 'Personal', color: '#2F8FED',
        events: [{
          sourceEventId: assignedId, icalUid: null, title: 'Dentist', description: null, location: null,
          startAt: '2026-06-15T09:00:00Z', endAt: '2026-06-15T10:00:00Z', timezone: 'Europe/London',
          allDay: false, recurrence: null, recurrenceExdates: null, recurrenceRdates: null,
          recurringEventId: null, originalStartAt: null, status: 'confirmed', remoteUpdatedAt: null
        }]
      }]
    })

    // Both rows are cached, and the household sees the event once.
    expect(h.db.sqlite.prepare("SELECT count(*) AS count FROM events WHERE title = 'Dentist'").get()).toEqual({ count: 2 })
    expect(createEventFeedService(h.db.sqlite).family(WINDOW).map((o) => o.title)).toEqual(['Dentist'])
    h.db.close()
  })

  it('tells the phone which of its own events to change, once it knows', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const { sourceId } = await phoneWithCalendar(h, ava)
    const created = h.events.create({ ...draft, personId: ava })
    const [first] = await pending(h, sourceId)
    const assignedId = 'android-42:1781506800000'
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/pending-writes/ack`, {
      results: [{ id: first!.id, status: 'applied', sourceEventId: assignedId }]
    })

    h.events.update(created.id, { title: 'Dentist (moved)' })

    const [second] = await pending(h, sourceId)
    // An update, not a second create, and addressed to the phone's own row.
    expect(second).toMatchObject({ operation: 'update', sourceEventId: assignedId })
    expect(second!.event.title).toBe('Dentist (moved)')
    h.db.close()
  })

  it('asks the phone to delete its copy when the event is deleted on the board', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const { sourceId } = await phoneWithCalendar(h, ava)
    const created = h.events.create({ ...draft, personId: ava })
    const [first] = await pending(h, sourceId)
    const assignedId = 'android-42:1781506800000'
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/pending-writes/ack`, {
      results: [{ id: first!.id, status: 'applied', sourceEventId: assignedId }]
    })

    h.events.remove(created.id)

    const [second] = await pending(h, sourceId)
    // The event row is gone here, so the identity has to survive on the queue.
    expect(second).toMatchObject({ operation: 'delete', sourceEventId: assignedId })
    h.db.close()
  })

  it('keeps offering a write the phone could not apply, with what it said', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const { sourceId } = await phoneWithCalendar(h, ava)
    h.events.create({ ...draft, personId: ava })
    const [write] = await pending(h, sourceId)

    const ack = await h.call('POST', `/api/v1/calendar-sources/${sourceId}/pending-writes/ack`, {
      results: [{ id: write!.id, status: 'failed', message: 'Calendar permission was withdrawn.' }]
    })
    expect(JSON.parse(ack.body)).toEqual({ applied: 0, failed: 1 })

    expect(await pending(h, sourceId)).toHaveLength(1)
    expect(h.db.sqlite.prepare('SELECT attempts, last_error FROM event_writes').get())
      .toEqual({ attempts: 1, last_error: 'Calendar permission was withdrawn.' })
    h.db.close()
  })

  it('ignores an acknowledgement for a write that is not this phone’s', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const { sourceId } = await phoneWithCalendar(h, ava)
    h.events.create({ ...draft, personId: ava })

    const ack = await h.call('POST', `/api/v1/calendar-sources/${sourceId}/pending-writes/ack`, {
      results: [{ id: 'a-write-belonging-to-nobody', status: 'applied', sourceEventId: 'x' }]
    })
    expect(JSON.parse(ack.body)).toEqual({ applied: 0, failed: 0 })
    // Still outstanding, rather than silently stranded.
    expect(await pending(h, sourceId)).toHaveLength(1)
    h.db.close()
  })

  it('refuses the queue to anything that is not a phone source, and to an unpaired caller', async () => {
    const h = harness()
    const ava = person(h, 'Ava')
    const { sourceId } = await phoneWithCalendar(h, ava)

    const anonymous = new TestResponse()
    await handleApiRequest(
      request('GET', `/api/v1/calendar-sources/${sourceId}/pending-writes`, {}),
      anonymous as unknown as ServerResponse, h.deps
    )
    expect(anonymous.status).toBe(401)

    const feedFetcher = (async () => new Response('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR', { status: 200 })) as unknown as typeof fetch
    const ics = await createCalendarSourceService(h.db.sqlite, () => 'Europe/London', { fetcher: feedFetcher })
      .connectIcs({ name: 'School', url: 'https://feeds.example.test/school.ics' })
    const refused = await h.call('GET', `/api/v1/calendar-sources/${ics.id}/pending-writes`)
    expect(refused.status).toBe(400)
    h.db.close()
  })
})
