import { describe, expect, it } from 'vitest'
import { BUILT_IN_PERSON_THEME_IDS, DEFAULT_PERSON_PERSONALIZATION, isBuiltInPersonThemeId, personThemePack } from '../../src/shared/personalization'

describe('person personalization registry', () => {
  it('contains the bounded bundled theme IDs and a neutral default', () => {
    expect(BUILT_IN_PERSON_THEME_IDS).toEqual(['minecraft', 'frozen', 'kpop-demon-hunters'])
    expect(DEFAULT_PERSON_PERSONALIZATION).toEqual({ themeId: null, celebrationAssetId: null, celebrationAssetIds: [], celebrationEnabled: true, celebrationDurationMs: 3000 })
  })

  it('never resolves arbitrary strings to a CSS-applicable theme pack', () => {
    expect(isBuiltInPersonThemeId('minecraft')).toBe(true)
    expect(isBuiltInPersonThemeId('not-a-theme')).toBe(false)
    expect(personThemePack('frozen')?.name).toBe('Frozen')
    expect(personThemePack(null)).toBeNull()
  })
})
