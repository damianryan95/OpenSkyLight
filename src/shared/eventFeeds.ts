/** A read-only cached calendar occurrence returned by Family and personal feeds. */
export interface EventFeedOccurrence {
  /** Stable recurrence key: `${eventId}|${occurrenceStart}`. */
  key: string
  eventId: string
  masterId: string
  calendarId: string
  title: string
  description: string | null
  location: string | null
  start: string
  end: string
  timezone: string
  allDay: boolean
  isRecurring: boolean
  occurrenceStart: string
  /** Calculated from current people, calendar mapping, and event text. */
  personIds: string[]
}

/**
 * The identity of one cached event within its calendar: the pair the store is
 * unique on, flattened into a single string.
 *
 * Centralised because three separate places now compare these keys — exception
 * resolution, mirror suppression, and the phone write-back ack — and a separator
 * written slightly differently in any one of them fails silently by simply never
 * matching. The separator cannot occur in either half.
 */
export function eventSourceKey(calendarId: string, sourceEventId: string): string {
  return `${calendarId}${String.fromCharCode(0)}${sourceEventId}`
}

/** Splits a key back into its halves, or null if it is not one. */
export function parseEventSourceKey(key: string): { calendarId: string; sourceEventId: string } | null {
  const separator = key.indexOf(String.fromCharCode(0))
  if (separator < 0) return null
  return { calendarId: key.slice(0, separator), sourceEventId: key.slice(separator + 1) }
}

export interface EventFeedWindow {
  /** Inclusive UTC ISO start of the requested interval. */
  start: string
  /** Exclusive UTC ISO end of the requested interval. */
  end: string
}
