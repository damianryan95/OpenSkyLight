import { describe, expect, it } from 'vitest'
import { choreIconSymbol, suggestChoreIcon } from '../../src/shared/choreIcons'

describe('chore icon suggestions', () => {
  it('prefers a specific phrase over a broad word', () => {
    expect(suggestChoreIcon('Feed the dog')).toBe('paw')
    expect(suggestChoreIcon('Wash the dishes')).toBe('dishes')
    expect(suggestChoreIcon('Make your bed')).toBe('bed')
  })

  it('leaves unfamiliar chores unassigned and gives legacy chores a friendly fallback', () => {
    expect(suggestChoreIcon('Practise piano')).toBeNull()
    expect(choreIconSymbol(null)).toBe('✨')
  })
})
