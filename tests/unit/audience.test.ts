import { describe, expect, it } from 'vitest'
import {
  AmbiguousChildNameError,
  deriveEffectivePersonIds,
  findAmbiguousChildNames
} from '../../src/shared/audience'

const people = [
  { id: 'parent', name: 'Alice Parent', role: 'parent' as const },
  { id: 'ava', name: 'Ava', role: 'child' as const },
  { id: 'leo', name: 'L\u00e9o Smith', role: 'child' as const },
  { id: 'inactive', name: 'Mia', role: 'child' as const, active: false }
]

describe('deriveEffectivePersonIds', () => {
  it('includes a mapped adult or child and deduplicates inferred child IDs', () => {
    expect(deriveEffectivePersonIds({ mappedPersonId: 'parent', title: 'Ava recital', description: null, people })).toEqual(['parent', 'ava'])
    expect(deriveEffectivePersonIds({ mappedPersonId: 'ava', title: 'AVA recital', description: null, people })).toEqual(['ava'])
  })

  it('infers only active children, including multiple multi-word names', () => {
    expect(deriveEffectivePersonIds({
      mappedPersonId: null,
      title: 'ava & le\u0301o smith playdate',
      description: 'Mia is unavailable',
      people
    })).toEqual(['ava', 'leo'])
  })

  it('requires complete names at punctuation or text boundaries', () => {
    expect(deriveEffectivePersonIds({ mappedPersonId: null, title: 'Ava, please attend!', description: null, people })).toEqual(['ava'])
    expect(deriveEffectivePersonIds({ mappedPersonId: null, title: 'AvaLanche and L\u00e9o Smithe', description: null, people })).toEqual([])
  })

  it('does not infer adults from text and leaves unmatched events Family-only', () => {
    expect(deriveEffectivePersonIds({ mappedPersonId: null, title: 'Alice Parent meeting', description: null, people })).toEqual([])
    expect(deriveEffectivePersonIds({ mappedPersonId: null, title: 'Family dinner', description: null, people })).toEqual([])
  })

  it('strips markup and decodes entities before matching descriptions', () => {
    expect(deriveEffectivePersonIds({
      mappedPersonId: null,
      title: 'School',
      description: '<p>Ava<br>and&nbsp;<strong>L\u00e9o Smith</strong></p><script>Mia</script>',
      people
    })).toEqual(['ava', 'leo'])
  })

  it('rejects ambiguous normalized active child names', () => {
    const duplicatePeople = [...people, { id: 'ava-2', name: '  \uff21\uff36\uff41 ', role: 'child' as const }]
    expect(findAmbiguousChildNames(duplicatePeople)).toEqual(['ava'])
    expect(() => deriveEffectivePersonIds({ mappedPersonId: null, title: 'Ava recital', description: null, people: duplicatePeople }))
      .toThrow(AmbiguousChildNameError)
  })
})
