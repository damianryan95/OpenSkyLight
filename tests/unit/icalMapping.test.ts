import { describe, expect, it } from 'vitest'
import { mapCalendarDocument } from '../../src/server/sync/ical'

const wrap = (events: string): string => `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Test//EN\n${events}END:VCALENDAR`
const byId = (body: string) => new Map(mapCalendarDocument(body, 'Europe/London').map((event) => [event.sourceEventId, event]))

describe('iCalendar mapping', () => {
  it('converts zoned, floating, UTC, and all-day times against the household zone', () => {
    const events = byId(wrap(
      `BEGIN:VEVENT\nUID:zoned\nDTSTART;TZID=Europe/London:20260615T190000\nDTEND;TZID=Europe/London:20260615T200000\nSUMMARY:Zoned\nEND:VEVENT\n` +
      `BEGIN:VEVENT\nUID:utc\nDTSTART:20260615T190000Z\nDTEND:20260615T200000Z\nSUMMARY:Utc\nEND:VEVENT\n` +
      `BEGIN:VEVENT\nUID:floating\nDTSTART:20260615T190000\nDTEND:20260615T200000\nSUMMARY:Floating\nEND:VEVENT\n` +
      `BEGIN:VEVENT\nUID:allday\nDTSTART;VALUE=DATE:20260620\nDTEND;VALUE=DATE:20260621\nSUMMARY:All day\nEND:VEVENT\n`
    ))

    // June is BST, so a 19:00 local start is 18:00Z, while an explicit Z time stands.
    expect(events.get('zoned')).toMatchObject({ startAt: '2026-06-15T18:00:00Z', timezone: 'Europe/London', allDay: false })
    expect(events.get('utc')).toMatchObject({ startAt: '2026-06-15T19:00:00Z', timezone: 'UTC' })
    expect(events.get('floating')).toMatchObject({ startAt: '2026-06-15T18:00:00Z', timezone: 'Europe/London' })
    expect(events.get('allday')).toMatchObject({ startAt: '2026-06-19T23:00:00Z', allDay: true })
  })

  it('keeps a winter zoned time on GMT rather than applying a fixed offset', () => {
    const events = byId(wrap(`BEGIN:VEVENT\nUID:winter\nDTSTART;TZID=Europe/London:20260115T190000\nDTEND;TZID=Europe/London:20260115T200000\nSUMMARY:Winter\nEND:VEVENT\n`))
    expect(events.get('winter')).toMatchObject({ startAt: '2026-01-15T19:00:00Z' })
  })

  it('carries the recurrence rule and its exception dates through to the cache', () => {
    const events = byId(wrap(
      `BEGIN:VEVENT\nUID:series\nDTSTART;TZID=Europe/London:20260602T100000\nDTEND;TZID=Europe/London:20260602T110000\n` +
      `RRULE:FREQ=WEEKLY;COUNT=4\nEXDATE;TZID=Europe/London:20260609T100000\nSUMMARY:Swimming\nEND:VEVENT\n`
    ))
    expect(events.get('series')).toMatchObject({
      recurrence: 'FREQ=WEEKLY;COUNT=4',
      recurrenceExdates: '["2026-06-09T09:00:00Z"]',
      recurringEventId: null
    })
  })

  it('gives a RECURRENCE-ID override its own identity so it cannot collide with its master', () => {
    const events = byId(wrap(
      `BEGIN:VEVENT\nUID:series\nDTSTART;TZID=Europe/London:20260602T100000\nDTEND;TZID=Europe/London:20260602T110000\nRRULE:FREQ=WEEKLY;COUNT=4\nSUMMARY:Swimming\nEND:VEVENT\n` +
      `BEGIN:VEVENT\nUID:series\nRECURRENCE-ID;TZID=Europe/London:20260616T100000\nDTSTART;TZID=Europe/London:20260616T120000\nDTEND;TZID=Europe/London:20260616T130000\nSUMMARY:Swimming (moved)\nEND:VEVENT\n`
    ))

    expect([...events.keys()]).toEqual(['series', 'series::2026-06-16T09:00:00Z'])
    expect(events.get('series::2026-06-16T09:00:00Z')).toMatchObject({
      recurringEventId: 'series',
      originalStartAt: '2026-06-16T09:00:00Z',
      startAt: '2026-06-16T11:00:00Z'
    })
  })

  it('derives an end from DURATION, and falls back when neither is present', () => {
    const events = byId(wrap(
      `BEGIN:VEVENT\nUID:duration\nDTSTART;TZID=Europe/London:20260615T190000\nDURATION:PT90M\nSUMMARY:Duration\nEND:VEVENT\n` +
      `BEGIN:VEVENT\nUID:neither\nDTSTART;TZID=Europe/London:20260615T190000\nSUMMARY:Neither\nEND:VEVENT\n`
    ))
    expect(events.get('duration')).toMatchObject({ endAt: '2026-06-15T19:30:00Z' })
    expect(events.get('neither')).toMatchObject({ endAt: '2026-06-15T19:00:00Z' })
  })

  it('marks a cancelled event rather than dropping it, so the board can clear it', () => {
    const events = byId(wrap(`BEGIN:VEVENT\nUID:off\nDTSTART;TZID=Europe/London:20260615T190000\nDTEND;TZID=Europe/London:20260615T200000\nSTATUS:CANCELLED\nSUMMARY:Off\nEND:VEVENT\n`))
    expect(events.get('off')).toMatchObject({ status: 'cancelled' })
  })

  it('skips unusable components without failing the surrounding document', () => {
    const events = byId(wrap(
      `BEGIN:VEVENT\nDTSTART:20260615T190000Z\nSUMMARY:No uid\nEND:VEVENT\n` +
      `BEGIN:VEVENT\nUID:no-start\nSUMMARY:No start\nEND:VEVENT\n` +
      `BEGIN:VEVENT\nUID:good\nDTSTART:20260615T190000Z\nDTEND:20260615T200000Z\nSUMMARY:Good\nEND:VEVENT\n`
    ))
    expect([...events.keys()]).toEqual(['good'])
  })

  it('returns nothing for a document that is not a calendar', () => {
    expect(mapCalendarDocument('BEGIN:VCARD\nVERSION:3.0\nEND:VCARD', 'Europe/London')).toEqual([])
  })
})
