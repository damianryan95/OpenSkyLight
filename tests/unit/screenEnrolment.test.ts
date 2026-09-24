import { afterEach, describe, expect, it, vi } from 'vitest'

/** The enrolment module reaches `ApiError` through the companion client, which
 * is a browser module: give it the storage it touches before importing, exactly
 * as `companionApiClient.test.ts` does. */
class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
  clear(): void { this.values.clear() }
}
Object.assign(globalThis, { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() })

const { ApiError, enrolDisplay, probeHousehold, setParentCredential } = await import('../../src/companion/src/api/client')
const {
  decideEnrolmentStep, explainEnrolmentFailure, normaliseEnrolmentCode, parseEnrolmentQr, readEnrolmentCodeFromHash
} = await import('../../src/companion/src/api/enrolment')

/** A code is read off a wall, often from a few metres away, and typed with a
 * thumb. Every variant below is a correct code that a strict parser would
 * refuse, which would mean telling a parent they got it wrong when they did not. */
describe('enrolment code normalisation', () => {
  it('accepts a code exactly as the screen shows it', () => {
    expect(normaliseEnrolmentCode('K7M2QX4A')).toBe('K7M2QX4A')
  })

  it('accepts lower case, spaces and the hyphen a parent assumes is in there', () => {
    expect(normaliseEnrolmentCode('k7m2qx4a')).toBe('K7M2QX4A')
    expect(normaliseEnrolmentCode('K7M2 QX4A')).toBe('K7M2QX4A')
    expect(normaliseEnrolmentCode('K7M2-QX4A')).toBe('K7M2QX4A')
    expect(normaliseEnrolmentCode('  k7m2 - qx4a  ')).toBe('K7M2QX4A')
  })

  it('maps the letters Crockford removed for looking like digits', () => {
    // I and L are never minted, so seeing one means a 1 was misread.
    expect(normaliseEnrolmentCode('I7M2QX4A')).toBe('17M2QX4A')
    expect(normaliseEnrolmentCode('l7m2qx4a')).toBe('17M2QX4A')
    expect(normaliseEnrolmentCode('O7M2QX4A')).toBe('07M2QX4A')
  })

  it('refuses a U rather than guessing, because nothing else looks like one', () => {
    expect(normaliseEnrolmentCode('U7M2QX4A')).toBeNull()
  })

  it('refuses anything that is not eight characters', () => {
    expect(normaliseEnrolmentCode('K7M2QX4')).toBeNull()
    expect(normaliseEnrolmentCode('K7M2QX4AB')).toBeNull()
    expect(normaliseEnrolmentCode('')).toBeNull()
    expect(normaliseEnrolmentCode('        ')).toBeNull()
  })
})

/** The QR carries the server address as well as the code, and that half is how
 * a phone learns where the household is without anyone typing an IP address. */
describe('enrolment QR parsing', () => {
  it('reads the address and the code out of what the kiosk encodes', () => {
    expect(parseEnrolmentQr('http://192.168.1.50:3000/admin/#enrol=K7M2QX4A')).toEqual({
      serverAddress: 'http://192.168.1.50:3000',
      code: 'K7M2QX4A'
    })
  })

  it('keeps the address the kiosk was actually served from, whatever it is', () => {
    // Enrolment links inherit whatever address the household uses; hardcoding a
    // host here would break every deployment that is not the developer's.
    expect(parseEnrolmentQr('https://openskylight.example/admin/#enrol=K7M2QX4A')?.serverAddress).toBe('https://openskylight.example')
    expect(parseEnrolmentQr('http://openskylight.local:3000/admin/#enrol=K7M2QX4A')?.serverAddress).toBe('http://openskylight.local:3000')
  })

  it('normalises a code that survived a lossy scan', () => {
    expect(parseEnrolmentQr('http://osl.local/admin/#enrol=k7m2qx4a')?.code).toBe('K7M2QX4A')
    expect(parseEnrolmentQr('http://osl.local/admin/#enrol=K7M2QX4A%20')?.code).toBe('K7M2QX4A')
  })

  it('refuses every other QR a camera might find', () => {
    expect(parseEnrolmentQr('')).toBeNull()
    expect(parseEnrolmentQr('not a url at all')).toBeNull()
    expect(parseEnrolmentQr('WIFI:S=Home;T=WPA;P=hunter2;;')).toBeNull()
    expect(parseEnrolmentQr('9310779301234')).toBeNull()
    expect(parseEnrolmentQr('javascript:alert(1)#enrol=K7M2QX4A')).toBeNull()
    expect(parseEnrolmentQr('{"enrol":"K7M2QX4A"}')).toBeNull()
  })

  it('refuses our own URL shape when it carries no usable code', () => {
    expect(parseEnrolmentQr('http://192.168.1.50:3000/admin/')).toBeNull()
    expect(parseEnrolmentQr('http://192.168.1.50:3000/admin/#enrol=')).toBeNull()
    expect(parseEnrolmentQr('http://192.168.1.50:3000/admin/#enrol=TOOSHORT1')).toBeNull()
    // A display enrolment link is a credential, not a code. Reading one here
    // would put a secret through a path that treats it as an identifier.
    expect(parseEnrolmentQr('http://192.168.1.50:3000/#displayCredential=abc123')).toBeNull()
  })
})

/** The QR is a URL so a parent who installed nothing can scan it with the
 * camera app they already have. That lands them on `/admin/` with the code in
 * the fragment, which is the same code arriving by a different door. */
describe('a code that arrives in the address bar', () => {
  it('reads the fragment an ordinary camera app leaves behind', () => {
    expect(readEnrolmentCodeFromHash('#enrol=K7M2QX4A')).toBe('K7M2QX4A')
    expect(readEnrolmentCodeFromHash('#section=displays&enrol=k7m2qx4a')).toBe('K7M2QX4A')
  })

  it('finds nothing in the fragments this app already uses', () => {
    expect(readEnrolmentCodeFromHash('')).toBeNull()
    expect(readEnrolmentCodeFromHash('#t=a-pairing-token')).toBeNull()
    expect(readEnrolmentCodeFromHash('#displayCredential=abc123&displayId=display-1')).toBeNull()
    expect(readEnrolmentCodeFromHash('#enrolment=K7M2QX4A')).toBeNull()
  })

  it('refuses a fragment carrying something that is not a code', () => {
    expect(readEnrolmentCodeFromHash('#enrol=')).toBeNull()
    expect(readEnrolmentCodeFromHash('#enrol=%E0%A4%A')).toBeNull()
    expect(readEnrolmentCodeFromHash('#enrol=WAYTOOLONGFORACODE')).toBeNull()
  })
})

const scan = { serverAddress: 'http://192.168.1.50:3000', code: 'K7M2QX4A' }

/** ADR 0006's three cases. They are decided from the state of the household
 * rather than from a flag, which is what makes "the fourth screen must not
 * re-run setup" fall out instead of having to be remembered. */
describe('the three redemption cases', () => {
  it('sends an already-paired phone straight to naming the screen', () => {
    expect(decideEnrolmentStep(scan, { paired: true, serverAddress: 'http://192.168.1.50:3000' })).toEqual({
      kind: 'name-the-screen',
      serverAddress: 'http://192.168.1.50:3000',
      addressMismatch: false
    })
  })

  it('asks an unpaired phone for the PIN of the household it just met', () => {
    expect(decideEnrolmentStep(scan, { paired: false, configured: true })).toEqual({
      kind: 'pair-this-phone',
      serverAddress: 'http://192.168.1.50:3000'
    })
  })

  it('refuses to pretend it can claim a household that has no PIN', () => {
    expect(decideEnrolmentStep(scan, { paired: false, configured: false })).toEqual({
      kind: 'household-not-set-up',
      serverAddress: 'http://192.168.1.50:3000'
    })
  })

  it('redeems against the address the phone is authenticated with, not the scanned one', () => {
    // The credential is only good at the address it was minted at. The same box
    // reached by two names is the common cause, so this is a note, not a block.
    const step = decideEnrolmentStep({ ...scan, serverAddress: 'http://openskylight.local:3000' }, { paired: true, serverAddress: 'http://192.168.1.50:3000' })
    expect(step).toEqual({ kind: 'name-the-screen', serverAddress: 'http://192.168.1.50:3000', addressMismatch: true })
  })

  it('claims no mismatch in the browser, which has no stored address to compare', () => {
    expect(decideEnrolmentStep(scan, { paired: true, serverAddress: '' })).toEqual({
      kind: 'name-the-screen', serverAddress: '', addressMismatch: false
    })
  })
})

/** A refused code says nothing about why, deliberately. So the phone says what
 * to do instead, which is the same in all three cases: look at the screen. */
describe('what a parent is told when redemption fails', () => {
  const refusal = (status: number, code = 'not_found', retryAfter?: number) =>
    new ApiError(status, code, 'Enrolment code could not be redeemed', retryAfter)

  it('sends them back to the screen for a wrong, expired or spent code alike', () => {
    for (const status of [400, 404, 409, 410, 422]) {
      const text = explainEnrolmentFailure(refusal(status), 'http://192.168.1.50:3000')
      expect(text).toMatch(/expired/)
      expect(text).toMatch(/screen/)
    }
  })

  it('names the wait when the server is throttling', () => {
    expect(explainEnrolmentFailure(refusal(429, 'rate_limited', 30), 'http://osl.local')).toContain('30 seconds')
    expect(explainEnrolmentFailure(refusal(429, 'rate_limited'), 'http://osl.local')).toContain('Wait a minute')
  })

  it('tells a revoked phone to connect again rather than to rescan', () => {
    expect(explainEnrolmentFailure(refusal(401, 'unauthorized'), 'http://osl.local')).toMatch(/household PIN/)
  })

  it('treats a dead network as a network problem, with the address in it', () => {
    const text = explainEnrolmentFailure(new TypeError('Failed to fetch'), 'http://192.168.1.50:3000')
    expect(text).toContain('http://192.168.1.50:3000')
    expect(text).toMatch(/Wi-Fi/)
  })
})

interface Call { url: string; init: RequestInit }

function stubFetch(status: number, body: unknown): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    return Promise.resolve({ status, ok: status < 400, headers: new Headers(), json: () => Promise.resolve(body) } as unknown as Response)
  })
  return calls
}

describe('redeeming a code over the wire', () => {
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  it('posts the code and the name, signed with this phone’s credential', async () => {
    setParentCredential('phone-credential')
    const calls = stubFetch(201, { id: 'display-1', name: 'Kitchen wall' })
    const display = await enrolDisplay('K7M2QX4A', 'Kitchen wall')
    expect(calls[0].url).toBe('/api/v1/displays/enrol')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.body).toBe('{"code":"K7M2QX4A","name":"Kitchen wall"}')
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer phone-credential')
    // The screen collects its own credential by polling; nothing secret comes
    // back to the phone, and nothing here should start expecting one.
    expect(display).not.toHaveProperty('credential')
  })

  it('asks an unmet household whether it has ever been set up, with no credential', async () => {
    setParentCredential('credential-for-some-other-household')
    const calls = stubFetch(200, { configured: false, authenticated: false, expiresAt: null })
    const status = await probeHousehold('192.168.1.50:3000/admin/')
    expect(status.configured).toBe(false)
    expect(calls[0].url).toBe('http://192.168.1.50:3000/api/v1/auth/status')
    expect(new Headers(calls[0].init.headers).get('authorization')).toBeNull()
    expect(calls[0].init.credentials).toBe('omit')
  })

  it('does not drop a working credential when an unrelated household refuses the probe', async () => {
    setParentCredential('still-valid')
    stubFetch(401, {})
    await expect(probeHousehold('http://192.168.1.99:3000')).rejects.toBeInstanceOf(ApiError)
    expect(localStorage.getItem('osl.parentCredential')).toBe('still-valid')
  })
})
