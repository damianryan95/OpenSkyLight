import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright-core'

const staticRoot = join(import.meta.dirname, '../out/companion')
let configured = false; let activeSession = false; let nextId = 1
const csrfToken = 'test-csrf-token'; const people = []; const accounts = []; const calendars = [{ id: 'family', name: 'Family calendar', color: '#527BC4', primary: true, readOnly: false, selected: false, audiencePersonId: null }]
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost'); const hasSession = activeSession && request.headers.cookie?.includes('osl_parent_session=test-session')
  if (url.pathname === '/api/v1/auth/status') return json(response, 200, { configured, authenticated: Boolean(hasSession), expiresAt: hasSession ? '2030-01-01T00:00:00.000Z' : null })
  if ((url.pathname === '/api/v1/auth/setup' || url.pathname === '/api/v1/auth/login') && request.method === 'POST') { configured = true; activeSession = true; response.setHeader('set-cookie', 'osl_parent_session=test-session; Path=/api/v1; HttpOnly; SameSite=Strict'); return json(response, url.pathname.endsWith('/setup') ? 201 : 200, { csrfToken, expiresAt: '2030-01-01T00:00:00.000Z' }) }
  if (!hasSession && url.pathname.startsWith('/api/v1/')) return json(response, 401, { error: { code: 'unauthorized', message: 'Parent session is required' } })
  if (url.pathname === '/api/v1/people' && request.method === 'GET') return json(response, 200, { people })
  if (url.pathname === '/api/v1/people' && request.method === 'POST') { const body = JSON.parse(await readBody(request)); const person = { id: `person-${nextId++}`, ...body, sortOrder: people.length, avatarUrl: null, themeId: body.themeId ?? null, celebrationAssetId: null, celebrationEnabled: body.celebrationEnabled ?? true, celebrationDurationMs: body.celebrationDurationMs ?? 3000 }; people.push(person); return json(response, 201, person) }
  const personMatch = /^\/api\/v1\/people\/([^/]+)$/.exec(url.pathname)
  if (personMatch && request.method === 'PATCH') { const body = JSON.parse(await readBody(request)); const person = people.find((candidate) => candidate.id === personMatch[1]); if (!person) return json(response, 404, { error: { code: 'not_found', message: 'Person not found' } }); Object.assign(person, body); return json(response, 200, person) }
  if (url.pathname === '/api/v1/google/configuration' && request.method === 'GET') return json(response, 200, { configured: true, unlocked: true, redirectUri: 'http://server.test/api/v1/google/callback' })
  if (url.pathname === '/api/v1/google/accounts' && request.method === 'GET') return json(response, 200, { accounts })
  if (url.pathname === '/api/v1/google/connect' && request.method === 'POST') return json(response, 201, { authorizationUrl: '/google-consent' })
  if (url.pathname === '/google-consent') return response.writeHead(200, { 'content-type': 'text/html' }).end('<a href="/api/v1/google/callback?state=test&code=test">Continue Google consent</a>')
  if (url.pathname === '/api/v1/google/callback') { accounts.splice(0, accounts.length, { id: 'account-1', email: 'parent@example.test', state: 'connected', error: null, connectedAt: '2030-01-01T00:00:00.000Z' }); return response.writeHead(302, { location: '/' }).end() }
  if (url.pathname === '/api/v1/google/accounts/account-1/calendars' && request.method === 'GET') return json(response, 200, { calendars })
  if (url.pathname === '/api/v1/google/accounts/account-1/calendars' && request.method === 'PUT') { const body = JSON.parse(await readBody(request)); Object.assign(calendars[0], { selected: body.selected, audiencePersonId: body.audiencePersonId }); return response.writeHead(204).end() }
  const staticPath = url.pathname.startsWith('/admin/') ? url.pathname.slice('/admin'.length) : url.pathname
  const requested = staticPath === '/' ? 'index.html' : normalize(staticPath).replace(/^\/+/, ''); if (requested.includes('..')) return response.writeHead(403).end()
  try { const content = await readFile(join(staticRoot, requested)); response.setHeader('content-type', mime(requested)); response.writeHead(200).end(content) } catch { response.writeHead(404).end() }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); const baseUrl = `http://127.0.0.1:${address.port}`; const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); await page.goto(baseUrl)
  await page.getByLabel('Household PIN').fill('1234'); await page.getByRole('button', { name: 'Create PIN and continue' }).click()
  await page.getByRole('button', { name: 'Household', exact: true }).click(); await page.getByRole('button', { name: 'Add a person' }).click(); await page.getByLabel('Name').fill('Alex'); await page.getByRole('button', { name: 'Add person' }).click(); await page.getByText('Child — included by exact-name matching').waitFor()
  await page.getByRole('button', { name: 'Personalize' }).click(); await page.getByRole('button', { name: /Frozen/ }).click(); await page.getByRole('button', { name: 'Save theme' }).click(); await page.getByText('Choose a dashboard theme').waitFor({ state: 'detached' })
  if (people[0].themeId !== 'frozen') throw new Error('person theme was not saved')
  await page.getByRole('button', { name: 'Calendar', exact: true }).click(); await page.getByRole('button', { name: 'Connect Google Calendar' }).click(); await page.getByRole('link', { name: 'Continue Google consent' }).click(); await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  await page.getByRole('button', { name: 'Choose calendars' }).click(); await page.getByLabel('Include Family calendar').check(); await page.getByLabel('Audience for Family calendar').selectOption({ label: 'Alex' }); await page.getByRole('button', { name: 'Save calendar' }).click()
  if (!calendars[0].selected || calendars[0].audiencePersonId !== people[0].id) throw new Error('calendar mapping was not saved')
  if (await page.getByText(/event editor/i).count()) throw new Error('event editor leaked into phone admin')
  console.log('PHONE PEOPLE/CALENDARS E2E PASS: person role, mocked Google consent, Family/person mapping')
} finally { await browser.close(); await new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))) }
function json(response, status, body) { response.setHeader('content-type', 'application/json'); response.writeHead(status).end(JSON.stringify(body)) }
function readBody(request) { return new Promise((resolve, reject) => { let body = ''; request.setEncoding('utf8'); request.on('data', (chunk) => { body += chunk }); request.on('end', () => resolve(body)); request.on('error', reject) }) }
function mime(path) { return { '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[extname(path)] ?? 'text/html' }
