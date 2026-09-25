import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A wall display whose credential the server refuses must go back to the QR.
 * Before this, nothing ever cleared the stored credential: a revoked screen sat
 * on the board with every request failing, for ever, and the parent who had just
 * revoked it stood in front of a screen that would never offer to be re-added.
 *
 * `browser.ts` is a browser module. Give it the globals it touches before
 * importing, as the companion client tests do.
 */
class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
  clear(): void { this.values.clear() }
}

const local = new MemoryStorage()
const session = new MemoryStorage()
const reload = vi.fn()
Object.assign(globalThis, {
  localStorage: local,
  sessionStorage: session,
  window: { location: { reload, origin: 'http://kiosk.test', pathname: '/', search: '', hash: '' }, setTimeout: globalThis.setTimeout.bind(globalThis) }
})

const { browserInvoke, consumeDisplayRevokedNotice, displayCredential, persistDisplayCredential } = await import('../../src/renderer/src/api/browser')

const refusal = () => new Response(JSON.stringify({ ok: false, error: { code: 'unauthorized', message: 'A registered display credential is required' } }), {
  status: 401, headers: { 'content-type': 'application/json' }
})

beforeEach(() => {
  local.clear()
  session.clear()
  reload.mockClear()
})

describe('a display whose credential the server refuses', () => {
  it('forgets the credential, marks why, and reboots into enrolment', async () => {
    persistDisplayCredential('a-display-credential', 'kitchen')
    globalThis.fetch = vi.fn(async () => refusal()) as unknown as typeof fetch

    await expect(browserInvoke('people:list', undefined)).rejects.toMatchObject({ code: 'unauthorized' })

    expect(displayCredential()).toBeNull()
    expect(local.getItem('osl.displayId')).toBeNull()
    expect(reload).toHaveBeenCalledTimes(1)
    // The enrolment screen reads this exactly once on the next boot.
    expect(consumeDisplayRevokedNotice()).toBe(true)
    expect(consumeDisplayRevokedNotice()).toBe(false)
  })

  it('keeps the credential through a network failure, which is not a refusal', async () => {
    persistDisplayCredential('a-display-credential', 'kitchen')
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch

    await expect(browserInvoke('people:list', undefined)).rejects.toBeInstanceOf(TypeError)

    // An unreachable server must not wipe a working screen. It keeps rendering
    // its cache and retries; only the server itself saying no counts.
    expect(displayCredential()).toBe('a-display-credential')
    expect(reload).not.toHaveBeenCalled()
    expect(consumeDisplayRevokedNotice()).toBe(false)
  })

  it('keeps the credential through a server error that is not a refusal', async () => {
    persistDisplayCredential('a-display-credential', 'kitchen')
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: 'internal_error', message: 'x' } }), { status: 500 })) as unknown as typeof fetch

    await expect(browserInvoke('people:list', undefined)).rejects.toMatchObject({ code: 'internal_error' })
    expect(displayCredential()).toBe('a-display-credential')
    expect(reload).not.toHaveBeenCalled()
  })

  it('does nothing special when there was no credential to refuse', async () => {
    globalThis.fetch = vi.fn(async () => refusal()) as unknown as typeof fetch

    await expect(browserInvoke('people:list', undefined)).rejects.toMatchObject({ code: 'unauthorized' })

    // An unenrolled screen never mounts the board, so this path is defensive —
    // but a 401 with nothing stored must not loop the page through reloads.
    expect(reload).not.toHaveBeenCalled()
    expect(consumeDisplayRevokedNotice()).toBe(false)
  })
})
