import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The companion client is a browser module: give it the three globals it
 * touches before importing it, since the node test environment has none. */
class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
  clear(): void { this.values.clear() }
}

const localStorageStub = new MemoryStorage()
const sessionStorageStub = new MemoryStorage()
Object.assign(globalThis, { localStorage: localStorageStub, sessionStorage: sessionStorageStub })

const {
  ApiError, clearApiBaseUrl, clearParentCredential, connectToHousehold, disconnectFromHousehold,
  getApiBaseUrl, getParentCredential, isNativeApp, normalizeServerAddress,
  pairParentDevice, parentGet, parentMutation, revokeParentDevice, setApiBaseUrl, setParentCredential
} = await import('../../src/companion/src/api/client')

interface Call { url: string; init: RequestInit }

interface StubResponse { status: number; body?: unknown }

function reply(response: StubResponse): Response {
  return {
    status: response.status,
    ok: response.status < 400,
    headers: new Headers(),
    json: () => Promise.resolve(response.body ?? {})
  } as unknown as Response
}

function stubFetch(...responses: StubResponse[]): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    // One response replays for every call; several are consumed in order, so a
    // pairing (POST then status check) can be scripted end to end.
    return Promise.resolve(reply(responses[Math.min(calls.length - 1, responses.length - 1)]))
  })
  return calls
}

function stubFetchRejecting(error: Error): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    return Promise.reject(error)
  })
  return calls
}

const pairedBody = { id: 'device-1', name: 'My phone', pairedAt: '2026-09-22T10:00:00.000Z', lastSeenAt: null, revokedAt: null, credential: 'secret-credential' }

const headerOf = (call: Call, name: string): string | null => new Headers(call.init.headers).get(name)

describe('companion api client', () => {
  beforeEach(() => {
    localStorageStub.clear(); sessionStorageStub.clear(); vi.unstubAllGlobals()
  })

  it('defaults to the relative, same-origin browser path with a CSRF header on mutations', async () => {
    sessionStorageStub.setItem('osl.parentCsrfToken', 'csrf-value')
    const calls = stubFetch({ status: 200, body: { ok: true } })
    await parentMutation('/api/v1/displays', 'POST', { name: 'Kitchen' })
    expect(calls[0].url).toBe('/api/v1/displays')
    expect(calls[0].init.credentials).toBe('same-origin')
    expect(headerOf(calls[0], 'x-osl-csrf-token')).toBe('csrf-value')
    expect(headerOf(calls[0], 'authorization')).toBeNull()
  })

  it('prefixes a configured base url without disturbing the path', async () => {
    setApiBaseUrl('http://192.168.1.10:3000/')
    expect(getApiBaseUrl()).toBe('http://192.168.1.10:3000')
    const calls = stubFetch({ status: 200, body: {} })
    await parentGet('/api/v1/people')
    expect(calls[0].url).toBe('http://192.168.1.10:3000/api/v1/people')
    clearApiBaseUrl()
    expect(getApiBaseUrl()).toBe('')
  })

  it('sends a bearer credential with no cookie and no CSRF header', async () => {
    setParentCredential('phone-credential')
    sessionStorageStub.setItem('osl.parentCsrfToken', 'csrf-value')
    const calls = stubFetch({ status: 204 })
    await revokeParentDevice('device-1')
    expect(calls[0].url).toBe('/api/v1/parent-devices/device-1/revoke')
    expect(calls[0].init.credentials).toBe('omit')
    expect(headerOf(calls[0], 'authorization')).toBe('Bearer phone-credential')
    expect(headerOf(calls[0], 'x-osl-csrf-token')).toBeNull()
  })

  it('stores a paired credential and never hands it back to the caller', async () => {
    const calls = stubFetch({
      status: 201,
      body: { id: 'device-1', name: 'Mum phone', pairedAt: '2026-09-22T10:00:00.000Z', lastSeenAt: null, revokedAt: null, credential: 'secret-credential' }
    })
    const device = await pairParentDevice('1234', 'Mum phone')
    expect(device).not.toHaveProperty('credential')
    expect(JSON.stringify(device)).not.toContain('secret-credential')
    expect(getParentCredential()).toBe('secret-credential')
    expect(calls[0].init.credentials).toBe('same-origin')
  })

  it('drops a revoked credential on the first refusal', async () => {
    setParentCredential('revoked-credential')
    stubFetch({ status: 401, body: { error: { code: 'unauthorized', message: 'Parent session is required' } } })
    await expect(parentGet('/api/v1/people')).rejects.toBeInstanceOf(ApiError)
    expect(getParentCredential()).toBeNull()
  })

  it('keeps an existing credential when a pairing attempt is refused', async () => {
    setParentCredential('still-valid')
    stubFetch({ status: 401, body: { error: { code: 'unauthorized', message: 'That PIN was not recognised' } } })
    await expect(pairParentDevice('0000', 'Spare phone')).rejects.toBeInstanceOf(ApiError)
    expect(getParentCredential()).toBe('still-valid')
    clearParentCredential()
    expect(getParentCredential()).toBeNull()
  })

  it('reports the web as non-native, so the browser never sees the pairing screen', () => {
    expect(isNativeApp()).toBe(false)
  })
})

/** What a parent types into the app is the single most likely thing to be
 * wrong, and every variant below produces a base URL that fails every request
 * if it is stored verbatim. */
describe('household server address normalisation', () => {
  it('assumes http for a bare host, with or without a port', () => {
    expect(normalizeServerAddress('openskylight.local:3000')).toBe('http://openskylight.local:3000')
    expect(normalizeServerAddress('192.168.1.50:3000')).toBe('http://192.168.1.50:3000')
    expect(normalizeServerAddress('openskylight.local')).toBe('http://openskylight.local')
  })

  it('keeps a scheme the parent typed themselves', () => {
    expect(normalizeServerAddress('https://openskylight.local:3000')).toBe('https://openskylight.local:3000')
    expect(normalizeServerAddress('HTTP://192.168.1.50:3000')).toBe('HTTP://192.168.1.50:3000')
  })

  it('strips a trailing slash, however many of them there are', () => {
    expect(normalizeServerAddress('http://192.168.1.50:3000/')).toBe('http://192.168.1.50:3000')
    expect(normalizeServerAddress('192.168.1.50:3000//')).toBe('http://192.168.1.50:3000')
  })

  it('strips the /admin/ off a pasted browser address', () => {
    expect(normalizeServerAddress('http://192.168.1.50:3000/admin/')).toBe('http://192.168.1.50:3000')
    expect(normalizeServerAddress('http://openskylight.local:3000/admin')).toBe('http://openskylight.local:3000')
    expect(normalizeServerAddress('openskylight.local:3000/admin/')).toBe('http://openskylight.local:3000')
    expect(normalizeServerAddress('http://192.168.1.50:3000/admin/#section')).toBe('http://192.168.1.50:3000')
  })

  it('does not eat a host that is genuinely called admin', () => {
    expect(normalizeServerAddress('http://admin')).toBe('http://admin')
    expect(normalizeServerAddress('admin')).toBe('http://admin')
  })

  it('ignores the whitespace a paste or a keyboard adds', () => {
    expect(normalizeServerAddress('  http://192.168.1.50:3000/admin/  ')).toBe('http://192.168.1.50:3000')
  })
})

/** The unwind is the part that matters: a half-applied pairing leaves an
 * installed app posting to an address it can never authenticate against, and a
 * parent with no way back except reinstalling it. */
describe('connecting an app to a household', () => {
  beforeEach(() => {
    localStorageStub.clear(); sessionStorageStub.clear(); vi.unstubAllGlobals()
  })

  it('stores a normalised base url and a credential once pairing and the status check both pass', async () => {
    const calls = stubFetch(
      { status: 201, body: pairedBody },
      { status: 200, body: { configured: true, authenticated: true, expiresAt: null } }
    )
    const status = await connectToHousehold('192.168.1.50:3000/admin/', '1234', 'My phone')
    expect(status.authenticated).toBe(true)
    expect(getApiBaseUrl()).toBe('http://192.168.1.50:3000')
    expect(getParentCredential()).toBe('secret-credential')
    expect(calls[0].url).toBe('http://192.168.1.50:3000/api/v1/parent-devices')
    expect(calls[1].url).toBe('http://192.168.1.50:3000/api/v1/auth/status')
  })

  it('leaves no base url and no credential behind when the PIN is refused', async () => {
    stubFetch({ status: 401, body: { error: { code: 'unauthorized', message: 'Invalid PIN' } } })
    await expect(connectToHousehold('192.168.1.50:3000', '0000', 'My phone')).rejects.toBeInstanceOf(ApiError)
    expect(getApiBaseUrl()).toBe('')
    expect(getParentCredential()).toBeNull()
  })

  it('leaves no base url behind when nothing answers at the address', async () => {
    stubFetchRejecting(new TypeError('Failed to fetch'))
    await expect(connectToHousehold('192.168.1.99:3000', '1234', 'My phone')).rejects.toBeInstanceOf(TypeError)
    expect(getApiBaseUrl()).toBe('')
    expect(getParentCredential()).toBeNull()
  })

  it('unwinds a credential that paired but does not authenticate', async () => {
    stubFetch(
      { status: 201, body: pairedBody },
      { status: 200, body: { configured: true, authenticated: false, expiresAt: null } }
    )
    await expect(connectToHousehold('192.168.1.50:3000', '1234', 'My phone')).rejects.toBeInstanceOf(ApiError)
    expect(getApiBaseUrl()).toBe('')
    expect(getParentCredential()).toBeNull()
  })

  it('forgets the household locally when a phone is unpaired', () => {
    setApiBaseUrl('http://192.168.1.50:3000')
    setParentCredential('secret-credential')
    sessionStorageStub.setItem('osl.parentCsrfToken', 'csrf-value')
    disconnectFromHousehold()
    expect(getApiBaseUrl()).toBe('')
    expect(getParentCredential()).toBeNull()
    expect(sessionStorageStub.getItem('osl.parentCsrfToken')).toBeNull()
  })
})
