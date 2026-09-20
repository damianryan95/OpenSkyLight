import { XMLParser } from 'fast-xml-parser'
import { DateTime } from 'luxon'
import { presetById, type NewsFeedDto, type NewsItemDto } from '../../shared/rss'
import { DomainValidationError } from './errors'

const CACHE_TTL_MS = 15 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000
const MAX_ITEMS = 15

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true
})

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return value || null
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object' && value !== null && '#text' in value) {
    const inner = (value as { '#text': unknown })['#text']
    return typeof inner === 'string' || typeof inner === 'number' ? String(inner) : null
  }
  return null
}

function parseDate(raw: string | null): string | null {
  if (raw === null) return null
  for (const parse of [
    () => DateTime.fromRFC2822(raw),
    () => DateTime.fromISO(raw),
    () => DateTime.fromHTTP(raw)
  ]) {
    const value = parse()
    if (value.isValid) return value.toUTC().toISO({ suppressMilliseconds: true })
  }
  return null
}

/** Parses RSS 2.0, RSS 1.0 (RDF), or Atom into a flat headline list. Never throws. */
export function parseFeedXml(xml: string, limit = MAX_ITEMS): { title: string | null; items: NewsItemDto[] } {
  let document: Record<string, unknown>
  try {
    document = parser.parse(xml) as Record<string, unknown>
  } catch {
    return { title: null, items: [] }
  }

  const rss = document.rss as { channel?: Record<string, unknown> } | undefined
  const rdf = document['rdf:RDF'] as Record<string, unknown> | undefined
  const atom = document.feed as Record<string, unknown> | undefined

  let feedTitle: string | null = null
  const items: NewsItemDto[] = []

  if (rss?.channel) {
    feedTitle = text(rss.channel.title)
    for (const item of asArray(rss.channel.item as Record<string, unknown> | Record<string, unknown>[])) {
      const title = text(item.title)
      if (title === null) continue
      items.push({ title, link: text(item.link), publishedAt: parseDate(text(item.pubDate) ?? text(item['dc:date'])) })
    }
  } else if (rdf) {
    const channel = rdf.channel as Record<string, unknown> | undefined
    feedTitle = channel ? text(channel.title) : null
    for (const item of asArray(rdf.item as Record<string, unknown> | Record<string, unknown>[])) {
      const title = text(item.title)
      if (title === null) continue
      items.push({ title, link: text(item.link), publishedAt: parseDate(text(item['dc:date']) ?? text(item.pubDate)) })
    }
  } else if (atom) {
    feedTitle = text(atom.title)
    for (const entry of asArray(atom.entry as Record<string, unknown> | Record<string, unknown>[])) {
      const title = text(entry.title)
      if (title === null) continue
      const links = asArray(entry.link as Record<string, unknown> | Record<string, unknown>[])
      const alternate = links.find((link) => link['@_rel'] === 'alternate' || link['@_rel'] === undefined)
      items.push({
        title,
        link: alternate === undefined ? null : (alternate['@_href'] as string | undefined) ?? null,
        publishedAt: parseDate(text(entry.published) ?? text(entry.updated))
      })
    }
  }

  return { title: feedTitle, items: items.slice(0, limit) }
}

/**
 * Curated-preset news headlines for the kiosk tile. Feeds are fetched by the
 * server rather than the display so a wall browser never reaches the open
 * internet directly, and so one fetch serves every display.
 */
export function createRssService(fetcher: typeof fetch = fetch) {
  const cache = new Map<string, { data: NewsFeedDto; atMs: number }>()

  async function getFeed(feedId: string): Promise<NewsFeedDto> {
    const preset = presetById(feedId)
    if (preset === undefined) throw new DomainValidationError('That news feed is not available.')

    const cached = cache.get(feedId)
    if (cached !== undefined && Date.now() - cached.atMs < CACHE_TTL_MS) return cached.data

    try {
      const response = await fetcher(preset.url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'user-agent': 'OpenSkyLight/1.0 (family calendar display)' }
      })
      if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`)
      const parsed = parseFeedXml(await response.text())
      if (parsed.items.length === 0) throw new Error('Feed had no readable headlines')
      const data: NewsFeedDto = { feedId, label: preset.label, items: parsed.items, fetchedAt: new Date().toISOString() }
      cache.set(feedId, { data, atMs: Date.now() })
      return data
    } catch (error) {
      // Stale headlines beat an empty tile on a wall display.
      if (cached !== undefined) return cached.data
      throw error
    }
  }

  return { getFeed }
}

export type RssService = ReturnType<typeof createRssService>
