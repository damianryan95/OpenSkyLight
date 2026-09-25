import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { CalendarSourceDto, PushPhoneCalendarsRequest } from '../../shared/api/contract'
import { fromIso, isoUtc } from '../../shared/dates'
import { DomainValidationError } from '../domain/errors'
import { createCalDavClient, fetchIcsFeed, CalDavError, type CalDavCollection, type Fetcher } from './caldav'
import { mapCalendarDocument, type CachedIcalEvent } from './ical'
import { commitCalendarEvents, syncWindow } from './pull'
import { applicationKey, decryptSecret, encryptSecret } from './secrets'
import type { CalendarSyncStatusService } from './status'
import { createCalDavWriteBack } from './writeBack'
import type { EventWriteService } from '../domain/eventWrites'

interface SourceRow {
  id: string
  kind: 'caldav' | 'ics' | 'phone' | 'local'
  name: string
  connected_at: string
  last_succeeded_at: string | null
  last_error: string | null
  base_url: string | null
  username: string | null
  password_enc: Buffer | null
}

interface StoredCalendarRow {
  id: string
  source_calendar_id: string
  selected: number
  last_pushed_at: string | null
}

export interface PhonePushCalendarResult {
  sourceCalendarId: string
  selected: boolean
  committed: number
  lastPushedAt: string
}

export type PhonePushResult =
  | { applied: true; calendars: PhonePushCalendarResult[] }
  | { applied: false; stale: { sourceCalendarId: string; lastPushedAt: string }[] }

/**
 * A pushed event in the cache's own shape. The phone holds no HTTP entity tag,
 * so `etag` is null and the commit compares rows rather than tags — exactly as
 * an ICS feed already does. Times are normalised to UTC here so a phone that
 * sends local offsets stores the same instants a CalDAV sync would.
 */
function toCachedEvent(event: PushPhoneCalendarsRequest['calendars'][number]['events'][number]): CachedIcalEvent {
  const utc = (value: string | null | undefined): string | null => (value == null ? null : isoUtc(fromIso(value)))
  const utcList = (values: readonly string[] | null | undefined): string | null =>
    values == null || values.length === 0 ? null : JSON.stringify(values.map((value) => isoUtc(fromIso(value))))
  return {
    sourceEventId: event.sourceEventId,
    etag: null,
    icalUid: event.icalUid ?? null,
    title: event.title,
    description: event.description ?? null,
    location: event.location ?? null,
    startAt: utc(event.startAt)!,
    endAt: utc(event.endAt)!,
    timezone: event.timezone,
    allDay: event.allDay,
    recurrence: event.recurrence ?? null,
    recurrenceExdates: utcList(event.recurrenceExdates),
    recurrenceRdates: utcList(event.recurrenceRdates),
    recurringEventId: event.recurringEventId ?? null,
    originalStartAt: utc(event.originalStartAt),
    status: event.status,
    remoteUpdatedAt: utc(event.remoteUpdatedAt)
  }
}

export interface CalendarSourceServiceOptions {
  now?: () => Date
  fetcher?: Fetcher
  status?: CalendarSyncStatusService
  onEventsChanged?: () => void
  /** The outbound queue. Absent in read-only contexts and older tests, in which
   * case nothing is written outward and sync behaves exactly as it did. */
  writes?: EventWriteService
}

const SELECT_SOURCE = `SELECT id, kind, name, connected_at, last_succeeded_at, last_error, base_url, username, password_enc
  FROM calendar_sources WHERE id = ? AND deleted_at IS NULL`

export function createCalendarSourceService(
  sqlite: Database.Database,
  householdTimezone: () => string,
  options: CalendarSourceServiceOptions = {}
) {
  const now = options.now ?? (() => new Date())
  const fetcher = options.fetcher ?? fetch

  function toDto(row: SourceRow): CalendarSourceDto {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      connectedAt: row.connected_at,
      lastSucceededAt: row.last_succeeded_at,
      error: row.last_error
    }
  }

  function requireSource(id: string): SourceRow {
    const row = sqlite.prepare<[string], SourceRow>(SELECT_SOURCE).get(id)
    if (row === undefined) throw new DomainValidationError('Calendar source not found.')
    return row
  }

  /**
   * The calendars the household has *connected*. The board's own calendar is
   * excluded deliberately: it is seeded rather than connected, cannot be
   * removed, and has no address or credential to show. Listing it beside real
   * accounts would offer a parent a disconnect button that must always refuse.
   */
  function list(): CalendarSourceDto[] {
    return sqlite.prepare<[], SourceRow>(`SELECT id, kind, name, connected_at, last_succeeded_at, last_error, base_url, username, password_enc
      FROM calendar_sources WHERE deleted_at IS NULL AND kind != 'local' ORDER BY connected_at`).all().map(toDto)
  }

  function clientFor(row: SourceRow) {
    if (row.kind !== 'caldav' || row.base_url === null || row.username === null || row.password_enc === null) {
      throw new DomainValidationError('This calendar source is not a CalDAV account.')
    }
    const password = decryptSecret(applicationKey(sqlite), row.id, row.password_enc)
    return createCalDavClient({ baseUrl: row.base_url, username: row.username, password }, fetcher)
  }

  /** Verifies the credentials before storing them, so a typo fails loudly. */
  async function connectCalDav(input: { name: string; baseUrl: string; username: string; password: string }): Promise<CalendarSourceDto> {
    const name = input.name.trim()
    if (!name) throw new DomainValidationError('Give this calendar account a name.')
    if (!input.username.trim() || !input.password) throw new DomainValidationError('A username and app password are required.')
    const id = randomUUID()
    const client = createCalDavClient({ baseUrl: input.baseUrl, username: input.username.trim(), password: input.password }, fetcher)
    await client.discover()
    const timestamp = now().toISOString()
    sqlite.prepare(`INSERT INTO calendar_sources (id, kind, name, connected_at, base_url, username, password_enc)
      VALUES (?, 'caldav', ?, ?, ?, ?, ?)`)
      .run(id, name, timestamp, input.baseUrl, input.username.trim(), encryptSecret(applicationKey(sqlite), id, input.password))
    return toDto(requireSource(id))
  }

  /** An ICS feed is one calendar, so connecting it also creates that calendar. */
  async function connectIcs(input: { name: string; url: string }): Promise<CalendarSourceDto> {
    const name = input.name.trim()
    if (!name) throw new DomainValidationError('Give this calendar feed a name.')
    await fetchIcsFeed(input.url, fetcher)
    const id = randomUUID()
    const timestamp = now().toISOString()
    sqlite.transaction(() => {
      sqlite.prepare("INSERT INTO calendar_sources (id, kind, name, connected_at, base_url) VALUES (?, 'ics', ?, ?, ?)")
        .run(id, name, timestamp, input.url)
      // A subscription feed is read-only by nature: there is no protocol to
      // write one back, so the routing rule must never target it.
      sqlite.prepare('INSERT INTO calendars (id, source_id, source_calendar_id, name, selected, read_only) VALUES (?, ?, ?, ?, 1, 1)')
        .run(randomUUID(), id, input.url, name)
    })()
    return toDto(requireSource(id))
  }

  /**
   * Registers a phone as a calendar source. There is no address to reach and no
   * credential to verify — the phone pushes to us — so there is nothing here to
   * fail, and nothing to store that could later leak.
   */
  function connectPhone(input: { name: string }): CalendarSourceDto {
    const name = input.name.trim()
    if (!name) throw new DomainValidationError('Give this phone a name.')
    const id = randomUUID()
    sqlite.prepare("INSERT INTO calendar_sources (id, kind, name, connected_at) VALUES (?, 'phone', ?, ?)")
      .run(id, name, now().toISOString())
    return toDto(requireSource(id))
  }

  /** Remote collections, annotated with the household's current selection. */
  async function discoverCollections(sourceId: string): Promise<(CalDavCollection & { selected: boolean; audiencePersonId: string | null })[]> {
    const row = requireSource(sourceId)
    // A phone announces its own catalogue by pushing; there is nothing to
    // discover over the network, and asking a CalDAV client would simply throw.
    // Unselected rows exist here, so selection is the column, not the presence.
    if (row.kind === 'phone') {
      return sqlite.prepare<[string], { source_calendar_id: string; name: string; color: string; selected: number; audience_person_id: string | null; read_only: number }>(
        'SELECT source_calendar_id, name, color, selected, audience_person_id, read_only FROM calendars WHERE source_id = ? AND deleted_at IS NULL ORDER BY name, source_calendar_id'
      ).all(sourceId).map((calendar) => ({
        url: calendar.source_calendar_id,
        name: calendar.name,
        color: calendar.color,
        // Writable since N06: the board queues the write and the phone drains
        // the queue and applies it through the OS calendar API.
        readOnly: calendar.read_only === 1,
        selected: calendar.selected === 1,
        audiencePersonId: calendar.audience_person_id
      }))
    }
    const collections = await clientFor(row).discover()
    const selected = sqlite.prepare<[string], { source_calendar_id: string; audience_person_id: string | null }>(
      'SELECT source_calendar_id, audience_person_id FROM calendars WHERE source_id = ? AND deleted_at IS NULL'
    ).all(sourceId)
    const byId = new Map(selected.map((calendar) => [calendar.source_calendar_id, calendar]))
    return collections.map((collection) => ({
      ...collection,
      selected: byId.has(collection.url),
      audiencePersonId: byId.get(collection.url)?.audience_person_id ?? null
    }))
  }

  function setCalendarSelection(input: { sourceId: string; url: string; name: string; color: string; selected: boolean; audiencePersonId: string | null; readOnly?: boolean }): void {
    const row = requireSource(input.sourceId)
    if (input.audiencePersonId !== null) {
      const person = sqlite.prepare<[string], { id: string }>('SELECT id FROM people WHERE id = ? AND deleted_at IS NULL').get(input.audiencePersonId)
      if (person === undefined) throw new DomainValidationError('Choose a current household member.')
    }
    const existing = sqlite.prepare<[string, string], { id: string }>(
      'SELECT id FROM calendars WHERE source_id = ? AND source_calendar_id = ?'
    ).get(row.id, input.url)
    if (!input.selected) {
      if (existing !== undefined) {
        // Dropping a calendar drops its cached events with it, so the board
        // cannot keep showing a calendar the parent just removed.
        sqlite.prepare('DELETE FROM calendars WHERE id = ?').run(existing.id)
      }
      return
    }
    // An ICS feed is read-only whatever the caller claims; everything else is
    // taken at its word, which for CalDAV is its own reported privilege set.
    const readOnly = row.kind === 'ics' || input.readOnly ? 1 : 0
    if (existing === undefined) {
      sqlite.prepare('INSERT INTO calendars (id, source_id, source_calendar_id, audience_person_id, name, color, selected, read_only) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
        .run(randomUUID(), row.id, input.url, input.audiencePersonId, input.name, input.color, readOnly)
    } else {
      sqlite.prepare('UPDATE calendars SET audience_person_id = ?, name = ?, color = ?, selected = 1, read_only = ?, deleted_at = NULL WHERE id = ?')
        .run(input.audiencePersonId, input.name, input.color, readOnly, existing.id)
    }
  }

  /**
   * Applies one full-window snapshot pushed by a paired phone.
   *
   * The phone is the only thing that can read its own calendar store, so this
   * is the inverse of every other source: nothing is fetched, and the payload
   * is staged in memory by the caller's parser before a single transaction
   * commits it. Calendars the parent has not selected are catalogued so they
   * appear in the selection UI, but their events never reach the board.
   */
  function pushPhoneCalendars(sourceId: string, payload: PushPhoneCalendarsRequest): PhonePushResult {
    const row = requireSource(sourceId)
    if (row.kind !== 'phone') throw new DomainValidationError('Only a phone source accepts a calendar push.')
    const pushedAt = isoUtc(fromIso(payload.pushedAt))

    const stored = new Map(sqlite.prepare<[string], StoredCalendarRow>(
      'SELECT id, source_calendar_id, selected, last_pushed_at FROM calendars WHERE source_id = ? AND deleted_at IS NULL'
    ).all(row.id).map((calendar) => [calendar.source_calendar_id, calendar]))

    // Out of order, not merely repeated: a snapshot older than the one already
    // applied would resurrect events a newer push had reconciled away. The
    // whole push is refused rather than partially applied, and the server's own
    // value goes back so a phone with a skewed clock can correct itself instead
    // of losing every push it makes from here on.
    const stale = payload.calendars
      .map((calendar) => ({ calendar, existing: stored.get(calendar.sourceCalendarId) }))
      .filter(({ existing }) => existing?.last_pushed_at != null && Date.parse(pushedAt) < Date.parse(existing.last_pushed_at))
      .map(({ calendar, existing }) => ({ sourceCalendarId: calendar.sourceCalendarId, lastPushedAt: existing!.last_pushed_at! }))
    if (stale.length > 0) return { applied: false, stale }

    const timestamp = now().toISOString()
    const results: PhonePushCalendarResult[] = []
    const committedCalendarIds: string[] = []
    let changed = false

    sqlite.transaction(() => {
      for (const calendar of payload.calendars) {
        const existing = stored.get(calendar.sourceCalendarId)
        let calendarId: string
        let selected: boolean
        if (existing === undefined) {
          // Unselected on arrival: a calendar the parent has never chosen must
          // become visible to choose, not visible on the wall.
          calendarId = randomUUID()
          selected = false
          sqlite.prepare('INSERT INTO calendars (id, source_id, source_calendar_id, name, color, selected) VALUES (?, ?, ?, ?, COALESCE(?, \'#0091FF\'), 0)')
            .run(calendarId, row.id, calendar.sourceCalendarId, calendar.name, calendar.color ?? null)
        } else {
          calendarId = existing.id
          selected = existing.selected === 1
          // The phone owns its calendars' names and colours; the parent owns
          // the selection and the person mapping, so neither is touched here.
          sqlite.prepare('UPDATE calendars SET name = ?, color = COALESCE(?, color) WHERE id = ?')
            .run(calendar.name, calendar.color ?? null, calendarId)
        }

        if (selected) {
          options.status?.start(calendarId)
          // Scoped to the pushed window: a phone slices a large window into
          // several pushes to stay under the body limit, and a slice says
          // nothing about the events outside it.
          const result = commitCalendarEvents(sqlite, calendarId, calendar.events.map(toCachedEvent), timestamp, { start: isoUtc(fromIso(payload.window.start)), end: isoUtc(fromIso(payload.window.end)) })
          changed = changed || result.changed
          committedCalendarIds.push(calendarId)
        }
        sqlite.prepare('UPDATE calendars SET last_pushed_at = ? WHERE id = ?').run(pushedAt, calendarId)
        results.push({
          sourceCalendarId: calendar.sourceCalendarId,
          selected,
          committed: selected ? calendar.events.length : 0,
          lastPushedAt: pushedAt
        })
      }
      sqlite.prepare('UPDATE calendar_sources SET last_attempted_at = ?, last_succeeded_at = ?, last_error = NULL WHERE id = ?')
        .run(timestamp, timestamp, row.id)
    })()

    for (const calendarId of committedCalendarIds) options.status?.succeed(calendarId)
    if (changed) options.onEventsChanged?.()
    return { applied: true, calendars: results }
  }

  function remove(sourceId: string): void {
    const row = requireSource(sourceId)
    // The board's own calendar is not a connection and there is nothing to
    // disconnect. Removing it would cascade away every event the household
    // authored here, which is the one thing it can never be allowed to do.
    if (row.kind === 'local') throw new DomainValidationError('The OpenSkyLight calendar cannot be removed.')
    // Calendars and their events cascade from the source row.
    sqlite.prepare('DELETE FROM calendar_sources WHERE id = ?').run(row.id)
  }

  async function syncSource(sourceId: string): Promise<{ changed: boolean }> {
    const row = requireSource(sourceId)
    // A phone is pushed from, never pulled, and the board's own calendar has no
    // remote at all. Falling through would ask the CalDAV client for a source
    // with no address and record that refusal as a sync failure on every
    // scheduler tick, so data that is perfectly fresh would report as broken.
    if (row.kind === 'phone' || row.kind === 'local') return { changed: false }
    const calendars = sqlite.prepare<[string], { id: string; source_calendar_id: string }>(
      'SELECT id, source_calendar_id FROM calendars WHERE source_id = ? AND selected = 1 AND deleted_at IS NULL'
    ).all(row.id)
    if (calendars.length === 0) return { changed: false }

    const window = syncWindow(now())
    let changed = false
    let failure: Error | null = null

    // Resolving the household timezone can fail before the first parent setup
    // completes. That must surface as a recorded sync error, not a silent
    // no-op that leaves the board looking merely unsynced.
    let timezone: string | null = null
    try {
      timezone = householdTimezone()
    } catch {
      failure = new Error('Set the household timezone before connecting a calendar.')
    }

    // Outward writes go first, so the pull immediately below reads a collection
    // that already contains them. The other order would read the collection
    // without our change, commit that, and make the board flicker back to the
    // old version until the next tick.
    if (timezone !== null && row.kind === 'caldav' && options.writes !== undefined) {
      try {
        await createCalDavWriteBack(sqlite, options.writes, {
          now, householdTimezone: () => timezone!, onEventsChanged: options.onEventsChanged
        }).drainSource(row.id, clientFor(row))
      } catch (error) {
        // The queue records its own per-write failures, so reaching here means
        // the drain itself could not start. The pull must still happen: a
        // household whose write cannot go out still needs a fresh board.
        failure = error instanceof Error ? error : new Error('Calendar write-back failed.')
      }
    }

    if (timezone !== null) {
      for (const calendar of calendars) {
        options.status?.start(calendar.id)
        try {
          const documents = row.kind === 'ics'
            ? [await fetchIcsFeed(row.base_url!, fetcher)]
            : (await clientFor(row).listEvents(calendar.source_calendar_id, window)).map((resource) => resource.data)
          const events = documents.flatMap((document) => mapCalendarDocument(document, timezone!))
          const result = commitCalendarEvents(sqlite, calendar.id, events, now().toISOString())
          changed = changed || result.changed
          options.status?.succeed(calendar.id)
        } catch (error) {
          // One unreachable calendar must not abandon the others, and the cache
          // it already holds stays exactly as it was.
          options.status?.fail(calendar.id)
          failure = error instanceof Error ? error : new Error('Calendar sync failed.')
        }
      }
    }

    const timestamp = now().toISOString()
    const safeError = failure === null ? null
      : failure instanceof CalDavError || failure instanceof DomainValidationError ? failure.message
      : failure.message.startsWith('Set the household timezone') ? failure.message
      : 'Calendar sync failed. Cached events are still available.'
    sqlite.prepare('UPDATE calendar_sources SET last_attempted_at = ?, last_succeeded_at = ?, last_error = ? WHERE id = ?')
      .run(timestamp, failure === null ? timestamp : row.last_succeeded_at, safeError, row.id)
    if (changed) options.onEventsChanged?.()
    return { changed }
  }

  async function syncAll(): Promise<{ changed: boolean }> {
    const sources = sqlite.prepare<[], { id: string }>('SELECT id FROM calendar_sources WHERE deleted_at IS NULL').all()
    let changed = false
    for (const source of sources) {
      try {
        const result = await syncSource(source.id)
        changed = changed || result.changed
      } catch (error) {
        // syncSource records its own failures, so reaching here means it threw
        // before it could. Record something rather than leaving the parent
        // looking at a source that silently never syncs.
        sqlite.prepare('UPDATE calendar_sources SET last_attempted_at = ?, last_error = ? WHERE id = ?')
          .run(now().toISOString(), error instanceof DomainValidationError ? error.message : 'Calendar sync failed.', source.id)
      }
    }
    return { changed }
  }

  return { list, connectCalDav, connectIcs, connectPhone, discoverCollections, setCalendarSelection, pushPhoneCalendars, remove, syncSource, syncAll }
}

export type CalendarSourceService = ReturnType<typeof createCalendarSourceService>
