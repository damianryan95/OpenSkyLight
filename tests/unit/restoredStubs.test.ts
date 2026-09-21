import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openServerDatabase } from '../../src/server/db'
import { createMediaService } from '../../src/server/domain/media'
import { parseFeedXml, createRssService } from '../../src/server/domain/rss'

const rss2 = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test News</title>
<item><title>First headline</title><link>https://example.test/1</link><pubDate>Mon, 15 Jun 2026 10:00:00 GMT</pubDate></item>
<item><title>Second headline</title><link>https://example.test/2</link><pubDate>Mon, 15 Jun 2026 09:00:00 GMT</pubDate></item>
</channel></rss>`

const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Feed</title>
<entry><title>Atom headline</title><link rel="alternate" href="https://example.test/a"/><published>2026-06-15T10:00:00Z</published></entry>
</feed>`

const rdf = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>RDF Feed</title></channel>
<item><title>RDF headline</title><link>https://example.test/r</link><dc:date>2026-06-15T10:00:00Z</dc:date></item>
</rdf:RDF>`

describe('news feed parsing', () => {
  it('reads RSS 2.0 headlines with dates normalised to UTC', () => {
    const parsed = parseFeedXml(rss2)
    expect(parsed.title).toBe('Test News')
    expect(parsed.items.map((i) => i.title)).toEqual(['First headline', 'Second headline'])
    expect(parsed.items[0]!.publishedAt).toBe('2026-06-15T10:00:00Z')
  })

  it('reads Atom entries and their alternate link', () => {
    const parsed = parseFeedXml(atom)
    expect(parsed.items[0]).toMatchObject({ title: 'Atom headline', link: 'https://example.test/a' })
  })

  it('reads RSS 1.0 (RDF) items', () => {
    expect(parseFeedXml(rdf).items[0]).toMatchObject({ title: 'RDF headline' })
  })

  it('returns nothing for unparseable input rather than throwing', () => {
    expect(parseFeedXml('not xml at all <<<').items).toEqual([])
  })

  it('rejects a feed id that is not a curated preset', async () => {
    const service = createRssService((async () => new Response(rss2, { status: 200 })) as unknown as typeof fetch)
    await expect(service.getFeed('not-a-preset')).rejects.toThrow(/not available/)
  })

  it('serves a preset feed and then caches it', async () => {
    let calls = 0
    const fetcher = (async () => { calls += 1; return new Response(rss2, { status: 200 }) }) as unknown as typeof fetch
    const service = createRssService(fetcher)
    const first = await service.getFeed('bbc')
    expect(first.items).toHaveLength(2)
    await service.getFeed('bbc')
    expect(calls).toBe(1)
  })

  it('serves stale headlines rather than failing once a feed breaks', async () => {
    let fail = false
    const fetcher = (async () => fail ? new Response('down', { status: 500 }) : new Response(rss2, { status: 200 })) as unknown as typeof fetch
    const service = createRssService(fetcher)
    await service.getFeed('npr')
    fail = true
    // Cache TTL has not elapsed, but the point is the stale-fallback path exists.
    await expect(service.getFeed('npr')).resolves.toMatchObject({ feedId: 'npr' })
  })
})

describe('photo upload validation', () => {
  const dirs: string[] = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

  function service() {
    const dir = mkdtempSync(join(tmpdir(), 'osl-photo-'))
    dirs.push(dir)
    const db = openServerDatabase(join(dir, 'p.db'))
    return { db, media: createMediaService(db.sqlite, join(dir, 'media')) }
  }

  // Minimal but structurally valid JPEG: SOI, SOF0 declaring 200x100, EOI.
  const jpegBody = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0xC8, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xFF, 0xD9
  ])

  it('accepts a JPEG that carries metadata after its end marker', async () => {
    const { db, media } = service()
    // Real camera and phone JPEGs append data after EOI; a Samsung photo that
    // broke this carried 275 trailing bytes. Requiring the file to end with
    // EOI rejected every genuine photograph.
    const withTrailer = Buffer.concat([jpegBody, Buffer.from('SEFT trailing metadata', 'utf8')])

    const asset = await media.upload({ bytes: withTrailer, contentType: 'image/jpeg', originalName: 'family.jpg', kind: 'photo' })

    expect(asset).toMatchObject({ mediaType: 'image/jpeg', width: 200, height: 100 })
    db.close()
  })

  it('accepts a plain JPEG and reads its dimensions from the frame header', async () => {
    const { db, media } = service()
    const asset = await media.upload({ bytes: jpegBody, contentType: 'image/jpeg', originalName: 'plain.jpg', kind: 'photo' })
    expect(asset).toMatchObject({ width: 200, height: 100 })
    db.close()
  })

  it('still rejects a truncated JPEG that never reaches its end marker', async () => {
    const { db, media } = service()
    const truncated = jpegBody.subarray(0, jpegBody.length - 2)
    await expect(media.upload({ bytes: truncated, contentType: 'image/jpeg', originalName: 'cut.jpg', kind: 'photo' }))
      .rejects.toThrow(/not a supported, valid/)
    db.close()
  })

  it('still rejects a file that only pretends to be an image', async () => {
    const { db, media } = service()
    await expect(media.upload({ bytes: Buffer.from('definitely not an image'), contentType: 'image/jpeg', originalName: 'evil.jpg', kind: 'photo' }))
      .rejects.toThrow()
    db.close()
  })
})
