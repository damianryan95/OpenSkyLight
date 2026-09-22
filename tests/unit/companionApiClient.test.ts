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
  ApiError, clearApiBaseUrl, clearParentCredential, getApiBaseUrl, getParentCredential,
  pairParentDevice, parentGet, parentMutation, revokeParentDevice, setApiBaseUrl, setParentCredential
} = await import('../../src/companion/src/api/client')

interface Call { url: string; init: RequestInit }

function stubFetch(response: { status: number; body?: unknown }): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    return Promise.resolve({
      status: response.status,
      ok: response.status < 400,
      headers: new Headers(),
      json: () => Promise.resolve(response.body ?? {})
    } as unknown as Response)
  })
  return calls
}

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
})
