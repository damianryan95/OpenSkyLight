import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { HouseholdAuthService, ParentDeviceService } from '../../src/server/auth'
import { handleApiRequest, type ApiRouterDependencies } from '../../src/server/api/router'
import { openServerDatabase, type ServerDatabase } from '../../src/server/db'
import { createHouseholdSettingsService, createPeopleService } from '../../src/server/domain'
import { createEventFeedService } from '../../src/server/domain/eventFeeds'
import { createCalendarSourceService, type CalendarSourceService } from '../../src/server/sync/sources'
import { createCalendarSyncStatusService } from '../../src/server/sync/status'

const temporaryDirectories: string[] = []
afterEach(() => { for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function database(): ServerDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'openskylight-phone-push-'))
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

interface Harness {
  db: ServerDatabase
  deps: ApiRouterDependencies
  sources: CalendarSourceService
  /** The paired phone's own credential: the route the app really uses. */
  call: (method: string, path: string, body?: unknown) => Promise<TestResponse>
  clock: { value: Date }
  eventsChanged: () => number
}

function harness(options: { fetcher?: typeof fetch; staleAfterMs?: number } = {}): Harness {
  const db = database()
  const clock = { value: new Date('2026-06-10T09:00:00Z') }
  const now = (): Date => clock.value
  const auth = new HouseholdAuthService(db.sqlite)
  const parentDevices = new ParentDeviceService(db.sqlite)
  const settings = createHouseholdSettingsService(db.sqlite)
  settings.setTimezone('Europe/London')
  const syncStatus = createCalendarSyncStatusService(db.sqlite, { now, staleAfterMs: options.staleAfterMs })
  let changes = 0
  const sources = createCalendarSourceService(db.sqlite, () => settings.get().timezone, {
    now, status: syncStatus, fetcher: options.fetcher, onEventsChanged: () => { changes += 1 }
  })
  const deps: ApiRouterDependencies = {
    auth, parentDevices, settings, syncStatus, calendarSources: sources,
    people: createPeopleService(db.sqlite), now
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
  return { db, deps, sources, call, clock, eventsChanged: () => changes }
}

const WINDOW = { start: '2026-06-01T00:00:00Z', end: '2026-07-01T00:00:00Z' }

type PhoneEvent = {
  sourceEventId: string
  icalUid?: string | null
  title: string
  startAt: string
  endAt: string
  timezone: string
  allDay: boolean
  status: 'confirmed' | 'cancelled'
  recurrence?: string | null
  recurringEventId?: string | null
  originalStartAt?: string | null
}

function phoneEvent(overrides: Partial<PhoneEvent> & { sourceEventId: string; title: string; startAt: string; endAt: string }): PhoneEvent {
  return { timezone: 'Europe/London', allDay: false, status: 'confirmed', ...overrides }
}

const dinner = phoneEvent({ sourceEventId: 'dinner', icalUid: 'dinner@phone', title: 'Dinner', startAt: '2026-06-15T18:00:00Z', endAt: '2026-06-15T19:00:00Z' })
const swimming = phoneEvent({ sourceEventId: 'swimming', icalUid: 'swimming@phone', title: 'Swimming', startAt: '2026-06-16T09:00:00Z', endAt: '2026-06-16T10:00:00Z' })

function push(pushedAt: string, events: PhoneEvent[], calendar = { sourceCalendarId: 'phone:1', name: 'Personal' }): unknown {
  return { pushedAt, window: WINDOW, calendars: [{ ...calendar, color: '#2F8FED', events }] }
}

async function phoneSource(h: Harness): Promise<string> {
  const created = await h.call('POST', '/api/v1/calendar-sources', { kind: 'phone', name: 'Mum phone' })
  expect(created.status).toBe(201)
  return (JSON.parse(created.body) as { id: string }).id
}

async function select(h: Harness, sourceId: string, sourceCalendarId = 'phone:1', name = 'Personal'): Promise<void> {
  const response = await h.call('PUT', `/api/v1/calendar-sources/${sourceId}/calendars`, {
    calendar: { id: sourceCalendarId, name, color: '#2F8FED', primary: false, readOnly: true },
    selected: true,
    audiencePersonId: null
  })
  expect(response.status).toBe(204)
}

function storedEvents(h: Harness): { source_event_id: string; title: string; start_at: string; status: string }[] {
  return h.db.sqlite.prepare('SELECT source_event_id, title, start_at, status FROM events ORDER BY source_event_id').all() as never
}

describe('phone calendar push', () => {
  it('registers a phone source with no credential of any kind', async () => {
    const h = harness()
    const sourceId = await phoneSource(h)

    expect(JSON.parse((await h.call('GET', '/api/v1/calendar-sources')).body)).toMatchObject({
      sources: [{ id: sourceId, kind: 'phone', name: 'Mum phone' }]
    })
    // The property worth protecting: there is nothing here to leak.
    expect(h.db.sqlite.prepare('SELECT base_url, username, password_enc FROM calendar_sources WHERE id = ?').get(sourceId))
      .toEqual({ base_url: null, username: null, password_enc: null })
    h.db.close()
  })

  it('catalogues a pushed calendar unselected, and commits its events once the parent selects it', async () => {
    const h = harness()
    const sourceId = await phoneSource(h)

    const first = await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T09:00:00Z', [dinner, swimming]))
    expect(first.status).toBe(200)
    expect(JSON.parse(first.body)).toEqual({
      calendars: [{ sourceCalendarId: 'phone:1', selected: false, committed: 0, lastPushedAt: '2026-06-10T09:00:00Z' }]
    })
    // Catalogued, so the parent can choose it — but nothing reached the board.
    expect(storedEvents(h)).toEqual([])
    expect(JSON.parse((await h.call('GET', `/api/v1/calendar-sources/${sourceId}/calendars`)).body)).toEqual({
      // Writable since N06: the board queues a write and the phone drains the
      // queue and applies it through the OS calendar API.
      calendars: [{ id: 'phone:1', name: 'Personal', color: '#2F8FED', primary: false, readOnly: false, selected: false, audiencePersonId: null }]
    })
    expect(createEventFeedService(h.db.sqlite).family(WINDOW)).toEqual([])

    await select(h, sourceId)
    const second = await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T10:00:00Z', [dinner, swimming]))
    expect(JSON.parse(second.body)).toEqual({
      calendars: [{ sourceCalendarId: 'phone:1', selected: true, committed: 2, lastPushedAt: '2026-06-10T10:00:00Z' }]
    })
    expect(createEventFeedService(h.db.sqlite).family(WINDOW).map((occurrence) => occurrence.title)).toEqual(['Dinner', 'Swimming'])
    h.db.close()
  })

  it('is idempotent: an identical second push leaves the same rows', async () => {
    const h = harness()
    const sourceId = await phoneSource(h)
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T09:00:00Z', [dinner, swimming]))
    await select(h, sourceId)
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T10:00:00Z', [dinner, swimming]))
    const before = h.db.sqlite.prepare('SELECT id, source_event_id, title, start_at, end_at, status FROM events ORDER BY source_event_id').all()

    const repeated = await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T10:00:00Z', [dinner, swimming]))

    expect(repeated.status).toBe(200)
    // Same row identities, not merely the same count: a duplicate insert would
    // show up here as a new id and a second occurrence on the wall.
    expect(h.db.sqlite.prepare('SELECT id, source_event_id, title, start_at, end_at, status FROM events ORDER BY source_event_id').all()).toEqual(before)
    expect(createEventFeedService(h.db.sqlite).family(WINDOW)).toHaveLength(2)
    h.db.close()
  })

  it('cancels an event that is absent from a later full-window push', async () => {
    const h = harness()
    const sourceId = await phoneSource(h)
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T09:00:00Z', []))
    await select(h, sourceId)
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T10:00:00Z', [dinner, swimming]))

    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T11:00:00Z', [dinner]))

    expect(storedEvents(h)).toEqual([
      { source_event_id: 'dinner', title: 'Dinner', start_at: '2026-06-15T18:00:00Z', status: 'confirmed' },
      { source_event_id: 'swimming', title: 'Swimming', start_at: '2026-06-16T09:00:00Z', status: 'cancelled' }
    ])
    expect(createEventFeedService(h.db.sqlite).family(WINDOW).map((occurrence) => occurrence.title)).toEqual(['Dinner'])
    h.db.close()
  })

  it('refuses a stale push and does not resurrect what a newer push removed', async () => {
    const h = harness()
    const sourceId = await phoneSource(h)
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T09:00:00Z', []))
    await select(h, sourceId)
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T10:00:00Z', [dinner, swimming]))
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T11:00:00Z', [dinner]))

    // The out-of-order case: a snapshot taken before the deletion arrives after
    // it, which is exactly what a phone with a skewed clock or a delayed
    // background refresh produces.
    const stale = await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T10:30:00Z', [dinner, swimming]))

    expect(stale.status).toBe(409)
    expect(JSON.parse(stale.body)).toEqual({
      error: { code: 'conflict', message: expect.stringContaining('newer snapshot') },
      stale: [{ sourceCalendarId: 'phone:1', lastPushedAt: '2026-06-10T11:00:00Z' }]
    })
    // The rows, not just the status code: nothing was applied.
    expect(storedEvents(h)).toEqual([
      { source_event_id: 'dinner', title: 'Dinner', start_at: '2026-06-15T18:00:00Z', status: 'confirmed' },
      { source_event_id: 'swimming', title: 'Swimming', start_at: '2026-06-16T09:00:00Z', status: 'cancelled' }
    ])
    expect(createEventFeedService(h.db.sqlite).family(WINDOW).map((occurrence) => occurrence.title)).toEqual(['Dinner'])
    // Scoped past the seeded local calendar, which is never pushed to.
    expect(h.db.sqlite.prepare("SELECT last_pushed_at FROM calendars WHERE id != 'osl-local-calendar'").get()).toEqual({ last_pushed_at: '2026-06-10T11:00:00Z' })

    // A push at the same instant as the stored one is not stale; only strictly
    // older is, so a phone re-pushing its current snapshot still works.
    const equal = await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T11:00:00Z', [dinner]))
    expect(equal.status).toBe(200)
    h.db.close()
  })

  it('keeps an unselected calendar out of the board even when another calendar of the same phone is selected', async () => {
    const h = harness()
    const sourceId = await phoneSource(h)
    const payload = {
      pushedAt: '2026-06-10T09:00:00Z',
      window: WINDOW,
      calendars: [
        { sourceCalendarId: 'phone:1', name: 'Personal', events: [dinner] },
        { sourceCalendarId: 'phone:2', name: 'Work', events: [swimming] }
      ]
    }
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, payload)
    await select(h, sourceId, 'phone:1')

    const applied = await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, { ...payload, pushedAt: '2026-06-10T10:00:00Z' })

    expect(JSON.parse(applied.body)).toEqual({
      calendars: [
        { sourceCalendarId: 'phone:1', selected: true, committed: 1, lastPushedAt: '2026-06-10T10:00:00Z' },
        { sourceCalendarId: 'phone:2', selected: false, committed: 0, lastPushedAt: '2026-06-10T10:00:00Z' }
      ]
    })
    expect(storedEvents(h)).toEqual([{ source_event_id: 'dinner', title: 'Dinner', start_at: '2026-06-15T18:00:00Z', status: 'confirmed' }])
    expect(createEventFeedService(h.db.sqlite).family(WINDOW).map((occurrence) => occurrence.title)).toEqual(['Dinner'])
    h.db.close()
  })

  it('feeds sync health, so a phone that stops pushing is visibly stale', async () => {
    const h = harness({ staleAfterMs: 15 * 60_000 })
    const sourceId = await phoneSource(h)
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T09:00:00Z', []))
    await select(h, sourceId)

    expect(JSON.parse((await h.call('GET', '/api/v1/sync/status')).body)).toMatchObject({ state: 'never_synced' })

    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T10:00:00Z', [dinner]))
    const fresh = JSON.parse((await h.call('GET', '/api/v1/sync/status')).body) as { state: string; lastSucceededAt: string; calendars: { name: string; lastAttemptAt: string; lastSucceededAt: string; error: string | null }[] }
    expect(fresh.state).toBe('fresh')
    expect(fresh.calendars).toEqual([{ id: expect.any(String), name: 'Personal', lastAttemptAt: '2026-06-10T09:00:00.000Z', lastSucceededAt: '2026-06-10T09:00:00.000Z', error: null }])
    expect(JSON.parse((await h.call('GET', '/api/v1/calendar-sources')).body)).toMatchObject({
      sources: [{ kind: 'phone', lastSucceededAt: '2026-06-10T09:00:00.000Z', error: null }]
    })

    // Nobody opens the app for half an hour. The board must say so rather than
    // present month-old events as current.
    h.clock.value = new Date('2026-06-10T09:31:00Z')
    expect(JSON.parse((await h.call('GET', '/api/v1/sync/status')).body)).toMatchObject({ state: 'stale' })
    h.db.close()
  })

  it('publishes an events-changed invalidation exactly as a server-side sync does', async () => {
    const h = harness()
    const sourceId = await phoneSource(h)
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T09:00:00Z', [dinner]))
    // Unselected: nothing reached the board, so there is nothing to revalidate.
    expect(h.eventsChanged()).toBe(0)

    await select(h, sourceId)
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T10:00:00Z', [dinner]))
    expect(h.eventsChanged()).toBe(1)
    h.db.close()
  })

  it('refuses a push that carries no parent credential, and one aimed at a non-phone source', async () => {
    const h = harness({ fetcher: caldavFetcher() })
    const sourceId = await phoneSource(h)

    const anonymous = new TestResponse()
    await handleApiRequest(
      request('POST', `/api/v1/calendar-sources/${sourceId}/push`, JSON_HEADERS, push('2026-06-10T09:00:00Z', [dinner])),
      anonymous as unknown as ServerResponse, h.deps
    )
    // No Authorization header at all falls to the browser path, which refuses a
    // cross-origin mutation before it ever looks for a session.
    expect(anonymous.status).toBe(403)

    const forged = new TestResponse()
    await handleApiRequest(
      request('POST', `/api/v1/calendar-sources/${sourceId}/push`, { ...JSON_HEADERS, authorization: 'Bearer not-a-paired-phone-credential-at-all' }, push('2026-06-10T09:00:00Z', [dinner])),
      forged as unknown as ServerResponse, h.deps
    )
    expect(forged.status).toBe(401)
    expect(h.db.sqlite.prepare("SELECT count(*) AS count FROM calendars WHERE id != 'osl-local-calendar'").get()).toEqual({ count: 0 })

    const caldav = await h.call('POST', '/api/v1/calendar-sources', { kind: 'caldav', name: 'iCloud', baseUrl: 'https://caldav.example.test/', username: 'alice', password: 'app-password' })
    const refused = await h.call('POST', `/api/v1/calendar-sources/${(JSON.parse(caldav.body) as { id: string }).id}/push`, push('2026-06-10T09:00:00Z', [dinner]))
    expect(refused.status).toBe(400)
    h.db.close()
  })

  it('keeps a recurring master and its exception together through a push', async () => {
    const h = harness()
    const sourceId = await phoneSource(h)
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T09:00:00Z', []))
    await select(h, sourceId)

    const master = phoneEvent({
      sourceEventId: 'standup', icalUid: 'standup@phone', title: 'Standup',
      startAt: '2026-06-15T08:00:00Z', endAt: '2026-06-15T08:15:00Z', recurrence: 'FREQ=DAILY;COUNT=3'
    })
    const moved = phoneEvent({
      sourceEventId: 'standup::2026-06-16T08:00:00Z', icalUid: 'standup@phone', title: 'Standup (late)',
      startAt: '2026-06-16T10:00:00Z', endAt: '2026-06-16T10:15:00Z',
      recurringEventId: 'standup', originalStartAt: '2026-06-16T08:00:00Z'
    })
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T10:00:00Z', [master, moved]))

    const occurrences = createEventFeedService(h.db.sqlite).family(WINDOW)
    expect(occurrences.map((occurrence) => `${occurrence.title}@${occurrence.start}`)).toEqual([
      'Standup@2026-06-15T08:00:00Z',
      'Standup (late)@2026-06-16T10:00:00Z',
      'Standup@2026-06-17T08:00:00Z'
    ])
    h.db.close()
  })
})

const fixture = (name: string): string => readFileSync(join('tests/fixtures/caldav', name), 'utf8')

const SHARED_UID = 'shared-dinner@example.test'

/** A CalDAV account serving one event with the same UID the phone will push. */
function caldavFetcher(): typeof fetch {
  const events = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
 <response>
  <href>/12345678/calendars/home/shared.ics</href>
  <propstat>
   <prop>
    <getetag>"etag-shared"</getetag>
    <C:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:${SHARED_UID}
DTSTAMP:20260601T000000Z
DTSTART:20260615T180000Z
DTEND:20260615T190000Z
SUMMARY:Dinner (CalDAV)
END:VEVENT
END:VCALENDAR
</C:calendar-data>
   </prop>
   <status>HTTP/1.1 200 OK</status>
  </propstat>
 </response>
</multistatus>`
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method === 'REPORT') return new Response(events, { status: 207 })
    if (String(init?.body).includes('current-user-principal')) return new Response(fixture('icloud-principal.xml'), { status: 207 })
    if (url.includes('/principal/')) return new Response(fixture('icloud-home.xml'), { status: 207 })
    return new Response(fixture('nextcloud-collections.xml'), { status: 207 })
  }) as unknown as typeof fetch
}

describe('a window too large for one request body', () => {
  it('reconciles only the slice a chunk describes, so later chunks are not cancelled by earlier ones', async () => {
    const h = harness()
    const sourceId = await phoneSource(h)
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T09:00:00Z', []))
    await select(h, sourceId)

    const june = { start: '2026-06-01T00:00:00Z', end: '2026-06-16T00:00:00Z' }
    const july = { start: '2026-06-16T00:00:00Z', end: '2026-07-01T00:00:00Z' }
    const early = phoneEvent({ sourceEventId: 'early', title: 'Early', startAt: '2026-06-05T09:00:00Z', endAt: '2026-06-05T10:00:00Z' })
    const late = phoneEvent({ sourceEventId: 'late', title: 'Late', startAt: '2026-06-20T09:00:00Z', endAt: '2026-06-20T10:00:00Z' })

    const chunk = (pushedAt: string, window: { start: string; end: string }, events: unknown[]) =>
      h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, {
        pushedAt, window, calendars: [{ sourceCalendarId: 'phone:1', name: 'Personal', color: '#2F8FED', events }]
      })

    expect((await chunk('2026-06-10T10:00:00Z', june, [early])).status).toBe(200)
    expect((await chunk('2026-06-10T10:00:01Z', july, [late])).status).toBe(200)

    // The second chunk says nothing about June, so it must not cancel June's
    // event. Reconciling the whole calendar per chunk would leave only 'Late'.
    expect(createEventFeedService(h.db.sqlite).family(WINDOW).map((occurrence) => occurrence.title)).toEqual(['Early', 'Late'])

    // Within its own slice a chunk still reconciles: dropping 'Early' from a
    // later June chunk removes it, and leaves July alone.
    expect((await chunk('2026-06-10T10:00:02Z', june, [])).status).toBe(200)
    expect(createEventFeedService(h.db.sqlite).family(WINDOW).map((occurrence) => occurrence.title)).toEqual(['Late'])
    h.db.close()
  })
})

describe('phone and server-side sources pointing at the same calendar', () => {
  it('shows one occurrence, and it is the server-side copy', async () => {
    const h = harness({ fetcher: caldavFetcher() })

    // The CalDAV account the household already had.
    const caldav = JSON.parse((await h.call('POST', '/api/v1/calendar-sources', {
      kind: 'caldav', name: 'iCloud', baseUrl: 'https://caldav.example.test/', username: 'alice', password: 'app-password'
    })).body) as { id: string }
    const collections = JSON.parse((await h.call('GET', `/api/v1/calendar-sources/${caldav.id}/calendars`)).body) as { calendars: { id: string; name: string; color: string }[] }
    const personal = collections.calendars[0]!
    expect((await h.call('PUT', `/api/v1/calendar-sources/${caldav.id}/calendars`, {
      calendar: { ...personal, primary: false, readOnly: false }, selected: true, audiencePersonId: null
    })).status).toBe(204)
    await h.sources.syncSource(caldav.id)
    expect(createEventFeedService(h.db.sqlite).family(WINDOW).map((occurrence) => occurrence.title)).toEqual(['Dinner (CalDAV)'])

    // The same event, now also arriving from the phone that holds the calendar.
    const phone = await phoneSource(h)
    await h.call('POST', `/api/v1/calendar-sources/${phone}/push`, push('2026-06-10T09:00:00Z', []))
    await select(h, phone)
    await h.call('POST', `/api/v1/calendar-sources/${phone}/push`, push('2026-06-10T10:00:00Z', [
      phoneEvent({ sourceEventId: 'phone-dinner', icalUid: SHARED_UID, title: 'Dinner (phone)', startAt: '2026-06-15T18:00:00Z', endAt: '2026-06-15T19:00:00Z' }),
      phoneEvent({ sourceEventId: 'phone-only', icalUid: 'phone-only@phone', title: 'School run', startAt: '2026-06-17T07:30:00Z', endAt: '2026-06-17T08:00:00Z' })
    ]))

    const occurrences = createEventFeedService(h.db.sqlite).family(WINDOW)
    // Both rows are cached — the phone's copy is not deleted — but only the
    // server-side one, which stays fresh when nobody opens the app, is shown.
    expect(h.db.sqlite.prepare('SELECT count(*) AS count FROM events WHERE ical_uid = ?').get(SHARED_UID)).toEqual({ count: 2 })
    expect(occurrences.map((occurrence) => occurrence.title)).toEqual(['Dinner (CalDAV)', 'School run'])
    h.db.close()
  })

  it('shows the phone copy once it is the more recently edited one', async () => {
    const h = harness({ fetcher: caldavFetcher() })
    const caldav = JSON.parse((await h.call('POST', '/api/v1/calendar-sources', {
      kind: 'caldav', name: 'iCloud', baseUrl: 'https://caldav.example.test/', username: 'alice', password: 'app-password'
    })).body) as { id: string }
    const collections = JSON.parse((await h.call('GET', `/api/v1/calendar-sources/${caldav.id}/calendars`)).body) as { calendars: { id: string; name: string; color: string }[] }
    await h.call('PUT', `/api/v1/calendar-sources/${caldav.id}/calendars`, {
      calendar: { ...collections.calendars[0]!, primary: false, readOnly: false }, selected: true, audiencePersonId: null
    })
    await h.sources.syncSource(caldav.id)
    // The server-side copy was last touched a week ago.
    h.db.sqlite.prepare('UPDATE events SET remote_updated_at = ? WHERE ical_uid = ?').run('2026-06-01T00:00:00.000Z', SHARED_UID)

    // Then a parent edits that event on the phone that holds the calendar.
    const phone = await phoneSource(h)
    await h.call('POST', `/api/v1/calendar-sources/${phone}/push`, push('2026-06-10T09:00:00Z', []))
    await select(h, phone)
    await h.call('POST', `/api/v1/calendar-sources/${phone}/push`, push('2026-06-10T10:00:00Z', [
      phoneEvent({
        sourceEventId: 'phone-dinner', icalUid: SHARED_UID, title: 'Dinner (edited on the phone)',
        startAt: '2026-06-15T18:00:00Z', endAt: '2026-06-15T19:00:00Z', remoteUpdatedAt: '2026-06-09T20:00:00Z'
      })
    ]))

    // Which source is fresher is a property of the event, not of the source.
    expect(createEventFeedService(h.db.sqlite).family(WINDOW).map((occurrence) => occurrence.title))
      .toEqual(['Dinner (edited on the phone)'])
    h.db.close()
  })

  it('never deduplicates events that carry no UID', async () => {
    const h = harness()
    const sourceId = await phoneSource(h)
    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T09:00:00Z', []))
    await select(h, sourceId)

    await h.call('POST', `/api/v1/calendar-sources/${sourceId}/push`, push('2026-06-10T10:00:00Z', [
      phoneEvent({ sourceEventId: 'a', icalUid: null, title: 'Untitled A', startAt: '2026-06-15T18:00:00Z', endAt: '2026-06-15T19:00:00Z' }),
      phoneEvent({ sourceEventId: 'b', icalUid: null, title: 'Untitled B', startAt: '2026-06-15T18:00:00Z', endAt: '2026-06-15T19:00:00Z' })
    ]))

    expect(createEventFeedService(h.db.sqlite).family(WINDOW).map((occurrence) => occurrence.title)).toEqual(['Untitled A', 'Untitled B'])
    h.db.close()
  })
})
