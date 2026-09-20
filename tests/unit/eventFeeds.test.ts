import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openServerDatabase } from '../../src/server/db'
import { createEventFeedService } from '../../src/server/domain/eventFeeds'

const directories: string[] = []
const timestamp = '2026-06-01T00:00:00.000Z'

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'openskylight-event-feeds-'))
  directories.push(directory)
  const db = openServerDatabase(join(directory, 'server.sqlite'))
  db.sqlite.prepare('INSERT INTO calendar_sources (id, kind, name, connected_at) VALUES (?, ?, ?, ?)')
    .run('source', 'caldav', 'Household CalDAV', timestamp)
  const person = (id: string, name: string, role: 'parent' | 'child') => db.sqlite.prepare(
    'INSERT INTO people (id, name, normalized_name, color, role, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, name, name.toLowerCase(), '#fff', role, 0, timestamp)
  person('parent', 'Parent', 'parent')
  person('ava', 'Ava', 'child')
  person('leo', 'Leo Smith', 'child')
  const calendar = (id: string, mappedPersonId: string | null) => db.sqlite.prepare(
    'INSERT INTO calendars (id, source_id, source_calendar_id, audience_person_id, name, selected) VALUES (?, ?, ?, ?, ?, 1)'
  ).run(id, 'source', id, mappedPersonId, id)
  calendar('family', null)
  calendar('ava-calendar', 'ava')
  calendar('parent-calendar', 'parent')
  const event = (input: { id: string; calendarId: string; sourceEventId: string; title: string; description?: string | null; start: string; end: string; timezone?: string; recurrence?: string | null; recurringSourceId?: string | null; originalStart?: string | null; status?: 'confirmed' | 'cancelled' }) => {
    db.sqlite.prepare(`INSERT INTO events (id, calendar_id, source_event_id, title, description, start_at, end_at, timezone, recurrence,
      recurring_event_id, original_start_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.id, input.calendarId, input.sourceEventId, input.title, input.description ?? null, input.start, input.end,
        input.timezone ?? 'UTC', input.recurrence ?? null, input.recurringSourceId ?? null, input.originalStart ?? null, input.status ?? 'confirmed', timestamp, timestamp)
  }
  return { db, event, feeds: createEventFeedService(db.sqlite) }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const window = { start: '2026-06-01T00:00:00Z', end: '2026-06-20T00:00:00Z' }

describe('cached calendar event feeds', () => {
  it('keeps every active ordinary and recurring occurrence in Family while personal feeds use derived audiences', () => {
    const { event, feeds } = setup()
    event({ id: 'family', calendarId: 'family', sourceEventId: 'family', title: 'Family dinner', start: '2026-06-02T18:00:00Z', end: '2026-06-02T19:00:00Z' })
    event({ id: 'ava', calendarId: 'ava-calendar', sourceEventId: 'ava', title: 'Swimming', start: '2026-06-03T10:00:00Z', end: '2026-06-03T11:00:00Z' })
    event({ id: 'series', calendarId: 'family', sourceEventId: 'series-source', title: 'Ava and Leo Smith practice', start: '2026-06-04T10:00:00Z', end: '2026-06-04T11:00:00Z', recurrence: 'FREQ=WEEKLY;COUNT=2' })

    expect(feeds.family(window).map((occurrence) => occurrence.title)).toEqual([
      'Family dinner', 'Swimming', 'Ava and Leo Smith practice', 'Ava and Leo Smith practice'
    ])
    expect(feeds.personal('ava', window).map((occurrence) => occurrence.title)).toEqual([
      'Swimming', 'Ava and Leo Smith practice', 'Ava and Leo Smith practice'
    ])
    expect(feeds.personal('leo', window).map((occurrence) => occurrence.title)).toEqual([
      'Ava and Leo Smith practice', 'Ava and Leo Smith practice'
    ])
    expect(feeds.personal('parent', window)).toEqual([])
  })

  it('adds and deduplicates calendar mapping and child-name inference, while leaving empty audiences Family-only', () => {
    const { event, feeds } = setup()
    event({ id: 'mapped-and-named', calendarId: 'ava-calendar', sourceEventId: 'mapped-and-named', title: 'Ava & Leo Smith playdate', description: '<p>AVA attends</p>', start: '2026-06-02T10:00:00Z', end: '2026-06-02T11:00:00Z' })
    event({ id: 'parent-mapped', calendarId: 'parent-calendar', sourceEventId: 'parent-mapped', title: 'Parent work', start: '2026-06-03T10:00:00Z', end: '2026-06-03T11:00:00Z' })
    event({ id: 'family-only', calendarId: 'family', sourceEventId: 'family-only', title: 'Family catchup', start: '2026-06-04T10:00:00Z', end: '2026-06-04T11:00:00Z' })
    event({ id: 'cancelled', calendarId: 'family', sourceEventId: 'cancelled', title: 'Removed', start: '2026-06-05T10:00:00Z', end: '2026-06-05T11:00:00Z', status: 'cancelled' })
    const all = feeds.family(window)

    expect(all.find((occurrence) => occurrence.eventId === 'mapped-and-named')?.personIds).toEqual(['ava', 'leo'])
    expect(all.find((occurrence) => occurrence.eventId === 'family-only')?.personIds).toEqual([])
    expect(all.map((occurrence) => occurrence.eventId)).not.toContain('cancelled')
    expect(feeds.personal('ava', window).map((occurrence) => occurrence.eventId)).toEqual(['mapped-and-named'])
    expect(feeds.personal('leo', window).map((occurrence) => occurrence.eventId)).toEqual(['mapped-and-named'])
    expect(feeds.personal('parent', window).map((occurrence) => occurrence.eventId)).toEqual(['parent-mapped'])
  })

  it('uses exception text for a recurring occurrence and continues to derive audiences after a child rename', () => {
    const { db, event, feeds } = setup()
    event({ id: 'master', calendarId: 'family', sourceEventId: 'series-source', title: 'Practice', start: '2026-06-04T10:00:00Z', end: '2026-06-04T11:00:00Z', recurrence: 'FREQ=WEEKLY;COUNT=2' })
    event({ id: 'exception', calendarId: 'family', sourceEventId: 'series-source_20260611', title: 'Ava recital', start: '2026-06-11T12:00:00Z', end: '2026-06-11T13:00:00Z', recurringSourceId: 'series-source', originalStart: '2026-06-11T10:00:00Z' })

    expect(feeds.personal('ava', window).map((occurrence) => occurrence.eventId)).toEqual(['exception'])
    db.sqlite.prepare("UPDATE people SET name = 'Nora', normalized_name = 'nora' WHERE id = 'ava'").run()
    expect(feeds.personal('ava', window)).toEqual([])
  })

  it('continues serving valid events when a cached upstream event has malformed time data', () => {
    const { event, feeds } = setup()
    event({ id: 'valid', calendarId: 'family', sourceEventId: 'valid', title: 'Family dinner', start: '2026-06-02T18:00:00Z', end: '2026-06-02T19:00:00Z' })
    event({ id: 'broken', calendarId: 'family', sourceEventId: 'broken', title: 'Broken source event', start: 'not-a-date', end: 'also-not-a-date' })
    expect(feeds.family(window).map((occurrence) => occurrence.title)).toEqual(['Family dinner'])
  })
})
