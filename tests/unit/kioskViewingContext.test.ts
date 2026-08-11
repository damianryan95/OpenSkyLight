import { describe, expect, it } from 'vitest'
import type { OccurrenceDto, PersonDto } from '../../src/shared/types'
import { occurrenceIsVisible, peopleInViewingContext, personContext, personThemeInViewingContext, selectedPersonId } from '../../src/shared/viewingContext'

const people = [{ id: 'ava' }, { id: 'leo' }] as PersonDto[]
const familyOnly = { personIds: [] } as unknown as OccurrenceDto
const avaEvent = { personIds: ['ava'] } as unknown as OccurrenceDto
const sharedEvent = { personIds: ['ava', 'leo'] } as unknown as OccurrenceDto

describe('kiosk viewing context', () => {
  it('shows every event in Family and only derived events for a person', () => {
    expect([familyOnly, avaEvent, sharedEvent].filter((event) => occurrenceIsVisible('family', event))).toHaveLength(3)
    expect([familyOnly, avaEvent, sharedEvent].filter((event) => occurrenceIsVisible(personContext('ava'), event))).toEqual([avaEvent, sharedEvent])
    expect(peopleInViewingContext(personContext('leo'), people).map((person) => person.id)).toEqual(['leo'])
  })

  it('models one explicit selection rather than hidden-person combinations', () => {
    expect(selectedPersonId('family')).toBeNull()
    expect(selectedPersonId(personContext('ava'))).toBe('ava')
  })

  it('resolves a bundled theme only for the selected person and never for Family', () => {
    const themed = [{ id: 'ava', themeId: 'minecraft' }, { id: 'leo', themeId: null }] as PersonDto[]
    expect(personThemeInViewingContext('family', themed)).toBeNull()
    expect(personThemeInViewingContext(personContext('ava'), themed)).toBe('minecraft')
    expect(personThemeInViewingContext(personContext('leo'), themed)).toBeNull()
    expect(personThemeInViewingContext(personContext('missing'), themed)).toBeNull()
  })
})
