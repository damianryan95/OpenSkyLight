import type { OccurrenceDto, PersonDto } from './types'

/** A kiosk is either showing the household or one deliberately selected person. */
export type ViewingContext = 'family' | `person:${string}`

export function personContext(personId: string): ViewingContext {
  return `person:${personId}`
}

export function selectedPersonId(context: ViewingContext): string | null {
  return context === 'family' ? null : context.slice('person:'.length)
}

export function inViewingContext(context: ViewingContext, personId: string): boolean {
  return selectedPersonId(context) === personId
}

/** Family is deliberately an all-events feed; an empty audience is Family-only. */
export function occurrenceIsVisible(context: ViewingContext, occurrence: OccurrenceDto): boolean {
  const personId = selectedPersonId(context)
  return personId === null || occurrence.personIds.includes(personId)
}

export function peopleInViewingContext(context: ViewingContext, people: PersonDto[]): PersonDto[] {
  const personId = selectedPersonId(context)
  return personId === null ? people : people.filter((person) => person.id === personId)
}
