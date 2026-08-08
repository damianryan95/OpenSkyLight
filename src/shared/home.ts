import type { HomeTile, HomeTileConfig, HomeTileType } from './types'

/**
 * Pure grid math for the customizable home screen. Shared by the renderer
 * (drag/resize validation) and the tests; no DOM, no Electron.
 */

export const HOME_COLS = 12
export const HOME_ROWS = 6

export interface TileSpec {
  minW: number
  minH: number
  defaultW: number
  defaultH: number
  allowMultiple: boolean
  /** The only config keys this tile type may carry — the single source of
   * truth that sanitizeLayout enforces (per-type, so a list tile can never
   * carry unrelated configuration, and forgetting a key here fails visibly in tests). */
  configKeys: (keyof HomeTileConfig)[]
}

export const TILE_SPECS: Record<HomeTileType, TileSpec> = {
  todayEvents: { minW: 3, minH: 3, defaultW: 4, defaultH: 6, allowMultiple: false, configKeys: [] },
  weekAgenda: { minW: 3, minH: 2, defaultW: 3, defaultH: 3, allowMultiple: false, configKeys: [] },
  weather: { minW: 2, minH: 1, defaultW: 3, defaultH: 2, allowMultiple: false, configKeys: [] },
  choresProgress: { minW: 3, minH: 3, defaultW: 5, defaultH: 6, allowMultiple: false, configKeys: [] },
  familyChores: { minW: 4, minH: 3, defaultW: 6, defaultH: 6, allowMultiple: false, configKeys: [] },
  starBalances: { minW: 1, minH: 1, defaultW: 2, defaultH: 2, allowMultiple: false, configKeys: [] },
  familyRewards: { minW: 4, minH: 3, defaultW: 6, defaultH: 6, allowMultiple: false, configKeys: [] },
  list: { minW: 2, minH: 3, defaultW: 3, defaultH: 4, allowMultiple: true, configKeys: ['listId'] },
  meals: { minW: 2, minH: 2, defaultW: 3, defaultH: 2, allowMultiple: false, configKeys: [] },
  clock: { minW: 2, minH: 2, defaultW: 2, defaultH: 2, allowMultiple: false, configKeys: [] },
  photo: { minW: 2, minH: 2, defaultW: 3, defaultH: 4, allowMultiple: true, configKeys: [] },
  news: { minW: 3, minH: 2, defaultW: 4, defaultH: 3, allowMultiple: true, configKeys: ['feedId'] },
  timer: { minW: 3, minH: 2, defaultW: 4, defaultH: 3, allowMultiple: false, configKeys: [] }
}

/** Tiles the full 12x6 grid with no gaps. Clock/weather tiles are NOT placed by
 * default — the header already shows both — but stay in the Add Tile sheet. */
export const DEFAULT_HOME_LAYOUT: HomeTile[] = [
  { id: 'default-todayEvents', type: 'todayEvents', x: 0, y: 0, w: 3, h: 6 },
  { id: 'default-choresProgress', type: 'choresProgress', x: 3, y: 0, w: 5, h: 6 },
  { id: 'default-weekAgenda', type: 'weekAgenda', x: 8, y: 0, w: 4, h: 3 },
  { id: 'default-meals', type: 'meals', x: 8, y: 3, w: 2, h: 3 },
  { id: 'default-starBalances', type: 'starBalances', x: 10, y: 3, w: 2, h: 3 }
]

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function inBounds(r: Rect): boolean {
  return r.x >= 0 && r.y >= 0 && r.w >= 1 && r.h >= 1 && r.x + r.w <= HOME_COLS && r.y + r.h <= HOME_ROWS
}

/** Can `rect` be placed without leaving the grid or hitting another tile? */
export function canPlace(layout: HomeTile[], rect: Rect, excludeId?: string): boolean {
  if (!inBounds(rect)) return false
  return layout.every((t) => t.id === excludeId || !rectsOverlap(t, rect))
}

/** First free w×h spot scanning row-major, or null when the grid is full. */
export function findFreeSpot(layout: HomeTile[], w: number, h: number): { x: number; y: number } | null {
  for (let y = 0; y + h <= HOME_ROWS; y++) {
    for (let x = 0; x + w <= HOME_COLS; x++) {
      if (canPlace(layout, { x, y, w, h })) return { x, y }
    }
  }
  return null
}

const TILE_TYPES = new Set<string>(Object.keys(TILE_SPECS))

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * Make any stored value safe to render: drop garbage, clamp coords, enforce
 * per-type minimum sizes, dedupe ids, and resolve overlaps deterministically.
 * Returns DEFAULT_HOME_LAYOUT when the value isn't an array at all.
 */
export function sanitizeLayout(raw: unknown): HomeTile[] {
  if (!Array.isArray(raw)) return DEFAULT_HOME_LAYOUT
  const out: HomeTile[] = []
  const seenIds = new Set<string>()

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const t = entry as Partial<HomeTile>
    if (typeof t.type !== 'string' || !TILE_TYPES.has(t.type)) continue
    // id constraints mirror homeTileSchema — anything sanitize keeps must
    // also be SAVEABLE, or the user gets stuck unable to persist any edit
    if (typeof t.id !== 'string' || t.id.length === 0 || t.id.length > 80 || seenIds.has(t.id)) continue
    const spec = TILE_SPECS[t.type as HomeTileType]

    let w = clamp(Math.round(Number(t.w) || spec.defaultW), spec.minW, HOME_COLS)
    let h = clamp(Math.round(Number(t.h) || spec.defaultH), spec.minH, HOME_ROWS)
    let x = clamp(Math.round(Number(t.x) || 0), 0, HOME_COLS - 1)
    let y = clamp(Math.round(Number(t.y) || 0), 0, HOME_ROWS - 1)
    // shift left/up before shrinking
    x = Math.min(x, HOME_COLS - w)
    y = Math.min(y, HOME_ROWS - h)

    let rect: Rect = { x, y, w, h }
    if (!canPlace(out, rect)) {
      const spot = findFreeSpot(out, w, h) ?? findFreeSpot(out, spec.minW, spec.minH)
      if (!spot) continue // grid full — drop the tile
      const fitsDefault = canPlace(out, { ...spot, w, h })
      rect = fitsDefault ? { ...spot, w, h } : { ...spot, w: spec.minW, h: spec.minH }
    }

    seenIds.add(t.id)
    // copy only this type's declared config keys, with schema-compatible values
    let config: HomeTileConfig | undefined
    if (spec.configKeys.length > 0 && t.config && typeof t.config === 'object') {
      const rawConfig = t.config as Record<string, unknown>
      for (const key of spec.configKeys) {
        const value = rawConfig[key]
        if (typeof value === 'string' && value.length >= 1 && value.length <= 200) {
          config = { ...config, [key]: value }
        }
      }
    }
    out.push({
      id: t.id,
      type: t.type as HomeTileType,
      ...rect,
      ...(config ? { config } : {})
    })
  }
  return out
}
