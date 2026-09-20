import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCalDavClient, fetchIcsFeed, CalDavError } from '../../src/server/sync/caldav'

const fixture = (name: string): string => readFileSync(join('tests/fixtures/caldav', name), 'utf8')

const credentials = { baseUrl: 'https://caldav.example.test/', username: 'alice', password: 'app-password' }

function fetcherFor(routes: { match: (url: string, init: RequestInit) => boolean; body: string; status?: number }[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const route = routes.find((candidate) => candidate.match(url, init ?? {}))
    if (route === undefined) throw new Error(`unexpected request: ${url}`)
    return new Response(route.body, { status: route.status ?? 207 })
  }) as unknown as typeof fetch
}

describe('CalDAV client', () => {
  it('discovers only event collections across iCloud-shaped principal indirection', async () => {
    const client = createCalDavClient(credentials, fetcherFor([
      { match: (url, init) => init.method === 'PROPFIND' && url === 'https://caldav.example.test/' && String(init.body).includes('current-user-principal'), body: fixture('icloud-principal.xml') },
      { match: (url, init) => init.method === 'PROPFIND' && url.includes('/principal/'), body: fixture('icloud-home.xml') },
      { match: (url, init) => init.method === 'PROPFIND' && url.includes('/calendars/'), body: fixture('nextcloud-collections.xml') }
    ]))

    const collections = await client.discover()

    expect(collections.map((collection) => collection.name)).toEqual(['Personal', 'Shared read-only'])
    expect(collections[0]).toMatchObject({ color: '#2F8FED', readOnly: false })
    expect(collections[1]).toMatchObject({ readOnly: true })
    // Hrefs resolve against the calendar-home-set, not the original base URL.
    expect(collections[0]!.url).toBe('https://p01-caldav.icloud.com/remote.php/dav/calendars/alice/personal/')
  })

  it('reads events and their etags from a calendar-query report', async () => {
    const client = createCalDavClient(credentials, fetcherFor([
      { match: (_url, init) => init.method === 'REPORT', body: fixture('icloud-events.xml') }
    ]))

    const resources = await client.listEvents('https://caldav.example.test/12345678/calendars/home/', {
      start: new Date('2026-06-01T00:00:00Z'),
      end: new Date('2026-07-01T00:00:00Z')
    })

    expect(resources).toHaveLength(1)
    expect(resources[0]!.etag).toBe('"etag-abc"')
    expect(resources[0]!.data).toContain('SUMMARY:Dinner with Ava')
  })

  it('reports a credential failure without leaking the server response body', async () => {
    const client = createCalDavClient(credentials, fetcherFor([
      { match: () => true, body: 'password=app-password leaked in body', status: 401 }
    ]))

    await expect(client.discover()).rejects.toThrow(CalDavError)
    await expect(client.discover()).rejects.toThrow(/rejected the username or app password/)
    await expect(client.discover()).rejects.not.toThrow(/app-password/)
  })

  it('refuses non-http schemes so a source cannot reach the local filesystem', () => {
    expect(() => createCalDavClient({ ...credentials, baseUrl: 'file:///etc/passwd' })).toThrow(/must use http or https/)
    expect(() => createCalDavClient({ ...credentials, baseUrl: 'not a url' })).toThrow(/valid calendar server address/)
  })

  it('surfaces a feed error without the remote body', async () => {
    const fetcher = fetcherFor([{ match: () => true, body: 'secret-token=abc', status: 500 }])
    await expect(fetchIcsFeed('https://feeds.example.test/family.ics', fetcher)).rejects.toThrow(/returned an error \(500\)/)
  })

  it('returns feed text on success', async () => {
    const fetcher = fetcherFor([{ match: () => true, body: 'BEGIN:VCALENDAR\nEND:VCALENDAR', status: 200 }])
    await expect(fetchIcsFeed('https://feeds.example.test/family.ics', fetcher)).resolves.toContain('VCALENDAR')
  })
})
