import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SYNC_WINDOW_FUTURE_DAYS as SERVER_FUTURE_DAYS, SYNC_WINDOW_PAST_DAYS as SERVER_PAST_DAYS } from '../../src/server/sync/pull'
import type { DeviceCalendar, DeviceEvent } from '../../src/companion/src/api/phoneCalendarMapping'

/** These modules are browser modules: give them the globals the node test
 * environment lacks before importing anything that reads them. */
class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
  clear(): void { this.values.clear() }
}
const localStorageStub = new MemoryStorage()
Object.assign(globalThis, { localStorage: localStorageStub, sessionStorage: new MemoryStorage() })

const {
  MAX_EVENTS_PER_CALENDAR, MAX_PUSH_BYTES, SYNC_WINDOW_FUTURE_DAYS, SYNC_WINDOW_PAST_DAYS,
  buildCalendarPayloads, buildPushRequest, calendarDisplayName, canSplitRange, correctedPushOffset,
  limitCalendars, oversizeReason, phoneSyncWindow, sourceEventIdFor, splitRange, toPhoneEvent
} = await import('../../src/companion/src/api/phoneCalendarMapping')

const { cancelPhoneCalendarSync, getPhoneSyncState, syncPhoneCalendars } =
  await import('../../src/companion/src/api/phoneCalendarSync')

const TZ = 'Australia/Perth'

function event(overrides: Partial<DeviceEvent> & { id: string; startDate: number }): DeviceEvent {
  return { calendarId: 'cal-1', endDate: overrides.startDate + 3_600_000, ...overrides }
}

describe('mapping a phone occurrence to the push contract', () => {
  it('keys an occurrence by its series master and its own start, so repeated pushes reconcile instead of churn', () => {
    // Android: one master id, several occurrences, ids that repeat between them.
    const first = event({ id: 'row-9', masterId: '42', startDate: 1_700_000_000_000 })
    const second = event({ id: 'row-9', masterId: '42', startDate: 1_700_086_400_000 })
    expect(sourceEventIdFor(first)).toBe('42:1700000000000')
    expect(sourceEventIdFor(second)).toBe('42:1700086400000')
    expect(sourceEventIdFor(first)).not.toBe(sourceEventIdFor(second))
    // The same occurrence read again produces the same identity: this is what
    // stops every push replacing every row the previous push wrote.
    expect(sourceEventIdFor({ ...first })).toBe(sourceEventIdFor(first))
  })

  it('falls back to the event id where there is no master id, as on iOS', () => {
    expect(sourceEventIdFor(event({ id: 'EK-1', masterId: null, startDate: 1_700_000_000_000 }))).toBe('EK-1:1700000000000')
    expect(sourceEventIdFor(event({ id: 'EK-1', startDate: 1_700_000_000_000 }))).toBe('EK-1:1700000000000')
  })

  it('carries the fields the board renders and leaves every recurrence field null', () => {
    const mapped = toPhoneEvent(event({
      id: '7', masterId: '7', startDate: Date.parse('2026-03-01T09:00:00.000Z'), endDate: Date.parse('2026-03-01T10:00:00.000Z'),
      title: 'Swimming', description: 'Bring goggles', location: 'Pool', timezone: 'Europe/London', isAllDay: false,
      status: 'confirmed', calendarItemExternalIdentifier: 'uid-1@example.com', lastModifiedDate: Date.parse('2026-02-01T00:00:00.000Z')
    }), TZ)!
    expect(mapped.title).toBe('Swimming')
    expect(mapped.startAt).toBe('2026-03-01T09:00:00.000Z')
    expect(mapped.endAt).toBe('2026-03-01T10:00:00.000Z')
    expect(mapped.timezone).toBe('Europe/London')
    expect(mapped.icalUid).toBe('uid-1@example.com')
    expect(mapped.remoteUpdatedAt).toBe('2026-02-01T00:00:00.000Z')
    // The platform hands back expanded occurrences with no rule attached;
    // inventing one would expand differently on the server.
    expect(mapped.recurrence).toBeNull()
    expect(mapped.recurringEventId).toBeNull()
    expect(mapped.originalStartAt).toBeNull()
    expect(mapped.recurrenceExdates).toBeNull()
    expect(mapped.recurrenceRdates).toBeNull()
  })

  it('places an all-day event at local midnight on its date, not at the UTC midnight Android stores', () => {
    // 26 Sep 2026, all day, as Android keeps it: 00:00Z to 00:00Z next day, labelled UTC.
    const mapped = toPhoneEvent(event({
      id: '1', startDate: Date.UTC(2026, 8, 26), endDate: Date.UTC(2026, 8, 27), isAllDay: true, timezone: 'UTC'
    }), 'Europe/London')!
    expect(mapped.allDay).toBe(true)
    expect(mapped.timezone).toBe('Europe/London')
    // Midnight in London during BST is 23:00Z the evening before.
    expect(mapped.startAt).toBe('2026-09-25T23:00:00.000Z')
    expect(mapped.endAt).toBe('2026-09-26T23:00:00.000Z')
  })

  it('keeps an all-day event on the right date west of Greenwich too', () => {
    const mapped = toPhoneEvent(event({
      id: '1', startDate: Date.UTC(2026, 8, 26), endDate: Date.UTC(2026, 8, 28), isAllDay: true, timezone: 'UTC'
    }), 'America/New_York')!
    expect(mapped.startAt).toBe('2026-09-26T04:00:00.000Z')
    expect(mapped.endAt).toBe('2026-09-28T04:00:00.000Z')
  })

  it('gives an all-day event with no end, or an inverted one, a single day', () => {
    const one = toPhoneEvent(event({ id: '1', startDate: Date.UTC(2026, 8, 26), endDate: null, isAllDay: true }), 'Europe/London')!
    expect(one.endAt).toBe('2026-09-26T23:00:00.000Z')
    const inverted = toPhoneEvent(event({ id: '1', startDate: Date.UTC(2026, 8, 26), endDate: Date.UTC(2026, 8, 20), isAllDay: true }), 'Europe/London')!
    expect(inverted.endAt).toBe('2026-09-26T23:00:00.000Z')
  })

  it('uses the device timezone when the event carries none, as Android often does', () => {
    expect(toPhoneEvent(event({ id: '1', startDate: 1_700_000_000_000, timezone: null }), TZ)!.timezone).toBe(TZ)
    expect(toPhoneEvent(event({ id: '1', startDate: 1_700_000_000_000, timezone: '  ' }), TZ)!.timezone).toBe(TZ)
  })

  it('accepts the Android nulls without inventing values', () => {
    const mapped = toPhoneEvent(event({ id: '1', startDate: 1_700_000_000_000, calendarItemExternalIdentifier: null, lastModifiedDate: null }), TZ)!
    // No UID means no cross-source deduplication, which is correct, not broken.
    expect(mapped.icalUid).toBeNull()
    expect(mapped.remoteUpdatedAt).toBeNull()
    expect(mapped.title).toBe('')
  })

  it('treats only an explicit cancellation as cancelled', () => {
    expect(toPhoneEvent(event({ id: '1', startDate: 1, status: 'canceled' }), TZ)!.status).toBe('cancelled')
    expect(toPhoneEvent(event({ id: '1', startDate: 1, status: 'cancelled' }), TZ)!.status).toBe('cancelled')
    for (const status of ['confirmed', 'tentative', 'none', null, undefined, 'something-new']) {
      expect(toPhoneEvent(event({ id: '1', startDate: 1, status }), TZ)!.status).toBe('confirmed')
    }
  })

  it('truncates over-long text rather than letting one event fail the whole chunk', () => {
    const mapped = toPhoneEvent(event({
      id: '1', startDate: 1, title: 'a'.repeat(2000), description: 'b'.repeat(30_000), location: 'c'.repeat(2000)
    }), TZ)!
    expect(mapped.title).toHaveLength(1000)
    expect(mapped.description).toHaveLength(20_000)
    expect(mapped.location).toHaveLength(1000)
  })

  it('drops an occurrence with no usable start rather than pushing a broken instant', () => {
    expect(toPhoneEvent(event({ id: '1', startDate: Number.NaN }), TZ)).toBeNull()
    expect(toPhoneEvent(event({ id: '1', startDate: 8.64e15 + 1 }), TZ)).toBeNull()
  })

  it('never emits an end before its start', () => {
    const mapped = toPhoneEvent(event({ id: '1', startDate: 1_700_000_000_000, endDate: 1_600_000_000_000 }), TZ)!
    expect(mapped.endAt).toBe(mapped.startAt)
  })
})

describe('grouping a slice by calendar', () => {
  const calendars: DeviceCalendar[] = [
    { id: 'cal-1', title: 'Family' },
    { id: 'cal-2', title: 'Work', color: '#112233' }
  ]

  it('includes every calendar, even one with nothing in this slice', () => {
    const payload = buildCalendarPayloads(calendars, [event({ id: '1', startDate: 1, calendarId: 'cal-1' })], TZ)
    expect(payload.map((calendar) => calendar.sourceCalendarId)).toEqual(['cal-1', 'cal-2'])
    // An empty list is how a calendar whose last event in this window was
    // deleted gets that deletion reconciled. Omitting it leaves the event up.
    expect(payload[1].events).toEqual([])
    expect(payload[1].color).toBe('#112233')
  })

  it('drops events belonging to no calendar we are pushing rather than misfiling them', () => {
    const payload = buildCalendarPayloads(calendars, [
      event({ id: '1', startDate: 1, calendarId: 'cal-unknown' }),
      event({ id: '2', startDate: 1, calendarId: null })
    ], TZ)
    expect(payload.every((calendar) => calendar.events.length === 0)).toBe(true)
  })

  it('collapses a duplicate identity so one occurrence cannot overwrite itself', () => {
    const duplicate = event({ id: 'row-1', masterId: '5', startDate: 1_700_000_000_000 })
    const payload = buildCalendarPayloads(calendars, [duplicate, { ...duplicate }], TZ)
    expect(payload[0].events).toHaveLength(1)
  })

  it('names a calendar the platform did not title', () => {
    expect(calendarDisplayName({ id: 'x', title: null, internalTitle: 'Holidays' })).toBe('Holidays')
    expect(calendarDisplayName({ id: 'x', title: null, internalTitle: null, accountName: 'parent@example.com' })).toBe('parent@example.com')
    expect(calendarDisplayName({ id: 'x' })).toBe('Calendar x')
  })

  it('keeps the push inside the contract 50-calendar limit, stably', () => {
    const many = Array.from({ length: 62 }, (_, index) => ({ id: `cal-${index}`, title: `Calendar ${String(index).padStart(2, '0')}` }))
    const first = limitCalendars(many)
    const second = limitCalendars([...many].reverse())
    expect(first.shared).toHaveLength(50)
    expect(first.omitted).toBe(12)
    // Same 50 whatever order the phone returned them in: a set that changes
    // between pushes would have calendars take turns being reconciled away.
    expect(second.shared.map((calendar) => calendar.id)).toEqual(first.shared.map((calendar) => calendar.id))
  })
})

describe('the window this phone pushes', () => {
  it('matches the window the server itself syncs', () => {
    expect(SYNC_WINDOW_PAST_DAYS).toBe(SERVER_PAST_DAYS)
    expect(SYNC_WINDOW_FUTURE_DAYS).toBe(SERVER_FUTURE_DAYS)
  })

  it('reaches 30 days back and 400 forward', () => {
    const now = new Date('2026-06-15T00:00:00.000Z')
    const window = phoneSyncWindow(now)
    expect(window.start.toISOString()).toBe('2026-05-16T00:00:00.000Z')
    expect(window.end.toISOString()).toBe('2027-07-20T00:00:00.000Z')
  })

  it('halves into two contiguous ranges with no gap between them', () => {
    const range = { start: new Date('2026-01-01T00:00:00.000Z'), end: new Date('2026-01-11T00:00:00.000Z') }
    const [first, second] = splitRange(range)
    expect(first.start).toEqual(range.start)
    // Contiguity is the point: a gap is a stretch of the window no push ever
    // reconciles, so a deletion there would linger on the wall forever.
    expect(first.end).toEqual(second.start)
    expect(second.end).toEqual(range.end)
  })

  it('stops halving at a single day', () => {
    expect(canSplitRange({ start: new Date(0), end: new Date(86_400_000 * 2) })).toBe(true)
    expect(canSplitRange({ start: new Date(0), end: new Date(86_400_000) })).toBe(false)
  })

  it('knows when a payload is too big to send as one chunk', () => {
    const slice = { start: new Date('2026-01-01T00:00:00.000Z'), end: new Date('2026-02-01T00:00:00.000Z') }
    const calendars: DeviceCalendar[] = [{ id: 'cal-1', title: 'Family' }]
    const small = buildPushRequest('2026-01-01T00:00:00.000Z', slice, calendars, [event({ id: '1', startDate: 1 })], TZ)
    expect(oversizeReason(small)).toBeNull()

    const bulky = Array.from({ length: 400 }, (_, index) => event({ id: `e-${index}`, startDate: index, description: 'x'.repeat(2500) }))
    expect(oversizeReason(buildPushRequest('2026-01-01T00:00:00.000Z', slice, calendars, bulky, TZ))).toBe('bytes')

    const crowded = Array.from({ length: MAX_EVENTS_PER_CALENDAR + 1 }, (_, index) => event({ id: `e-${index}`, startDate: index }))
    expect(oversizeReason(buildPushRequest('2026-01-01T00:00:00.000Z', slice, calendars, crowded, TZ))).toBe('events')
  })

  it('leaves headroom under the server 1 MB limit for a bridge that re-encodes the body', () => {
    expect(MAX_PUSH_BYTES).toBeLessThan(1_048_576)
  })
})

describe('correcting a clock the server has already moved past', () => {
  it('steps just past the server value rather than retrying the same losing comparison', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    const offset = correctedPushOffset(['2026-01-01T00:05:00.000Z', '2026-01-01T00:02:00.000Z'], now, 0)
    expect(offset).toBe(5 * 60_000 + 1000)
  })

  it('keeps a correction it already had when the server is behind this phone', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    expect(correctedPushOffset(['2025-12-31T00:00:00.000Z'], now, 4000)).toBe(4000)
    expect(correctedPushOffset([], now, 4000)).toBe(4000)
  })

  it('refuses to adopt a nonsense timestamp as a clock difference', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    expect(correctedPushOffset(['2099-01-01T00:00:00.000Z'], now, 0)).toBe(365 * 86_400_000)
  })
})

/** The push itself, driven against a stubbed household server. Chunking and the
 * refusals are where a wrong window or a wrong timestamp silently deletes a
 * household's events, so they are exercised end to end rather than in pieces. */
interface PushBody {
  pushedAt: string
  window: { start: string; end: string }
  calendars: { sourceCalendarId: string; name: string; events: { sourceEventId: string; startAt: string }[] }[]
}

interface ServerScript {
  pushes: PushBody[]
  respond?: (body: PushBody, index: number) => { status: number; body?: unknown } | null
}

function stubHousehold(script: ServerScript): void {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    const reply = (status: number, body: unknown): Promise<Response> => Promise.resolve({
      status, ok: status < 400, headers: new Headers(), json: () => Promise.resolve(body)
    } as unknown as Response)

    if (url.endsWith('/push')) {
      const body = JSON.parse(String(init.body)) as PushBody
      const scripted = script.respond?.(body, script.pushes.length) ?? null
      if (scripted !== null) {
        if (scripted.status >= 400) return reply(scripted.status, scripted.body ?? { error: { code: 'error', message: 'refused' } })
      }
      script.pushes.push(body)
      return reply(200, {
        calendars: body.calendars.map((calendar) => ({
          sourceCalendarId: calendar.sourceCalendarId, selected: true, committed: calendar.events.length,
          lastPushedAt: body.pushedAt
        }))
      })
    }
    if (url.endsWith('/api/v1/calendar-sources') && init.method === 'POST') {
      return reply(201, { id: 'source-1', kind: 'phone', name: 'Test phone', connectedAt: '2026-01-01T00:00:00.000Z', lastSucceededAt: null, error: null })
    }
    if (url.endsWith('/api/v1/calendar-sources')) {
      return reply(200, { sources: [{ id: 'source-1', kind: 'phone', name: 'Test phone', connectedAt: '2026-01-01T00:00:00.000Z', lastSucceededAt: null, error: null }] })
    }
    return reply(404, { error: { code: 'not_found', message: 'no route' } })
  })
}

function readerFor(calendars: DeviceCalendar[], events: DeviceEvent[]) {
  return {
    timezone: () => TZ,
    checkPermission: () => Promise.resolve('granted' as const),
    listCalendars: () => Promise.resolve(calendars),
    // The platform returns everything that overlaps the range, not only what
    // starts inside it, and the client has to be correct against that.
    listEvents: (slice: { start: Date; end: Date }) => Promise.resolve(events.filter((candidate) => {
      const end = candidate.endDate ?? candidate.startDate
      return end > slice.start.getTime() && candidate.startDate < slice.end.getTime()
    }))
  }
}

function spread(count: number, calendarId: string, description = ''): DeviceEvent[] {
  const window = phoneSyncWindow(new Date())
  const span = window.end.getTime() - window.start.getTime()
  return Array.from({ length: count }, (_, index) => {
    const startDate = window.start.getTime() + Math.floor((span * index) / count)
    return { id: `${calendarId}-${index}`, masterId: null, calendarId, startDate, endDate: startDate + 3_600_000, title: `Event ${index}`, description }
  })
}

describe('pushing this phone to the household', () => {
  beforeEach(() => {
    localStorageStub.clear()
    vi.unstubAllGlobals()
    cancelPhoneCalendarSync()
  })

  it('creates one phone source, remembers it, and never creates a second', async () => {
    const script: ServerScript = { pushes: [] }
    stubHousehold(script)
    const reader = readerFor([{ id: 'cal-1', title: 'Family' }], spread(5, 'cal-1'))
    await syncPhoneCalendars({ force: true, reader })
    expect(localStorageStub.getItem('osl.phoneCalendar.sourceId')).toBe('source-1')
    await syncPhoneCalendars({ force: true, reader })
    expect(script.pushes).toHaveLength(2)
    expect(getPhoneSyncState().lastError).toBeNull()
    expect(getPhoneSyncState().calendars).toEqual([{ sourceCalendarId: 'cal-1', name: 'Family', shared: true, events: 5 }])
  })

  it('sends the whole window as one chunk when it fits', async () => {
    const script: ServerScript = { pushes: [] }
    stubHousehold(script)
    await syncPhoneCalendars({ force: true, reader: readerFor([{ id: 'cal-1', title: 'Family' }], spread(20, 'cal-1')) })
    expect(script.pushes).toHaveLength(1)
    const window = phoneSyncWindow(new Date())
    expect(Math.abs(Date.parse(script.pushes[0].window.start) - window.start.getTime())).toBeLessThan(5000)
    expect(Math.abs(Date.parse(script.pushes[0].window.end) - window.end.getTime())).toBeLessThan(5000)
    expect(script.pushes[0].calendars[0].events).toHaveLength(20)
  })

  it('chunks a window too large for one body, and every chunk describes exactly what it carries', async () => {
    const script: ServerScript = { pushes: [] }
    stubHousehold(script)
    const calendars: DeviceCalendar[] = [{ id: 'cal-1', title: 'Family' }, { id: 'cal-2', title: 'Work' }]
    const events = [...spread(600, 'cal-1', 'x'.repeat(1500)), ...spread(40, 'cal-2')]
    await syncPhoneCalendars({ force: true, reader: readerFor(calendars, events) })

    expect(script.pushes.length).toBeGreaterThan(1)
    const ordered = [...script.pushes].sort((left, right) => Date.parse(left.window.start) - Date.parse(right.window.start))
    const window = phoneSyncWindow(new Date())

    // The chunks tile the window: no gap that never reconciles, and no chunk
    // claiming ground it did not read.
    expect(Math.abs(Date.parse(ordered[0].window.start) - window.start.getTime())).toBeLessThan(10_000)
    expect(Math.abs(Date.parse(ordered[ordered.length - 1].window.end) - window.end.getTime())).toBeLessThan(10_000)
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index].window.start).toBe(ordered[index - 1].window.end)
    }

    // One snapshot, one timestamp: a second timestamp inside a run is exactly
    // the out-of-order push the server's ordering guard refuses.
    expect(new Set(script.pushes.map((push) => push.pushedAt)).size).toBe(1)

    for (const push of script.pushes) {
      // Every calendar in every chunk, so an emptied calendar still reconciles.
      expect(push.calendars.map((calendar) => calendar.sourceCalendarId).sort()).toEqual(['cal-1', 'cal-2'])
      const from = Date.parse(push.window.start)
      const to = Date.parse(push.window.end)
      for (const calendar of push.calendars) {
        // The data-loss condition, asserted directly: anything whose start sits
        // inside a chunk's window and is absent from that chunk is cancelled.
        const expected = events
          .filter((candidate) => candidate.calendarId === calendar.sourceCalendarId && candidate.startDate >= from && candidate.startDate < to)
          .map((candidate) => `${candidate.id}:${candidate.startDate}`)
          .sort()
        const present = calendar.events.map((pushed) => pushed.sourceEventId)
        expect(expected.every((identity) => present.includes(identity))).toBe(true)
      }
    }

    // And nothing is lost between the chunks either.
    const pushed = new Set(script.pushes.flatMap((push) => push.calendars.flatMap((calendar) => calendar.events.map((entry) => entry.sourceEventId))))
    expect(pushed.size).toBe(events.length)
  })

  it('halves the slice when the server refuses the body as too large', async () => {
    const script: ServerScript = {
      pushes: [],
      // Refuse anything wider than 120 days, whatever the client measured.
      respond: (body) => Date.parse(body.window.end) - Date.parse(body.window.start) > 120 * 86_400_000
        ? { status: 413, body: { error: { code: 'payload_too_large', message: 'too large' } } }
        : null
    }
    stubHousehold(script)
    await syncPhoneCalendars({ force: true, reader: readerFor([{ id: 'cal-1', title: 'Family' }], spread(30, 'cal-1')) })

    expect(script.pushes.length).toBeGreaterThan(1)
    const ordered = [...script.pushes].sort((left, right) => Date.parse(left.window.start) - Date.parse(right.window.start))
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index].window.start).toBe(ordered[index - 1].window.end)
    }
    expect(getPhoneSyncState().lastError).toBeNull()
    const pushed = new Set(script.pushes.flatMap((push) => push.calendars.flatMap((calendar) => calendar.events.map((entry) => entry.sourceEventId))))
    expect(pushed.size).toBe(30)
  })

  it('corrects its clock from a stale-push refusal instead of retrying the same timestamp', async () => {
    const serverLastPushedAt = new Date(Date.now() + 3_600_000).toISOString()
    const script: ServerScript = {
      pushes: [],
      respond: (body, index) => index === 0 && Date.parse(body.pushedAt) < Date.parse(serverLastPushedAt)
        ? { status: 409, body: { error: { code: 'conflict', message: 'stale' }, stale: [{ sourceCalendarId: 'cal-1', lastPushedAt: serverLastPushedAt }] } }
        : null
    }
    stubHousehold(script)
    await syncPhoneCalendars({ force: true, reader: readerFor([{ id: 'cal-1', title: 'Family' }], spread(3, 'cal-1')) })

    expect(script.pushes).toHaveLength(1)
    expect(Date.parse(script.pushes[0].pushedAt)).toBeGreaterThan(Date.parse(serverLastPushedAt))
    // The correction is remembered, so the next app launch does not have to
    // learn it again from another refused push.
    expect(Number(localStorageStub.getItem('osl.phoneCalendar.clockOffsetMs'))).toBeGreaterThan(3_500_000)
    expect(getPhoneSyncState().lastError).toBeNull()
  })

  it('gives up honestly on a repeated refusal rather than looping', async () => {
    const serverLastPushedAt = new Date(Date.now() + 3_600_000).toISOString()
    const script: ServerScript = {
      pushes: [],
      respond: () => ({ status: 409, body: { error: { code: 'conflict', message: 'stale' }, stale: [{ sourceCalendarId: 'cal-1', lastPushedAt: serverLastPushedAt }] } })
    }
    stubHousehold(script)
    await syncPhoneCalendars({ force: true, reader: readerFor([{ id: 'cal-1', title: 'Family' }], spread(3, 'cal-1')) })
    expect(script.pushes).toHaveLength(0)
    expect(getPhoneSyncState().lastError).toContain('clock')
  })

  it('pushes nothing at all without calendar permission, and says so without calling it an error', async () => {
    const script: ServerScript = { pushes: [] }
    stubHousehold(script)
    const reader = { ...readerFor([{ id: 'cal-1', title: 'Family' }], spread(3, 'cal-1')), checkPermission: () => Promise.resolve('denied' as const) }
    await syncPhoneCalendars({ force: true, reader })
    expect(script.pushes).toHaveLength(0)
    expect(getPhoneSyncState().permission).toBe('denied')
    expect(getPhoneSyncState().lastError).toBeNull()
  })

  it('keeps the last known good push time when a later push fails', async () => {
    const script: ServerScript = { pushes: [] }
    stubHousehold(script)
    const reader = readerFor([{ id: 'cal-1', title: 'Family' }], spread(3, 'cal-1'))
    await syncPhoneCalendars({ force: true, reader })
    const good = getPhoneSyncState().lastPushedAt
    expect(good).not.toBeNull()

    stubHousehold({ pushes: [], respond: () => ({ status: 500, body: { error: { code: 'internal_error', message: 'boom' } } }) })
    await syncPhoneCalendars({ force: true, reader })
    expect(getPhoneSyncState().lastPushedAt).toBe(good)
    expect(getPhoneSyncState().lastError).not.toBeNull()
  })
})
