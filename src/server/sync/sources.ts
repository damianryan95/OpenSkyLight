import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { CalendarSourceDto } from '../../shared/api/contract'
import { DomainValidationError } from '../domain/errors'
import { createCalDavClient, fetchIcsFeed, CalDavError, type CalDavCollection, type Fetcher } from './caldav'
import { mapCalendarDocument } from './ical'
import { commitCalendarEvents, syncWindow } from './pull'
import { applicationKey, decryptSecret, encryptSecret } from './secrets'
import type { CalendarSyncStatusService } from './status'

interface SourceRow {
  id: string
  kind: 'caldav' | 'ics'
  name: string
  connected_at: string
  last_succeeded_at: string | null
  last_error: string | null
  base_url: string | null
  username: string | null
  password_enc: Buffer | null
}

export interface CalendarSourceServiceOptions {
  now?: () => Date
  fetcher?: Fetcher
  status?: CalendarSyncStatusService
  onEventsChanged?: () => void
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

  function list(): CalendarSourceDto[] {
    return sqlite.prepare<[], SourceRow>(`SELECT id, kind, name, connected_at, last_succeeded_at, last_error, base_url, username, password_enc
      FROM calendar_sources WHERE deleted_at IS NULL ORDER BY connected_at`).all().map(toDto)
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
      sqlite.prepare('INSERT INTO calendars (id, source_id, source_calendar_id, name, selected) VALUES (?, ?, ?, ?, 1)')
        .run(randomUUID(), id, input.url, name)
    })()
    return toDto(requireSource(id))
  }

  /** Remote collections, annotated with the household's current selection. */
  async function discoverCollections(sourceId: string): Promise<(CalDavCollection & { selected: boolean; audiencePersonId: string | null })[]> {
    const row = requireSource(sourceId)
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

  function setCalendarSelection(input: { sourceId: string; url: string; name: string; color: string; selected: boolean; audiencePersonId: string | null }): void {
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
    if (existing === undefined) {
      sqlite.prepare('INSERT INTO calendars (id, source_id, source_calendar_id, audience_person_id, name, color, selected) VALUES (?, ?, ?, ?, ?, ?, 1)')
        .run(randomUUID(), row.id, input.url, input.audiencePersonId, input.name, input.color)
    } else {
      sqlite.prepare('UPDATE calendars SET audience_person_id = ?, name = ?, color = ?, selected = 1, deleted_at = NULL WHERE id = ?')
        .run(input.audiencePersonId, input.name, input.color, existing.id)
    }
  }

  function remove(sourceId: string): void {
    const row = requireSource(sourceId)
    // Calendars and their events cascade from the source row.
    sqlite.prepare('DELETE FROM calendar_sources WHERE id = ?').run(row.id)
  }

  async function syncSource(sourceId: string): Promise<{ changed: boolean }> {
    const row = requireSource(sourceId)
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

  return { list, connectCalDav, connectIcs, discoverCollections, setCalendarSelection, remove, syncSource, syncAll }
}

export type CalendarSourceService = ReturnType<typeof createCalendarSourceService>
