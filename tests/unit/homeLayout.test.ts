import { describe, expect, it } from 'vitest'
import {
  canPlace,
  DEFAULT_HOME_LAYOUT,
  findFreeSpot,
  HOME_COLS,
  HOME_ROWS,
  inBounds,
  rectsOverlap,
  sanitizeLayout,
  TILE_SPECS
} from '../../src/shared/home'
import type { HomeTile } from '../../src/shared/types'

describe('rectsOverlap / inBounds', () => {
  it('edge-touching rects do not overlap', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 })).toBe(false)
    expect(rectsOverlap({ x: 0, y: 0, w: 2, h: 2 }, { x: 0, y: 2, w: 2, h: 2 })).toBe(false)
  })
  it('intersecting rects overlap', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 3, h: 3 }, { x: 2, y: 2, w: 2, h: 2 })).toBe(true)
  })
  it('bounds check', () => {
    expect(inBounds({ x: 0, y: 0, w: HOME_COLS, h: HOME_ROWS })).toBe(true)
    expect(inBounds({ x: 11, y: 0, w: 2, h: 1 })).toBe(false)
    expect(inBounds({ x: -1, y: 0, w: 2, h: 1 })).toBe(false)
    expect(inBounds({ x: 0, y: 0, w: 0, h: 1 })).toBe(false)
  })
})

describe('canPlace', () => {
  const layout: HomeTile[] = [{ id: 'a', type: 'clock', x: 0, y: 0, w: 2, h: 2 }]
  it('rejects collisions and accepts adjacency', () => {
    expect(canPlace(layout, { x: 1, y: 1, w: 2, h: 2 })).toBe(false)
    expect(canPlace(layout, { x: 2, y: 0, w: 2, h: 2 })).toBe(true)
  })
  it('excludeId lets a tile drop onto its own footprint', () => {
    expect(canPlace(layout, { x: 0, y: 0, w: 2, h: 2 }, 'a')).toBe(true)
  })
})

describe('findFreeSpot', () => {
  it('scans row-major', () => {
    const layout: HomeTile[] = [{ id: 'a', type: 'clock', x: 0, y: 0, w: 2, h: 2 }]
    expect(findFreeSpot(layout, 2, 2)).toEqual({ x: 2, y: 0 })
  })
  it('returns null on the full default layout', () => {
    expect(findFreeSpot(DEFAULT_HOME_LAYOUT, 2, 2)).toBeNull()
  })
  it('finds the hole left by a removed tile', () => {
    const layout = DEFAULT_HOME_LAYOUT.filter((t) => t.type !== 'meals')
    expect(findFreeSpot(layout, 2, 2)).toEqual({ x: 8, y: 3 })
  })
})

describe('sanitizeLayout', () => {
  it('falls back to the default layout for non-arrays', () => {
    expect(sanitizeLayout(null)).toBe(DEFAULT_HOME_LAYOUT)
    expect(sanitizeLayout('garbage')).toBe(DEFAULT_HOME_LAYOUT)
    expect(sanitizeLayout(undefined)).toBe(DEFAULT_HOME_LAYOUT)
  })
  it('passes a valid layout through unchanged', () => {
    const result = sanitizeLayout(DEFAULT_HOME_LAYOUT)
    expect(result).toEqual(DEFAULT_HOME_LAYOUT)
  })
  it('drops junk entries and unknown types', () => {
    const result = sanitizeLayout([{}, 42, 'x', { id: 'z', type: 'nonsense', x: 0, y: 0, w: 2, h: 2 }])
    expect(result).toEqual([])
  })
  it('drops a stale removed BirdNET tile without disturbing remaining tiles', () => {
    const result = sanitizeLayout([
      { id: 'removed-birds', type: 'birdnet', x: 0, y: 0, w: 4, h: 4, config: { birdnetUrl: 'http://birds.test' } },
      { id: 'clock', type: 'clock', x: 4, y: 0, w: 2, h: 2 }
    ])
    expect(result).toEqual([{ id: 'clock', type: 'clock', x: 4, y: 0, w: 2, h: 2 }])
  })
  it('clamps fractional and out-of-range coords', () => {
    const [tile] = sanitizeLayout([{ id: 'c', type: 'clock', x: 11.7, y: -3, w: 2.2, h: 99 }])
    expect(tile).toMatchObject({ x: 10, y: 0, w: 2, h: 6 })
    expect(inBounds(tile)).toBe(true)
  })
  it('enforces per-type minimum sizes', () => {
    const [tile] = sanitizeLayout([{ id: 'w', type: 'weekAgenda', x: 0, y: 0, w: 1, h: 1 }])
    expect(tile.w).toBeGreaterThanOrEqual(TILE_SPECS.weekAgenda.minW)
    expect(tile.h).toBeGreaterThanOrEqual(TILE_SPECS.weekAgenda.minH)
  })
  it('allows a one-row weather tile and preserves the family chore board size', () => {
    const result = sanitizeLayout([
      { id: 'weather', type: 'weather', x: 0, y: 0, w: 2, h: 1 },
      { id: 'family', type: 'familyChores', x: 2, y: 0, w: 1, h: 1 }
    ])
    expect(result[0]).toMatchObject({ type: 'weather', w: 2, h: 1 })
    expect(result[1].w).toBe(TILE_SPECS.familyChores.minW)
    expect(result[1].h).toBe(TILE_SPECS.familyChores.minH)
  })
  it('allows the compact stars tile and family rewards board', () => {
    const result = sanitizeLayout([
      { id: 'stars', type: 'starBalances', x: 0, y: 0, w: 1, h: 1 },
      { id: 'rewards', type: 'familyRewards', x: 2, y: 0, w: 1, h: 1 }
    ])
    expect(result[0]).toMatchObject({ type: 'starBalances', w: 1, h: 1 })
    expect(result[1]).toMatchObject({ type: 'familyRewards', w: 4, h: 3 })
  })
  it('relocates overlapping tiles deterministically', () => {
    const result = sanitizeLayout([
      { id: 'a', type: 'clock', x: 0, y: 0, w: 2, h: 2 },
      { id: 'b', type: 'weather', x: 0, y: 0, w: 2, h: 2 }
    ])
    expect(result).toHaveLength(2)
    expect(canPlace(result.slice(0, 1), result[1], result[1].id)).toBe(true)
    expect(result[1]).toMatchObject({ x: 2, y: 0 })
  })
  it('preserves tile config (listId and feedId) through sanitization', () => {
    const result = sanitizeLayout([
      { id: 'n', type: 'news', x: 0, y: 0, w: 4, h: 3, config: { feedId: 'npr' } },
      { id: 'l', type: 'list', x: 4, y: 0, w: 3, h: 4, config: { listId: 'abc', junk: 'dropped' } }
    ])
    expect(result[0].config).toEqual({ feedId: 'npr' })
    expect(result[1].config).toEqual({ listId: 'abc' })
  })

  it('strips config keys a tile type does not declare', () => {
    const result = sanitizeLayout([
      { id: 'c', type: 'clock', x: 0, y: 0, w: 2, h: 2, config: { listId: 'abc' } },
      { id: 'n', type: 'news', x: 2, y: 0, w: 4, h: 3, config: { feedId: 'npr', unrelated: 'smuggled' } }
    ])
    expect(result[0].config).toBeUndefined()
    expect(result[1].config).toEqual({ feedId: 'npr' })
  })

  it('drops stale camera tiles from saved layouts', () => {
    const result = sanitizeLayout([
      { id: 'camera', type: 'camera', x: 0, y: 0, w: 4, h: 3, config: { cameraId: 'old-device' } },
      { id: 'clock', type: 'clock', x: 4, y: 0, w: 2, h: 2 }
    ])
    expect(result).toEqual([{ id: 'clock', type: 'clock', x: 4, y: 0, w: 2, h: 2 }])
  })

  it('drops config values and ids the save schema would reject', () => {
    const result = sanitizeLayout([
      { id: 'a'.repeat(81), type: 'clock', x: 0, y: 0, w: 2, h: 2 }, // id too long → tile dropped
      { id: 'n', type: 'news', x: 0, y: 0, w: 4, h: 3, config: { feedId: '' } }, // empty value → key dropped
      { id: 'l', type: 'list', x: 4, y: 0, w: 3, h: 4, config: { listId: 'x'.repeat(201) } } // too long → key dropped
    ])
    expect(result).toHaveLength(2)
    expect(result[0].config).toBeUndefined()
    expect(result[1].config).toBeUndefined()
  })

  it('every config key declared in TILE_SPECS round-trips sanitization', () => {
    // guards the recurring "forgot to wire a new config key" bug class
    for (const [type, spec] of Object.entries(TILE_SPECS)) {
      for (const key of spec.configKeys) {
        const [tile] = sanitizeLayout([
          { id: 't', type, x: 0, y: 0, w: spec.minW, h: spec.minH, config: { [key]: 'value-123' } }
        ])
        expect(tile.config?.[key], `${type}.${key}`).toBe('value-123')
      }
    }
  })

  it('dedupes ids', () => {
    const result = sanitizeLayout([
      { id: 'a', type: 'clock', x: 0, y: 0, w: 2, h: 2 },
      { id: 'a', type: 'weather', x: 4, y: 0, w: 2, h: 2 }
    ])
    expect(result).toHaveLength(1)
  })
})

describe('DEFAULT_HOME_LAYOUT invariants', () => {
  it('has no overlaps, stays in bounds, and respects min sizes', () => {
    for (let i = 0; i < DEFAULT_HOME_LAYOUT.length; i++) {
      const tile = DEFAULT_HOME_LAYOUT[i]
      expect(inBounds(tile)).toBe(true)
      const spec = TILE_SPECS[tile.type]
      expect(tile.w).toBeGreaterThanOrEqual(spec.minW)
      expect(tile.h).toBeGreaterThanOrEqual(spec.minH)
      for (let j = i + 1; j < DEFAULT_HOME_LAYOUT.length; j++) {
        expect(rectsOverlap(tile, DEFAULT_HOME_LAYOUT[j])).toBe(false)
      }
    }
  })
  it('covers the grid completely (72 cells)', () => {
    const area = DEFAULT_HOME_LAYOUT.reduce((acc, t) => acc + t.w * t.h, 0)
    expect(area).toBe(HOME_COLS * HOME_ROWS)
  })
})
