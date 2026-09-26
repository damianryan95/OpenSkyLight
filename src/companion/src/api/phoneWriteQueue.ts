import type { AckEventWritesRequest, PendingEventWriteDto, PendingEventWritesResponse } from '@shared/api/contract'
import { parseRRuleString } from '@shared/recurrence/build'
import { DateTime } from 'luxon'
import { parentRequest } from './client'
import {
  devicePhoneCalendarWriter,
  type DeviceEventDraft,
  type DeviceRecurrence,
  type PhoneCalendarWriter
} from './phoneCalendars'

/**
 * Applying the board's outward writes to this phone's own calendar (`N06`,
 * ADR 0007).
 *
 * This is the half of write-back the server cannot do. It has no address for a
 * phone, so it queues the change and this drains the queue: fetch what is
 * outstanding, apply each one through the OS calendar API, and report back what
 * happened. The report is not optional — the id this phone assigns is what stops
 * the board showing the event twice once it is pushed back.
 */

export interface DrainResult {
  applied: number
  failed: number
}

/**
 * Translates the board's RRULE into the structured rule the plugin takes.
 *
 * Returns null when the rule uses something the plugin cannot express, and the
 * caller then writes the event as a single occurrence rather than refusing it.
 * A one-off copy of a repeating event is wrong in a visible, correctable way; a
 * write that silently never happens is wrong in an invisible one.
 */
export function toDeviceRecurrence(rrule: string | null, timezone: string): DeviceRecurrence | null {
  if (rrule === null || rrule === '') return null
  const parsed = parseRRuleString(rrule, timezone)
  if (parsed === null) return null
  const rule: DeviceRecurrence = { frequency: parsed.freq }
  if (parsed.interval !== undefined && parsed.interval > 1) rule.interval = parsed.interval
  // The board numbers weekdays from 0 = Monday; the plugin from 1 = Monday.
  if (parsed.byWeekdays !== undefined && parsed.byWeekdays.length > 0) {
    rule.byWeekDay = parsed.byWeekdays.map((day) => day + 1)
  }
  if (parsed.untilDate !== undefined) {
    const end = Date.parse(`${parsed.untilDate}T23:59:59Z`)
    if (Number.isFinite(end)) rule.end = end
  } else if (parsed.count !== undefined && parsed.count > 0) {
    rule.count = parsed.count
  }
  return rule
}

/**
 * The reverse of the push mapping's all-day rule: the board holds an all-day
 * event as local midnight in its zone, Android wants midnight UTC on the same
 * calendar date. Handing Android the board's instant would file a London event
 * under the day before.
 */
export function allDayMillisForDevice(iso: string, zone: string): number {
  const local = DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone)
  return Date.UTC(local.year, local.month - 1, local.day)
}

export function toDraft(write: PendingEventWriteDto): DeviceEventDraft | null {
  let startAt = Date.parse(write.event.startAt)
  let endAt = Date.parse(write.event.endAt)
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return null
  if (write.event.allDay) {
    startAt = allDayMillisForDevice(write.event.startAt, write.event.timezone)
    endAt = Math.max(allDayMillisForDevice(write.event.endAt, write.event.timezone), startAt + 86_400_000)
  }
  return {
    calendarId: write.sourceCalendarId,
    title: write.event.title,
    description: write.event.description,
    location: write.event.location,
    startAt,
    endAt,
    allDay: write.event.allDay,
    // An override of a single occurrence is not itself a series.
    recurrence: write.event.originalStartAt === null ? toDeviceRecurrence(write.event.recurrence, write.event.timezone) : null
  }
}

async function fetchPending(sourceId: string, signal: AbortSignal): Promise<PendingEventWriteDto[]> {
  const { writes } = await parentRequest<PendingEventWritesResponse>(
    `/api/v1/calendar-sources/${encodeURIComponent(sourceId)}/pending-writes`,
    { signal }
  )
  return writes
}

async function postAck(sourceId: string, body: AckEventWritesRequest, signal: AbortSignal): Promise<void> {
  await parentRequest(`/api/v1/calendar-sources/${encodeURIComponent(sourceId)}/pending-writes/ack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  }, true)
}

/** A message a parent can act on, and never the raw platform error. */
function explainWriteFailure(reason: unknown): string {
  if (reason instanceof Error && /permission|denied/i.test(reason.message)) {
    return 'This phone would not let OpenSkyLight change its calendar. Check calendar permission in your phone’s settings.'
  }
  return 'This phone could not save the change to its calendar.'
}

/**
 * Applies everything outstanding for this phone, then reports the lot in one
 * request.
 *
 * A single acknowledgement rather than one per write is deliberate: a phone that
 * loses the network halfway through leaves every write it has not reported still
 * queued, and a queued write is retried, whereas a write reported applied is
 * never sent again. Erring towards "not yet reported" is what keeps the guarantee
 * exactly-once rather than at-most-once.
 */
export async function drainPhoneWriteQueue(
  sourceId: string,
  signal: AbortSignal,
  writer: PhoneCalendarWriter = devicePhoneCalendarWriter
): Promise<DrainResult> {
  const pending = await fetchPending(sourceId, signal)
  if (pending.length === 0) return { applied: 0, failed: 0 }

  // Asked once for the whole batch: a revoked write permission fails every write
  // in the same way, and there is no point discovering that one event at a time.
  const permission = await writer.checkPermission()
  if (permission !== 'granted') {
    await postAck(sourceId, {
      results: pending.map((write) => ({
        id: write.id,
        status: 'failed' as const,
        message: 'This phone has not given OpenSkyLight permission to change its calendars.'
      }))
    }, signal)
    return { applied: 0, failed: pending.length }
  }

  const results: AckEventWritesRequest['results'] = []
  for (const write of pending) {
    if (signal.aborted) break
    try {
      if (write.operation === 'delete') {
        // Nothing to delete means the outcome the board asked for already holds.
        if (write.sourceEventId !== null) await writer.remove(write.sourceEventId)
        results.push({ id: write.id, status: 'applied' })
        continue
      }

      const draft = toDraft(write)
      if (draft === null) {
        results.push({ id: write.id, status: 'failed', message: 'That event could not be read by this phone.' })
        continue
      }

      if (write.operation === 'update' && write.sourceEventId !== null) {
        await writer.modify(write.sourceEventId, draft)
        results.push({ id: write.id, status: 'applied', sourceEventId: write.sourceEventId })
        continue
      }

      const assignedId = await writer.create(draft)
      results.push({ id: write.id, status: 'applied', sourceEventId: assignedId })
    } catch (reason) {
      results.push({ id: write.id, status: 'failed', message: explainWriteFailure(reason) })
    }
  }

  if (results.length === 0) return { applied: 0, failed: 0 }
  await postAck(sourceId, { results }, signal)
  return {
    applied: results.filter((result) => result.status === 'applied').length,
    failed: results.filter((result) => result.status === 'failed').length
  }
}
