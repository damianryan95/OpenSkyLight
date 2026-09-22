import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright-core'

const root = join(import.meta.dirname, '../out/companion')
let configured = false; let session = false; let sequence = 1
const displays = []
const parentDevices = [
  { id: 'phone-1', name: 'Mum phone', pairedAt: '2030-01-01T00:00:00.000Z', lastSeenAt: '2030-01-03T00:00:00.000Z', revokedAt: null },
  { id: 'phone-2', name: 'Dad phone', pairedAt: '2030-01-01T00:00:00.000Z', lastSeenAt: null, revokedAt: null }
]
const json = (response, status, body) => { response.setHeader('content-type', 'application/json'); response.writeHead(status).end(JSON.stringify(body)) }
const body = async (request) => { let value = ''; for await (const chunk of request) value += chunk; return value ? JSON.parse(value) : {} }
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost'); const parent = session && request.headers.cookie?.includes('osl_parent_session=test')
  if (url.pathname === '/api/v1/auth/status') return json(response, 200, { configured, authenticated: parent, expiresAt: null })
  if (url.pathname === '/api/v1/auth/setup' && request.method === 'POST') { configured = session = true; response.setHeader('set-cookie', 'osl_parent_session=test; Path=/api/v1'); return json(response, 201, { csrfToken: 'csrf', expiresAt: '2030-01-01T00:00:00.000Z' }) }
  if (!parent && url.pathname.startsWith('/api/v1/')) return json(response, 401, { error: { code: 'unauthorized', message: 'Parent session is required' } })
  if (url.pathname === '/api/v1/sync/status') return json(response, 200, { state: 'stale', lastSyncedAt: '2030-01-01T00:00:00.000Z', lastSucceededAt: '2030-01-01T00:00:00.000Z', calendars: [{ id: 'family', name: 'Family', lastAttemptAt: null, lastSucceededAt: '2030-01-01T00:00:00.000Z', error: 'Google calendar sync failed. Cached events are still available.' }] })
  if (url.pathname === '/api/v1/displays' && request.method === 'GET') return json(response, 200, { displays })
  if (url.pathname === '/api/v1/displays' && request.method === 'POST') { const input = await body(request); const display = { id: `display-${sequence++}`, name: input.name, homeLayout: null, themePreference: null, sleepSettings: null, kioskPreferences: null, registeredAt: '2030-01-01T00:00:00.000Z', lastSeenAt: null, revokedAt: null }; displays.push(display); return json(response, 201, { ...display, credential: 'must-not-appear-in-the-phone-ui' }) }
  if (url.pathname === '/api/v1/parent-devices' && request.method === 'GET') return json(response, 200, { parentDevices })
  const phoneRevoke = /^\/api\/v1\/parent-devices\/([^/]+)\/revoke$/.exec(url.pathname)
  if (phoneRevoke && request.method === 'POST') { const phone = parentDevices.find((value) => value.id === phoneRevoke[1]); phone.revokedAt = '2030-01-04T00:00:00.000Z'; return response.writeHead(204).end() }
  const target = /^\/api\/v1\/displays\/([^/]+)(?:\/(revoke))?$/.exec(url.pathname)
  if (target && target[2] === 'revoke' && request.method === 'POST') { const display = displays.find((value) => value.id === target[1]); display.revokedAt = '2030-01-02T00:00:00.000Z'; return response.writeHead(204).end() }
  if (target && request.method === 'PATCH') { const input = await body(request); const display = displays.find((value) => value.id === target[1]); Object.assign(display, input); return json(response, 200, display) }
  // The companion builds with base '/admin/', so its assets ask for that prefix even when the SPA itself is opened at the root.
  const requested = url.pathname.replace(/^\/admin(\/|$)/, '/')
  const file = requested === '/' ? 'index.html' : normalize(requested).replace(/^[\\/]+/, ''); if (file.includes('..')) return response.writeHead(403).end()
  try { const content = await readFile(join(root, file)); response.setHeader('content-type', { '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' }[extname(file)] ?? 'text/html'); response.writeHead(200).end(content) } catch { response.writeHead(404).end() }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); await page.goto(`http://127.0.0.1:${address.port}`)
  await page.getByLabel('Household PIN').fill('1234'); await page.getByRole('button', { name: 'Create PIN and continue' }).click(); await page.getByRole('button', { name: 'Displays', exact: true }).click()
  // Registration ends on the one-time enrollment link, so dismiss it before registering the next screen.
  for (const name of ['Kitchen', 'Bedroom']) { await page.getByRole('button', { name: 'Register display' }).click(); await page.getByLabel('Display name').fill(name); await page.getByRole('button', { name: 'Register', exact: true }).click(); await page.getByRole('button', { name: 'Done' }).click() }
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click(); await page.getByLabel('Theme for Kitchen').selectOption('dark'); await page.getByLabel('Enable sleep for Kitchen').check(); await page.getByLabel('Sleep start for Kitchen').fill('21:00'); await page.getByRole('button', { name: 'Save display settings' }).click()
  await page.getByRole('button', { name: 'Revoke this display' }).first().click(); await page.getByRole('button', { name: 'Revoke display' }).click()
  if (displays[0].revokedAt === null || displays[1].revokedAt !== null || displays[0].themePreference !== 'dark') throw new Error('display changes were not isolated to the selected screen')
  await page.getByRole('button', { name: 'Revoke this phone' }).first().click(); await page.getByRole('button', { name: 'Revoke phone' }).click()
  await page.getByRole('button', { name: 'Revoke phone' }).waitFor({ state: 'detached' })
  if (parentDevices[0].revokedAt === null || parentDevices[1].revokedAt !== null) throw new Error('a lost parent phone could not be revoked from the browser')
  if (await page.getByRole('button', { name: /pair/i }).count() !== 0) throw new Error('parent administration offered to mint a phone credential; pairing belongs to the app')
  // Scoped to the list view on purpose: the one-time reveal card legitimately shows the credential once, and has been dismissed by now.
  if ((await page.content()).includes('must-not-appear-in-the-phone-ui')) throw new Error('a device credential appeared in the phone UI after its one-time reveal')
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('display admin overflows a 390px phone viewport')
  console.log('PHONE DISPLAYS E2E PASS: independent settings/revocation and redacted diagnostics')
} finally { await browser.close(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
