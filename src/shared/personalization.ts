/** Built-in person themes are an allow-list, never arbitrary class names. */
export const BUILT_IN_PERSON_THEME_IDS = ['minecraft', 'frozen', 'kpop-demon-hunters'] as const

export type BuiltInPersonThemeId = typeof BUILT_IN_PERSON_THEME_IDS[number]

export interface PersonThemePack {
  id: BuiltInPersonThemeId
  version: 1
  name: string
  description: string
  /** CSS only receives this allow-listed ID; token values remain bundled. */
  light: { paper: string, card: string, ink: string, accent: string }
  dark: { paper: string, card: string, ink: string, accent: string }
}

/**
 * The kiosk never receives parent-authored CSS. This small registry is the
 * shared source for validation, future parent previews, and bundled tokens.
 */
export const PERSON_THEME_PACKS: readonly PersonThemePack[] = [
  {
    id: 'minecraft', version: 1, name: 'Minecraft', description: 'Blocks, grass, and bright adventure.',
    light: { paper: '#e5f1c8', card: '#fffef4', ink: '#203718', accent: '#4f7a28' },
    dark: { paper: '#172313', card: '#203018', ink: '#edf7dc', accent: '#91c957' }
  },
  {
    id: 'frozen', version: 1, name: 'Frozen', description: 'Snow crystals and icy blue light.',
    light: { paper: '#e6f5fc', card: '#fcfeff', ink: '#183d5b', accent: '#1a78ab' },
    dark: { paper: '#102635', card: '#173849', ink: '#e8f8ff', accent: '#6dc9f5' }
  },
  {
    id: 'kpop-demon-hunters', version: 1, name: 'KPop Demon Hunters', description: 'Neon stage energy and celestial colour.',
    light: { paper: '#f9e8f8', card: '#fffaff', ink: '#351a4b', accent: '#bd298d' },
    dark: { paper: '#1b1230', card: '#2a1945', ink: '#fff5ff', accent: '#ff5ec9' }
  }
]

export interface PersonPersonalization {
  /** null preserves the neutral OpenSkyLight Family/default presentation. */
  themeId: BuiltInPersonThemeId | null
  /** Managed-media identifier; the asset service is introduced in PE05. */
  celebrationAssetId: string | null
  /** A child may have several approved celebrations; the kiosk picks one per completion. */
  celebrationAssetIds: string[]
  celebrationEnabled: boolean
  /** The renderer owns timing even when an uploaded animation loops. */
  celebrationDurationMs: number
}

export const DEFAULT_PERSON_PERSONALIZATION: PersonPersonalization = {
  themeId: null,
  celebrationAssetId: null,
  celebrationAssetIds: [],
  celebrationEnabled: true,
  celebrationDurationMs: 3_000
}

export function isBuiltInPersonThemeId(value: unknown): value is BuiltInPersonThemeId {
  return typeof value === 'string' && (BUILT_IN_PERSON_THEME_IDS as readonly string[]).includes(value)
}

export function personThemePack(id: BuiltInPersonThemeId | null): PersonThemePack | null {
  return id === null ? null : PERSON_THEME_PACKS.find((pack) => pack.id === id) ?? null
}
