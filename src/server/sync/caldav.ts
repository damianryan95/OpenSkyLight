import { XMLParser } from 'fast-xml-parser'

export class CalDavError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CalDavError'
  }
}

/**
 * The server refused a write because the resource is not in the state we
 * believed — someone else edited or deleted it since we last read it. Distinct
 * from a transport failure because the queue must not simply retry it: the
 * conflict rule decides what happens next.
 */
export class CalDavConflictError extends CalDavError {
  constructor(message: string) {
    super(message)
    this.name = 'CalDavConflictError'
  }
}

export interface CalDavCredentials {
  baseUrl: string
  username: string
  password: string
}

export interface CalDavCollection {
  /** Absolute URL of the calendar collection. */
  url: string
  name: string
  color: string
  readOnly: boolean
}

export interface CalDavResource {
  href: string
  etag: string | null
  data: string
}

export type Fetcher = typeof fetch

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true
})

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

/** Every response body is XML from a remote server: parse defensively. */
function parseXml(body: string): Record<string, unknown> {
  try {
    return parser.parse(body) as Record<string, unknown>
  } catch {
    throw new CalDavError('The calendar server returned a response that could not be read.')
  }
}

function responses(document: Record<string, unknown>): Record<string, unknown>[] {
  const multistatus = document.multistatus as Record<string, unknown> | undefined
  return asArray(multistatus?.response as Record<string, unknown> | Record<string, unknown>[] | undefined)
}

/** Picks the propstat block that actually succeeded; servers return several. */
function okProps(response: Record<string, unknown>): Record<string, unknown> {
  for (const propstat of asArray(response.propstat as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
    const status = String(propstat.status ?? '')
    if (status.includes('200')) return (propstat.prop as Record<string, unknown> | undefined) ?? {}
  }
  return {}
}

function textOf(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object' && '#text' in (value as Record<string, unknown>)) {
    const inner = (value as Record<string, unknown>)['#text']
    return typeof inner === 'string' ? inner : null
  }
  return null
}

function absolute(href: string, base: string): string {
  try {
    return new URL(href, base).toString()
  } catch {
    throw new CalDavError('The calendar server returned an unusable location.')
  }
}

function assertSafeUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new CalDavError('Enter a valid calendar server address.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new CalDavError('The calendar server address must use http or https.')
  }
  return url
}

export function createCalDavClient(credentials: CalDavCredentials, fetcher: Fetcher = fetch) {
  const base = assertSafeUrl(credentials.baseUrl).toString()
  const authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`, 'utf8').toString('base64')}`

  async function request(method: string, url: string, body: string, depth: '0' | '1'): Promise<string> {
    let response: Response
    try {
      response = await fetcher(url, {
        method,
        headers: {
          authorization,
          depth,
          'content-type': 'application/xml; charset=utf-8'
        },
        body
      })
    } catch {
      throw new CalDavError('The calendar server could not be reached.')
    }
    if (response.status === 401 || response.status === 403) {
      throw new CalDavError('The calendar server rejected the username or app password.')
    }
    if (response.status < 200 || response.status >= 300) {
      // The remote body may echo credentials or tokens, so it never reaches
      // the message, the logs, or the parent UI.
      throw new CalDavError(`The calendar server returned an error (${response.status}).`)
    }
    return await response.text()
  }

  /** current-user-principal -> calendar-home-set -> the collections themselves. */
  async function discover(): Promise<CalDavCollection[]> {
    const principalBody = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>'
    const principalDocument = parseXml(await request('PROPFIND', base, principalBody, '0'))
    const principalHref = responses(principalDocument)
      .map((response) => textOf((okProps(response)['current-user-principal'] as Record<string, unknown> | undefined)?.href))
      .find((href): href is string => href !== null)
    const principalUrl = principalHref === undefined ? base : absolute(principalHref, base)

    const homeBody = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>'
    const homeDocument = parseXml(await request('PROPFIND', principalUrl, homeBody, '0'))
    const homeHref = responses(homeDocument)
      .map((response) => textOf((okProps(response)['calendar-home-set'] as Record<string, unknown> | undefined)?.href))
      .find((href): href is string => href !== null)
    const homeUrl = homeHref === undefined ? principalUrl : absolute(homeHref, base)

    const listBody = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:s="http://apple.com/ns/ical/"><d:prop><d:resourcetype/><d:displayname/><d:current-user-privilege-set/><s:calendar-color/><c:supported-calendar-component-set/></d:prop></d:propfind>'
    const listDocument = parseXml(await request('PROPFIND', homeUrl, listBody, '1'))

    const collections: CalDavCollection[] = []
    for (const response of responses(listDocument)) {
      const props = okProps(response)
      const resourcetype = props.resourcetype as Record<string, unknown> | undefined
      if (resourcetype === undefined || !('calendar' in resourcetype)) continue
      const components = asArray((props['supported-calendar-component-set'] as Record<string, unknown> | undefined)?.comp as Record<string, unknown> | Record<string, unknown>[] | undefined)
      // An address book or task list advertises itself the same way; only take
      // collections that actually carry events.
      if (components.length > 0 && !components.some((component) => String(component['@name'] ?? '').toUpperCase() === 'VEVENT')) continue
      const href = textOf(response.href)
      if (href === null) continue
      const privileges = asArray((props['current-user-privilege-set'] as Record<string, unknown> | undefined)?.privilege as Record<string, unknown> | Record<string, unknown>[] | undefined)
      collections.push({
        url: absolute(href, homeUrl),
        name: textOf(props.displayname) ?? 'Calendar',
        color: (textOf(props['calendar-color']) ?? '#0091FF').slice(0, 7),
        readOnly: privileges.length > 0 && !privileges.some((privilege) => 'write' in privilege || 'write-content' in privilege)
      })
    }
    return collections
  }

  /**
   * Reads one event resource. Used by the write path when a precondition fails:
   * resolving that conflict means knowing what the other version actually says,
   * and re-running a whole collection REPORT to find one event would be absurd.
   *
   * Returns null when the resource is gone, which is a legitimate answer — the
   * other writer may have deleted it.
   */
  async function getEvent(resourceUrl: string): Promise<CalDavResource | null> {
    const url = assertSafeUrl(resourceUrl).toString()
    let response: Response
    try {
      response = await fetcher(url, { method: 'GET', headers: { authorization, accept: 'text/calendar' } })
    } catch {
      throw new CalDavError('The calendar server could not be reached.')
    }
    if (response.status === 404 || response.status === 410) return null
    if (response.status === 401 || response.status === 403) {
      throw new CalDavError('The calendar server rejected the username or app password.')
    }
    if (response.status < 200 || response.status >= 300) {
      throw new CalDavError(`The calendar server returned an error (${response.status}).`)
    }
    return { href: url, etag: response.headers.get('etag'), data: await response.text() }
  }

  /**
   * Writes one event resource. `expectedEtag` drives the precondition, and the
   * choice of precondition is the whole idempotency story:
   *
   * - an etag means "replace exactly the version I read" (`If-Match`), so a
   *   concurrent edit is refused rather than overwritten unseen;
   * - null means "create, and only if nothing is there" (`If-None-Match: *`),
   *   so a replayed create after a crash cannot produce a second event.
   *
   * A replayed create is reported as success, not conflict: the resource
   * existing is exactly the outcome the caller wanted.
   */
  async function putEvent(resourceUrl: string, icsBody: string, expectedEtag: string | null): Promise<{ etag: string | null; alreadyExisted: boolean }> {
    const url = assertSafeUrl(resourceUrl).toString()
    const headers: Record<string, string> = {
      authorization,
      'content-type': 'text/calendar; charset=utf-8'
    }
    if (expectedEtag === null) headers['if-none-match'] = '*'
    else headers['if-match'] = expectedEtag

    let response: Response
    try {
      response = await fetcher(url, { method: 'PUT', headers, body: icsBody })
    } catch {
      throw new CalDavError('The calendar server could not be reached.')
    }
    if (response.status === 401 || response.status === 403) {
      throw new CalDavError('The calendar server would not accept a change to this calendar.')
    }
    if (response.status === 412 || response.status === 409) {
      if (expectedEtag === null) return { etag: response.headers.get('etag'), alreadyExisted: true }
      throw new CalDavConflictError('This event changed in the calendar since the board last read it.')
    }
    if (response.status < 200 || response.status >= 300) {
      // As with reads, the remote body may echo credentials and never reaches
      // the message, the logs, or the parent UI.
      throw new CalDavError(`The calendar server returned an error (${response.status}).`)
    }
    // A server may answer with no etag and expect a re-read to discover it.
    return { etag: response.headers.get('etag'), alreadyExisted: false }
  }

  /** Removes one event resource. A resource already gone counts as removed:
   * the caller asked for its absence, which is the state that now holds. */
  async function deleteEvent(resourceUrl: string, expectedEtag: string | null): Promise<void> {
    const url = assertSafeUrl(resourceUrl).toString()
    const headers: Record<string, string> = { authorization }
    if (expectedEtag !== null) headers['if-match'] = expectedEtag

    let response: Response
    try {
      response = await fetcher(url, { method: 'DELETE', headers })
    } catch {
      throw new CalDavError('The calendar server could not be reached.')
    }
    if (response.status === 404 || response.status === 410) return
    if (response.status === 401 || response.status === 403) {
      throw new CalDavError('The calendar server would not accept a change to this calendar.')
    }
    if (response.status === 412) {
      throw new CalDavConflictError('This event changed in the calendar since the board last read it.')
    }
    if (response.status < 200 || response.status >= 300) {
      throw new CalDavError(`The calendar server returned an error (${response.status}).`)
    }
  }

  /** Events overlapping the window, as raw iCalendar documents. */
  async function listEvents(collectionUrl: string, window: { start: Date; end: Date }): Promise<CalDavResource[]> {
    const stamp = (value: Date): string => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const body = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${stamp(window.start)}" end="${stamp(window.end)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`
    const document = parseXml(await request('REPORT', assertSafeUrl(collectionUrl).toString(), body, '1'))
    const resources: CalDavResource[] = []
    for (const response of responses(document)) {
      const props = okProps(response)
      const data = textOf(props['calendar-data'])
      const href = textOf(response.href)
      if (data === null || href === null) continue
      resources.push({ href, etag: textOf(props.getetag), data })
    }
    return resources
  }

  return { discover, listEvents, getEvent, putEvent, deleteEvent }
}

export type CalDavClient = ReturnType<typeof createCalDavClient>

/** Fetches a read-only ICS subscription feed. */
export async function fetchIcsFeed(url: string, fetcher: Fetcher = fetch): Promise<string> {
  const target = assertSafeUrl(url)
  let response: Response
  try {
    response = await fetcher(target.toString(), { method: 'GET', headers: { accept: 'text/calendar, text/plain' } })
  } catch {
    throw new CalDavError('The calendar feed could not be reached.')
  }
  if (response.status < 200 || response.status >= 300) {
    throw new CalDavError(`The calendar feed returned an error (${response.status}).`)
  }
  return await response.text()
}
