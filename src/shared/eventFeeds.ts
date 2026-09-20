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

export interface EventFeedWindow {
  /** Inclusive UTC ISO start of the requested interval. */
  start: string
  /** Exclusive UTC ISO end of the requested interval. */
  end: string
}
