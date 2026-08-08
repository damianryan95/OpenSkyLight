import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { calendar as createCalendarClient } from '@googleapis/calendar'
import { OAuth2Client } from 'google-auth-library'
import { mapGoogleEvent, type GoogleEventResource } from './eventMap'
import { decryptRefreshToken } from './secrets'
import type { GoogleSyncStatusService } from './status'

export interface GoogleEventsRemote {
  listEvents(input: {
    accountId: string
    googleCalendarId: string
    pageToken?: string
    syncToken?: string
    showDeleted: true
    singleEvents: false
  }): Promise<{ items: readonly GoogleEventResource[]; nextPageToken?: string; nextSyncToken?: string }>
}

/** Secure concrete adapter for the pull service; tokens remain encrypted at rest. */
export function createGoogleEventsRemote(input: {
  sqlite: Database.Database
  householdId: string
  tokenEncryptionKey: Buffer
  clientId: string
  clientSecret: string
}): GoogleEventsRemote {
  if (input.tokenEncryptionKey.length !== 32) throw new GooglePullError('Google token encryption key must be 32 bytes.')
  return {
    async listEvents(request) {
      const account = input.sqlite.prepare<[string], { refresh_token_enc: Buffer; auth_state: string }>(
        'SELECT refresh_token_enc, auth_state FROM google_accounts WHERE id = ?'
      ).get(request.accountId)
      if (!account || account.auth_state !== 'connected') throw new GooglePullError('Google account is unavailable or requires reauthorization.')
      const client = new OAuth2Client({ clientId: input.clientId, clientSecret: input.clientSecret })
      client.setCredentials({ refresh_token: decryptRefreshToken(input.tokenEncryptionKey, input.householdId, request.accountId, account.refresh_token_enc) })
      const response = await createCalendarClient({ version: 'v3', auth: client as unknown as Parameters<typeof createCalendarClient>[0]['auth'] }).events.list({
        calendarId: request.googleCalendarId,
        maxResults: 250,
        pageToken: request.pageToken,
        syncToken: request.syncToken,
        showDeleted: true,
        singleEvents: false
      })
      return {
        items: (response.data.items ?? []) as GoogleEventResource[],
        nextPageToken: response.data.nextPageToken ?? undefined,
        nextSyncToken: response.data.nextSyncToken ?? undefined
      }
    }
  }
}

export class GooglePullError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GooglePullError'
  }
}

type CalendarBinding = { id: string; google_account_id: string; google_calendar_id: string; sync_token: string | null }

/**
 * Pull-only Google cache synchronizer. A complete response sequence is staged
 * in memory then committed in one SQLite transaction, so failed pulls never
 * mutate a usable cache or advance its sync token.
 */
export function createGooglePullSynchronizer(sqlite: Database.Database, remote: GoogleEventsRemote, householdTimezone: () => string, status?: GoogleSyncStatusService) {
  async function pullCalendar(calendarId: string, forceFull = false): Promise<{ changed: boolean; full: boolean }> {
    const calendar = sqlite.prepare<[string], CalendarBinding>(`
      SELECT id, google_account_id, google_calendar_id, sync_token FROM calendars
      WHERE id = ? AND selected = 1 AND deleted_at IS NULL
    `).get(calendarId)
    if (!calendar) throw new GooglePullError('Selected Google calendar was not found.')
    status?.start(calendar.id)
    const full = forceFull || calendar.sync_token === null
    const resources: GoogleEventResource[] = []
    let pageToken: string | undefined
    let nextSyncToken: string | undefined
    try {
      do {
        const page = await remote.listEvents({
          accountId: calendar.google_account_id,
          googleCalendarId: calendar.google_calendar_id,
          pageToken,
          ...(!forceFull && calendar.sync_token ? { syncToken: calendar.sync_token } : {}),
          showDeleted: true,
          singleEvents: false
        })
        resources.push(...page.items)
        pageToken = page.nextPageToken
        if (page.nextSyncToken) nextSyncToken = page.nextSyncToken
      } while (pageToken)
    } catch (error) {
      const remoteStatus = (error as { status?: number; code?: number }).status ?? (error as { code?: number }).code
      if (calendar.sync_token && remoteStatus === 410) {
        // Google has invalidated the incremental token. Keep the old cache
        // intact until a replacement full snapshot successfully completes.
        return pullCalendar(calendar.id, true)
      }
      status?.fail(calendar.id)
      throw error
    }
    if (!nextSyncToken) {
      status?.fail(calendar.id)
      throw new GooglePullError('Google pull completed without a sync token; cache was left unchanged.')
    }

    const mapped = resources.map((resource) => mapGoogleEvent(resource, householdTimezone())).filter((event): event is NonNullable<typeof event> => event !== null)
    const timestamp = new Date().toISOString()
    let changed = false
    sqlite.transaction(() => {
      const seen = new Set<string>()
      const persist = (event: NonNullable<typeof mapped[number]>): void => {
        seen.add(event.googleEventId)
        const existing = sqlite.prepare<[string, string], { id: string; etag: string | null; status: string }>(
          'SELECT id, etag, status FROM events WHERE calendar_id = ? AND google_event_id = ?'
        ).get(calendar.id, event.googleEventId)
        if (existing && existing.etag === event.etag && existing.status === event.status) return
        if (existing && !event.hasTiming) {
          sqlite.prepare('UPDATE events SET etag = ?, status = ?, remote_updated_at = ?, updated_at = ? WHERE id = ?')
            .run(event.etag, event.status, event.remoteUpdatedAt, timestamp, existing.id)
          changed = true
          return
        }
        const values = [event.etag, event.icalUid, event.title, event.description, event.location, event.startAt, event.endAt, event.timezone,
          event.allDay ? 1 : 0, event.recurrence, event.recurrenceExdates, event.recurrenceRdates, event.recurringGoogleEventId,
          event.originalStartAt, event.status, event.remoteUpdatedAt, timestamp]
        if (existing) {
          sqlite.prepare(`UPDATE events SET etag=?, ical_uid=?, title=?, description=?, location=?, start_at=?, end_at=?, timezone=?, all_day=?,
            recurrence=?, recurrence_exdates=?, recurrence_rdates=?, recurring_event_id=?, original_start_at=?, status=?, remote_updated_at=?, updated_at=? WHERE id=?`)
            .run(...values, existing.id)
        } else {
          sqlite.prepare(`INSERT INTO events (id, calendar_id, google_event_id, etag, ical_uid, title, description, location, start_at, end_at, timezone,
            all_day, recurrence, recurrence_exdates, recurrence_rdates, recurring_event_id, original_start_at, status, remote_updated_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`) 
            .run(randomUUID(), calendar.id, event.googleEventId, ...values, timestamp)
        }
        changed = true
      }
      // A recurring master always exists before its exception rows.
      for (const event of mapped.filter((event) => event.recurringGoogleEventId === null)) persist(event)
      for (const event of mapped.filter((event) => event.recurringGoogleEventId !== null)) persist(event)
      if (full) {
        const absent = sqlite.prepare<[string], { id: string; google_event_id: string }>("SELECT id, google_event_id FROM events WHERE calendar_id = ? AND status != 'cancelled'").all(calendar.id)
          .filter((event) => !seen.has(event.google_event_id))
        for (const event of absent) {
          sqlite.prepare("UPDATE events SET status = 'cancelled', updated_at = ? WHERE id = ?").run(timestamp, event.id)
          changed = true
        }
      }
      sqlite.prepare('UPDATE calendars SET sync_token = ?, last_synced_at = ?, sync_error = NULL WHERE id = ?').run(nextSyncToken, timestamp, calendar.id)
    })()
    status?.succeed(calendar.id)
    return { changed, full }
  }

  return { pullCalendar }
}

export type GooglePullSynchronizer = ReturnType<typeof createGooglePullSynchronizer>
