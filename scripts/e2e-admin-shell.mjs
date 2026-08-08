import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright-core'

const staticRoot = join(import.meta.dirname, '../out/companion')
let configured = false
let activeSession = false
const csrfToken = 'test-csrf-token'

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const hasSession = activeSession && request.headers.cookie?.includes('osl_parent_session=test-session')

  if (url.pathname === '/api/v1/auth/status') return json(response, 200, { configured, authenticated: Boolean(hasSession), expiresAt: hasSession ? '2030-01-01T00:00:00.000Z' : null })
  if ((url.pathname === '/api/v1/auth/setup' || url.pathname === '/api/v1/auth/login') && request.method === 'POST') {
    const body = JSON.parse(await readBody(request))
    if (!/^\d{4,64}$/.test(body.pin)) return json(response, 401, { error: { code: 'unauthorized', message: 'Invalid household PIN' } })
    if (url.pathname.endsWith('/setup')) configured = true
    if (url.pathname.endsWith('/login') && !configured) return json(response, 409, { error: { code: 'conflict', message: 'Household PIN has not been configured' } })
    activeSession = true
    response.setHeader('set-cookie', 'osl_parent_session=test-session; Path=/api/v1; HttpOnly; SameSite=Strict')
    return json(response, url.pathname.endsWith('/setup') ? 201 : 200, { csrfToken, expiresAt: '2030-01-01T00:00:00.000Z' })
  }
  if (url.pathname === '/api/v1/auth/logout' && request.method === 'POST') {
    if (!hasSession || request.headers['x-osl-csrf-token'] !== csrfToken) return json(response, 401, { error: { code: 'unauthorized', message: 'Parent session is required' } })
    activeSession = false
    response.setHeader('set-cookie', 'osl_parent_session=; Path=/api/v1; Max-Age=0')
    response.writeHead(204).end()
    return
  }

  const requested = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^\/+/, '')
  if (requested.includes('..')) return response.writeHead(403).end()
  try {
    const content = await readFile(join(staticRoot, requested))
    response.setHeader('content-type', mimeType(requested))
    response.writeHead(200).end(content)
  } catch {
    response.writeHead(404).end()
  }
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const baseUrl = `http://127.0.0.1:${address.port}`
const browser = await chromium.launch({ headless: true })

try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
    configured = false
    activeSession = false
    const page = await browser.newPage({ viewport })
    await page.goto(baseUrl)
    await page.getByRole('heading', { name: 'Set your household PIN' }).waitFor()
    await page.getByLabel('Household PIN').fill('1234')
    await page.getByRole('button', { name: 'Create PIN and continue' }).click()
    await page.locator('h1').filter({ hasText: 'Home' }).waitFor()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.getByRole('heading', { name: 'Parent sign in' }).waitFor()
    await page.getByLabel('Household PIN').fill('9999')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.locator('h1').filter({ hasText: 'Home' }).waitFor()
    activeSession = false // emulate server-side expiry/revocation
    await page.reload()
    await page.getByRole('heading', { name: 'Parent sign in' }).waitFor()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    if (overflow) throw new Error(`admin shell overflows ${viewport.width}px viewport`)
    await page.close()
  }
  console.log('ADMIN SHELL E2E PASS: setup, login, logout, expiry and two phone viewports')
} finally {
  await browser.close()
  await new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)))
}

function json(response, status, body) {
  response.setHeader('content-type', 'application/json')
  response.writeHead(status).end(JSON.stringify(body))
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

function mimeType(path) {
  return { '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[extname(path)] ?? 'text/html'
}
