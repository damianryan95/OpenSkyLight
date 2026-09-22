import type { PairedParentDeviceDto, ParentDeviceDto, PairParentDeviceRequest } from '@shared/api/contract'
import type { IpcChannel, IpcContract, IpcResult } from '@shared/ipc/contract'

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
    public readonly retryAfterSeconds?: number
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
      retryAfter === null ? undefined : Number(retryAfter)
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
  const { credential: _credential, ...device } = paired
  return device
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
