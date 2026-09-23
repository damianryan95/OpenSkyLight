import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright-core'

/**
 * The installed app's pairing flow, driven against the real `out/app` bundle.
 *
 * The one thing this cannot be is an Android device. What it can do is put the
 * bundle in the state the native shell puts it in — `window.androidBridge` is
 * exactly what Capacitor's own `isNativePlatform()` looks for — and then drive
 * the flow a parent drives: a wrong PIN, a pasted `/admin/` address, a
 * revocation from another phone, and the way back out. Every one of those has
 * a stored-state consequence that is invisible on screen and fatal in a
 * kitchen, so each is asserted against localStorage as well as the DOM.
 */

const root = join(import.meta.dirname, '../out/app')
const CREDENTIAL = 'a-parent-credential-that-must-never-be-rendered'
const PIN = '4321'
let revoked = false
const paired = []
const displays = []
const parentDevices = []

const json = (response, status, body) => { response.setHeader('content-type', 'application/json'); response.writeHead(status).end(JSON.stringify(body)) }
const body = async (request) => { let value = ''; for await (const chunk of request) value += chunk; return value ? JSON.parse(value) : {} }

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1]
  const authenticated = bearer === CREDENTIAL && !revoked

  if (url.pathname === '/api/v1/parent-devices' && request.method === 'POST') {
    // The server insists on this for a reason recorded in N17; the app must keep sending it.
    if (!(request.headers['content-type'] ?? '').includes('application/json')) return json(response, 415, { error: { code: 'unsupported_media_type', message: 'JSON is required' } })
    const input = await body(request)
    if (input.pin !== PIN) return json(response, 401, { error: { code: 'unauthorized', message: 'That PIN was not recognised' } })
    revoked = false
    const device = { id: `phone-${paired.length + 1}`, name: input.name, pairedAt: '2030-01-01T00:00:00.000Z', lastSeenAt: null, revokedAt: null }
    paired.push(device); parentDevices.push(device)
    return json(response, 201, { ...device, credential: CREDENTIAL })
  }
  // A revoked app is told so with a 200, deliberately, so it can offer to pair again.
  if (url.pathname === '/api/v1/auth/status') return json(response, 200, { configured: true, authenticated, expiresAt: null })
  if (!authenticated && url.pathname.startsWith('/api/v1/')) return json(response, 401, { error: { code: 'unauthorized', message: 'Parent session is required' } })
  if (url.pathname === '/api/v1/household/settings') return json(response, 200, { timezone: 'Australia/Perth', weather: null })
  if (url.pathname === '/api/v1/displays') return json(response, 200, { displays })
  if (url.pathname === '/api/v1/sync/status') return json(response, 200, { state: 'fresh', lastSyncedAt: '2030-01-01T00:00:00.000Z', lastSucceededAt: '2030-01-01T00:00:00.000Z', calendars: [] })
  if (url.pathname === '/api/v1/parent-devices' && request.method === 'GET') return json(response, 200, { parentDevices })

  const file = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^[\\/]+/, '')
  if (file.includes('..')) return response.writeHead(403).end()
  try {
    const content = await readFile(join(root, file))
    response.setHeader('content-type', { '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' }[extname(file)] ?? 'text/html')
    response.writeHead(200).end(content)
  } catch { response.writeHead(404).end() }
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
const origin = `http://127.0.0.1:${port}`
const browser = await chromium.launch({ headless: true })
const stored = (page) => page.evaluate(() => ({ base: localStorage.getItem('osl.apiBaseUrl'), credential: localStorage.getItem('osl.parentCredential') }))

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  // What Capacitor itself reads to decide it is on a device.
  await page.addInitScript(() => { window.androidBridge = { postMessage: () => {} } })
  await page.goto(origin)

  await page.getByRole('heading', { name: 'Connect this phone' }).waitFor()
  if (await page.getByLabel('Household PIN').count() !== 1) throw new Error('the app offered the browser PIN screen instead of pairing')

  // A wrong PIN must name the PIN, and must leave nothing stored.
  await page.getByLabel('Household server address').fill(`${origin}/admin/`)
  await page.getByLabel('A name for this phone').fill('Dad phone')
  await page.getByLabel('Household PIN').fill('0000')
  await page.getByRole('button', { name: 'Connect this phone' }).click()
  const refusal = await page.getByRole('alert').textContent()
  if (!/PIN/.test(refusal)) throw new Error(`a wrong PIN produced an error that does not mention the PIN: ${refusal}`)
  const afterRefusal = await stored(page)
  if (afterRefusal.base !== null || afterRefusal.credential !== null) throw new Error('a refused pairing left an address or a credential behind')
  if (await page.getByLabel('A name for this phone').inputValue() !== 'Dad phone') throw new Error('a failed pairing erased what the parent had already typed')

  // The pasted address must be normalised rather than rejected.
  await page.getByLabel('Household PIN').fill(PIN)
  await page.getByRole('button', { name: 'Connect this phone' }).click()
  await page.getByRole('heading', { level: 1, name: 'Home' }).waitFor()
  const afterPairing = await stored(page)
  if (afterPairing.base !== origin) throw new Error(`a pasted /admin/ address was stored as ${afterPairing.base}`)
  if (afterPairing.credential !== CREDENTIAL) throw new Error('the app did not keep the credential it was issued')
  if (paired.length !== 1 || paired[0].name !== 'Dad phone') throw new Error('the phone was not paired under the name the parent gave it')

  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('the app overflows a 390px phone viewport')

  // Revoked from another phone: a 200 saying "not authenticated" must land back on pairing.
  revoked = true
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.getByRole('heading', { name: 'Connect this phone' }).waitFor()
  if (await page.getByLabel('Household server address').inputValue() !== origin) throw new Error('a revoked app forgot the address it was using, so the parent must retype it')

  // And back in, then out again under the parent's own hand.
  await page.getByLabel('Household PIN').fill(PIN)
  await page.getByRole('button', { name: 'Connect this phone' }).click()
  await page.getByRole('heading', { level: 1, name: 'Home' }).waitFor()
  await page.getByRole('button', { name: 'Displays', exact: true }).click()
  await page.getByRole('button', { name: 'Unpair this phone' }).click()
  await page.getByRole('button', { name: 'Unpair phone' }).click()
  await page.getByRole('heading', { name: 'Connect this phone' }).waitFor()
  const afterUnpair = await stored(page)
  if (afterUnpair.base !== null || afterUnpair.credential !== null) throw new Error('unpairing left an address or a credential behind')
  if ((await page.content()).includes(CREDENTIAL)) throw new Error('the parent credential was rendered into the app UI')

  console.log('APP PAIRING E2E PASS: address normalised, failures unwound, revocation and unpairing both recoverable')
} finally {
  await browser.close()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
