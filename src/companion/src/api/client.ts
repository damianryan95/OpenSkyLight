import { Capacitor } from '@capacitor/core'
import type { DisplayDevice, PairedParentDeviceDto, ParentDeviceDto, ClaimHouseholdRequest, PairParentDeviceRequest } from '@shared/api/contract'
import type { IpcChannel, IpcContract, IpcResult } from '@shared/ipc/contract'
import { clearPhoneCalendarState, setPairedDeviceName } from './phoneCalendarStorage'

const TOKEN_KEY = 'osl.companionToken'
const CSRF_TOKEN_KEY = 'osl.parentCsrfToken'
const BASE_URL_KEY = 'osl.apiBaseUrl'
const PARENT_CREDENTIAL_KEY = 'osl.parentCredential'
const PARENT_DEVICES_PATH = '/api/v1/parent-devices'

export interface ParentAuthStatus {
  configured: boolean
  authenticated: boolean
  expiresAt: string | null
}

/** True only inside the Capacitor shell. The browser at `/admin/` is served by
 * the household server itself, so it is already at the right origin with a
 * session — none of the pairing machinery below applies to it, and this
 * returning `false` on the web is what keeps that path untouched. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

/** What a parent types is never quite a base URL. They omit the scheme, they
 * leave the trailing slash on, and — most often — they paste the browser
 * address bar, which ends in `/admin/` because that is where they were. All
 * three produce a base URL that fails every request, so fix them here rather
 * than explaining them in an error afterwards. */
export function normalizeServerAddress(input: string): string {
  let value = input.trim()
  // A pasted address carries the rest of the page with it.
  value = value.replace(/[#?].*$/, '')
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `http://${value}`
  value = value.replace(/\/+$/, '')
  // Only when something is left that is still an address: a host genuinely
  // called `admin` would otherwise be eaten down to `http:/`.
  const withoutAdmin = value.replace(/\/admin$/i, '')
  if (/^[a-z][a-z0-9+.-]*:\/\/.+/i.test(withoutAdmin)) value = withoutAdmin
  return value.replace(/\/+$/, '')
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/** Empty means "wherever this page was served from" — the browser at `/admin/`
 * never sets one, so its requests stay relative and same-origin. An app packaged
 * at a foreign origin sets the household server address it was given. */
export function getApiBaseUrl(): string {
  return localStorage.getItem(BASE_URL_KEY) ?? ''
}

export function setApiBaseUrl(baseUrl: string): void {
  localStorage.setItem(BASE_URL_KEY, baseUrl.trim().replace(/\/+$/, ''))
}

export function clearApiBaseUrl(): void {
  localStorage.removeItem(BASE_URL_KEY)
}

function apiUrl(path: string): string {
  const base = getApiBaseUrl()
  return base === '' ? path : `${base}${path}`
}

/** A paired phone's parent-level credential. Read only to sign requests: it is
 * never rendered, logged, or put in a URL. */
export function getParentCredential(): string | null {
  return localStorage.getItem(PARENT_CREDENTIAL_KEY)
}

export function setParentCredential(credential: string): void {
  localStorage.setItem(PARENT_CREDENTIAL_KEY, credential)
}

export function clearParentCredential(): void {
  localStorage.removeItem(PARENT_CREDENTIAL_KEY)
}

function getCsrfToken(): string | null {
  return sessionStorage.getItem(CSRF_TOKEN_KEY)
}

function setCsrfToken(token: string): void {
  sessionStorage.setItem(CSRF_TOKEN_KEY, token)
}

export function clearParentSession(): void {
  sessionStorage.removeItem(CSRF_TOKEN_KEY)
}

/** Pull a pairing token out of the QR URL fragment (#t=…), then scrub it. */
export function adoptTokenFromUrl(): void {
  const match = window.location.hash.match(/[#&]t=([A-Za-z0-9_-]+)/)
  if (match) {
    setToken(match[1])
    history.replaceState(null, '', window.location.pathname)
  }
}

let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn
}

export class RpcError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds?: number,
    /** The refusal's own body, for the few routes that answer with something a
     * caller must act on rather than only report — a phone push refused as
     * stale carries the server's own timestamp back. Never rendered: callers
     * read the fields they know about, and remote error text is not one. */
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string }
}

export async function parentRequest<T>(path: string, init: RequestInit = {}, csrf = false): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  const credential = getParentCredential()
  if (credential === null) {
    if (csrf) {
      const token = getCsrfToken()
      if (token !== null) headers.set('x-osl-csrf-token', token)
    }
  } else {
    // A bearer request carries no ambient credential: no cookie is sent, so
    // there is nothing for a foreign page to forge and the CSRF token and the
    // origin check both stop applying. Sending either anyway would only
    // reintroduce the same-origin assumption this mode exists to escape.
    headers.set('Authorization', `Bearer ${credential}`)
  }
  const response = await fetch(apiUrl(path), { ...init, headers, credentials: credential === null ? 'same-origin' : 'omit' })
  if (response.status === 204) return undefined as T

  const body = (await response.json().catch(() => ({}))) as T | ApiErrorBody
  if (!response.ok) {
    const error = body as ApiErrorBody
    if (response.status === 401) {
      clearParentSession()
      // Revocation is meant to be final, so a refused credential is dropped
      // rather than retried — except on pairing itself, where a 401 means a
      // mistyped PIN and must not cost this device the credential it holds.
      const pairing = path === PARENT_DEVICES_PATH && init.method === 'POST'
      if (credential !== null && !pairing) clearParentCredential()
      onUnauthorized()
    }
    const retryAfter = response.headers.get('retry-after')
    throw new ApiError(
      response.status,
      error.error?.code ?? 'request_failed',
      error.error?.message ?? 'The request could not be completed',
      retryAfter === null ? undefined : Number(retryAfter),
      body
    )
  }
  return body as T
}

export function parentGet<T>(path: string): Promise<T> {
  return parentRequest<T>(path)
}

export function parentMutation<T>(path: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  return parentRequest<T>(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }, true)
}

/** Binary uploads use the same session/CSRF boundary but deliberately skip JSON encoding. */
export function parentUpload<T>(path: string, file: File): Promise<T> {
  return parentRequest<T>(path, { method: 'POST', headers: { 'Content-Type': file.type, 'x-osl-file-name': file.name }, body: file }, true)
}

export function getParentAuthStatus(): Promise<ParentAuthStatus> {
  return parentRequest<ParentAuthStatus>('/api/v1/auth/status')
}

/**
 * Ask a household this phone is *not* paired with whether it has been set up
 * yet. Scanning a screen hands over an address before there is any credential
 * to use against it, and the answer decides between "enter the PIN" and "this
 * household has never been claimed" — two situations with nothing in common
 * except that both look like a failed request if they are not told apart.
 *
 * Deliberately not `parentRequest`: there is nothing to authenticate with, and
 * a 401 here must not clear the credential this phone holds for some *other*
 * household it is still correctly paired to.
 */
export async function probeHousehold(address: string, signal?: AbortSignal): Promise<ParentAuthStatus> {
  const base = normalizeServerAddress(address)
  const response = await fetch(`${base}/api/v1/auth/status`, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    signal
  })
  if (!response.ok) {
    throw new ApiError(response.status, 'request_failed', 'That address answered, but not as an OpenSkyLight household')
  }
  return (await response.json()) as ParentAuthStatus
}

/**
 * Redeem a screen's enrolment code (ADR 0006). Parent-authenticated, so the
 * bearer credential or the browser session carries it.
 *
 * No credential comes back. The screen collects its own by polling, which is
 * the whole point of inverting the ceremony: nothing secret ever has to travel
 * from this phone to a device with no keyboard.
 */
export function enrolDisplay(code: string, name: string, signal?: AbortSignal): Promise<DisplayDevice> {
  return parentRequest<DisplayDevice>('/api/v1/displays/enrol', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name }),
    signal
  }, true)
}

async function submitPin(path: '/api/v1/auth/setup' | '/api/v1/auth/login', pin: string): Promise<ParentAuthStatus> {
  const result = await parentRequest<{ csrfToken: string; expiresAt: string }>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  })
  setCsrfToken(result.csrfToken)
  return { configured: true, authenticated: true, expiresAt: result.expiresAt }
}

export function setupParentPin(pin: string): Promise<ParentAuthStatus> {
  return submitPin('/api/v1/auth/setup', pin)
}

export function loginParent(pin: string): Promise<ParentAuthStatus> {
  return submitPin('/api/v1/auth/login', pin)
}

export async function logoutParent(): Promise<void> {
  try {
    await parentRequest<void>('/api/v1/auth/logout', { method: 'POST' }, true)
  } finally {
    clearParentSession()
  }
}

/** Pair this device as a parent phone using the household PIN, and keep the
 * credential it returns. The credential is deliberately not returned to the
 * caller: it is shown once by the server and never again by anything. */
export async function pairParentDevice(pin: string, name: string): Promise<ParentDeviceDto> {
  const request: PairParentDeviceRequest = { pin, name }
  const paired = await parentRequest<PairedParentDeviceDto>(PARENT_DEVICES_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  })
  setParentCredential(paired.credential)
  // Kept so this phone's own calendar source can be named after the phone the
  // parent already named, rather than asking them the same question twice.
  setPairedDeviceName(paired.name)
  const { credential: _credential, ...device } = paired
  return device
}

/** Claim a household nobody has set up yet (ADR 0006, case 1): the PIN given
 * here becomes the household PIN and this phone becomes its first parent phone,
 * in one request. Stores the credential exactly as pairing does. */
async function claimParentDevice(pin: string, name: string): Promise<ParentDeviceDto> {
  const request: ClaimHouseholdRequest = { pin, name }
  const claimed = await parentRequest<PairedParentDeviceDto>('/api/v1/household/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  })
  setParentCredential(claimed.credential)
  setPairedDeviceName(claimed.name)
  const { credential: _credential, ...device } = claimed
  return device
}

/** Set up a brand-new household from this phone and pair it, with the same
 * all-or-nothing unwind as `connectToHousehold`. A refused claim — most often a
 * household that turned out to be configured after all — leaves no address or
 * credential behind for the app to keep failing against. */
export async function claimHousehold(address: string, pin: string, name: string): Promise<ParentAuthStatus> {
  clearPhoneCalendarState()
  setApiBaseUrl(normalizeServerAddress(address))
  try {
    await claimParentDevice(pin, name)
    const status = await getParentAuthStatus()
    if (!status.authenticated) throw new ApiError(401, 'unauthorized', 'The household did not accept this phone')
    return status
  } catch (reason) {
    clearApiBaseUrl()
    clearParentCredential()
    clearParentSession()
    clearPhoneCalendarState()
    throw reason
  }
}

/** Point the app at a household server and pair it, as one step that either
 * fully succeeds or leaves nothing behind.
 *
 * The unwind is the whole point. A half-applied attempt — a base URL stored
 * against a server that refused the PIN, or an address with nothing listening
 * — leaves the app posting to somewhere it can never authenticate, with no
 * route back except reinstalling it. Keep the clears in the transport layer so
 * no future caller has to remember them. */
export async function connectToHousehold(address: string, pin: string, name: string): Promise<ParentAuthStatus> {
  // A phone re-paired against a different household must not carry the previous
  // one's calendar source id into it: that id names someone else's calendar.
  clearPhoneCalendarState()
  setApiBaseUrl(normalizeServerAddress(address))
  try {
    await pairParentDevice(pin, name)
    const status = await getParentAuthStatus()
    // A credential that does not authenticate is not a pairing. Treating this
    // as success would drop the parent into an app where every screen fails.
    if (!status.authenticated) throw new ApiError(401, 'unauthorized', 'The household did not accept this phone')
    return status
  } catch (reason) {
    clearApiBaseUrl()
    clearParentCredential()
    clearParentSession()
    clearPhoneCalendarState()
    throw reason
  }
}

/** Forget the household on this phone. Deliberately local: the paired record
 * stays on the server until a parent revokes it there, because a phone that
 * could delete its own record could also cover its tracks. */
export function disconnectFromHousehold(): void {
  clearParentCredential()
  clearApiBaseUrl()
  clearParentSession()
  // The phone's calendar source id belongs to the household it was created in,
  // and would name something else entirely in the next one.
  clearPhoneCalendarState()
}

export function listParentDevices(): Promise<{ parentDevices: ParentDeviceDto[] }> {
  return parentGet<{ parentDevices: ParentDeviceDto[] }>(PARENT_DEVICES_PATH)
}

export function revokeParentDevice(id: string): Promise<void> {
  return parentMutation<void>(`${PARENT_DEVICES_PATH}/${encodeURIComponent(id)}/revoke`, 'POST')
}

/** Same shape as the kiosk renderer's ipcInvoke, over HTTP. */
export async function rpc<K extends IpcChannel>(
  channel: K,
  req: IpcContract[K]['req']
): Promise<IpcContract[K]['res']> {
  const res = await fetch(apiUrl(`/api/rpc/${channel}`), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken() ?? ''}`,
      'Content-Type': 'application/json'
    },
    body: req === undefined ? '' : JSON.stringify(req)
  })
  if (res.status === 401) {
    clearToken()
    onUnauthorized()
    throw new RpcError('UNAUTHORIZED', 'Not paired')
  }
  const json = (await res.json()) as IpcResult<IpcContract[K]['res']>
  if (!json.ok) throw new RpcError(json.error.code, json.error.message)
  return json.data
}
