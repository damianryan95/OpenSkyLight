import type { IpcChannel, IpcContract, IpcResult } from '@shared/ipc/contract'

const TOKEN_KEY = 'osl.companionToken'
const CSRF_TOKEN_KEY = 'osl.parentCsrfToken'

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
  if (csrf) {
    const token = getCsrfToken()
    if (token !== null) headers.set('x-osl-csrf-token', token)
  }
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  if (response.status === 204) return undefined as T

  const body = (await response.json().catch(() => ({}))) as T | ApiErrorBody
  if (!response.ok) {
    const error = body as ApiErrorBody
    if (response.status === 401) {
      clearParentSession()
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

/** Same shape as the kiosk renderer's ipcInvoke, over HTTP. */
export async function rpc<K extends IpcChannel>(
  channel: K,
  req: IpcContract[K]['req']
): Promise<IpcContract[K]['res']> {
  const res = await fetch(`/api/rpc/${channel}`, {
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
