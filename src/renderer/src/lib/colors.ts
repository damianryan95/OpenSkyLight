import type { CalendarDto, OccurrenceDto, PersonDto } from '@shared/types'

/** Primary display color for an occurrence: first assigned person's color, else its calendar's. */
export function occurrenceColor(
  occ: OccurrenceDto,
  peopleById: Map<string, PersonDto>,
  calendarsById: Map<string, CalendarDto>
): string {
  for (const pid of occ.personIds) {
    const person = peopleById.get(pid)
    if (person) return person.color
  }
  return calendarsById.get(occ.calendarId)?.color ?? '#8a8378'
}
