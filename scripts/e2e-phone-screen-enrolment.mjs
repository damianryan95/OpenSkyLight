import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright-core'

/**
 * Adding a screen by reading the code it is showing (ADR 0006), driven against
 * the real `out/app` bundle at a phone viewport.
 *
 * What this cannot be is a camera. Playwright has no way to put a QR code in
 * front of a lens, and the Capacitor plugin is native code that does not exist
 * in a desktop Chromium. So the camera is deliberately absent here, which
 * exercises the thing that matters most on a bad evening: a refused or broken
 * camera has to become manual entry, not a dead end. Everything downstream of
 * the payload — the three household cases, pairing, redemption, an expired
 * code — is the same code either way, and all of it is driven.
 *
 * The payload parsing that the camera would feed is covered by
 * `tests/unit/screenEnrolment.test.ts`.
 */

const appRoot = join(import.meta.dirname, '../out/app')
const browserRoot = join(import.meta.dirname, '../out/companion')
const CREDENTIAL = 'a-parent-credential-that-must-never-be-rendered'
const PIN = '4321'
const GOOD_CODE = 'K7M2QX4A'
const CSRF = 'test-csrf-token'
let configured = false
let sequence = 1
// Phase two serves the browser bundle instead, to prove the same ceremony
// still works for a household that installed nothing at all.
let root = appRoot
let cookieSession = false
const displays = []
const parentDevices = []
const enrolAttempts = []

const json = (response, status, body) => { response.setHeader('content-type', 'application/json'); response.writeHead(status).end(JSON.stringify(body)) }
const body = async (request) => { let value = ''; for await (const chunk of request) value += chunk; return value ? JSON.parse(value) : {} }

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1]
  const cookie = cookieSession && request.headers.cookie?.includes('osl_parent_session=test-session')
  const authenticated = bearer === CREDENTIAL || Boolean(cookie)

  if (url.pathname === '/api/v1/auth/status') return json(response, 200, { configured, authenticated, expiresAt: null })
  if (url.pathname === '/api/v1/auth/login' && request.method === 'POST') {
    const input = await body(request)
    if (input.pin !== PIN) return json(response, 401, { error: { code: 'unauthorized', message: 'Invalid household PIN' } })
    cookieSession = true
    response.setHeader('set-cookie', 'osl_parent_session=test-session; Path=/api/v1')
    return json(response, 200, { csrfToken: CSRF, expiresAt: '2030-01-01T00:00:00.000Z' })
  }
  if (url.pathname === '/api/v1/parent-devices' && request.method === 'POST') {
    const input = await body(request)
    if (input.pin !== PIN) return json(response, 401, { error: { code: 'unauthorized', message: 'That PIN was not recognised' } })
    const device = { id: `phone-${parentDevices.length + 1}`, name: input.name, pairedAt: '2030-01-01T00:00:00.000Z', lastSeenAt: null, revokedAt: null }
    parentDevices.push(device)
    return json(response, 201, { ...device, credential: CREDENTIAL })
  }
  if (!authenticated && url.pathname.startsWith('/api/v1/')) return json(response, 401, { error: { code: 'unauthorized', message: 'Parent session is required' } })

  if (url.pathname === '/api/v1/displays/enrol' && request.method === 'POST') {
    // The browser path is still same-origin with a CSRF token; the bearer path
    // needs neither. Both must reach this route as they always did.
    if (cookie && request.headers['x-osl-csrf-token'] !== CSRF) return json(response, 403, { error: { code: 'forbidden', message: 'CSRF token missing' } })
    if (!(request.headers['content-type'] ?? '').includes('application/json')) return json(response, 415, { error: { code: 'unsupported_media_type', message: 'JSON is required' } })
    const input = await body(request)
    enrolAttempts.push(input)
    // A wrong, expired or already-spent code is refused identically.
    if (input.code !== GOOD_CODE) return json(response, 404, { error: { code: 'not_found', message: 'Enrolment code could not be redeemed' } })
    const display = { id: `display-${sequence++}`, name: input.name, homeLayout: null, themePreference: null, sleepSettings: null, kioskPreferences: null, registeredAt: '2030-01-01T00:00:00.000Z', lastSeenAt: null, revokedAt: null }
    displays.push(display)
    return json(response, 201, display)
  }
  if (url.pathname === '/api/v1/displays' && request.method === 'GET') return json(response, 200, { displays })
  if (url.pathname === '/api/v1/displays' && request.method === 'POST') {
    const input = await body(request)
    const display = { id: `display-${sequence++}`, name: input.name, homeLayout: null, themePreference: null, sleepSettings: null, kioskPreferences: null, registeredAt: '2030-01-01T00:00:00.000Z', lastSeenAt: null, revokedAt: null }
    displays.push(display)
    return json(response, 201, { ...display, credential: 'a-display-credential' })
  }
  if (url.pathname === '/api/v1/parent-devices' && request.method === 'GET') return json(response, 200, { parentDevices })
  if (url.pathname === '/api/v1/household/settings') return json(response, 200, { timezone: 'Australia/Perth', weather: null })
  if (url.pathname === '/api/v1/sync/status') return json(response, 200, { state: 'fresh', lastSyncedAt: null, lastSucceededAt: null, calendars: [] })

  // The browser bundle builds with base '/admin/', so its assets ask for that
  // prefix even when the SPA itself is opened at the root.
  const requested = url.pathname.replace(/^\/admin(\/|$)/, '/')
  const file = requested === '/' ? 'index.html' : normalize(requested).replace(/^[\\/]+/, '')
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
const noOverflow = async (page, where) => {
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error(`${where} overflows a 390px phone viewport`)
}

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.addInitScript(() => { window.androidBridge = { postMessage: () => {} } })
  await page.goto(origin)

  // ---- Case 1: the household has no PIN at all. Say so; do not pretend.
  await page.getByRole('heading', { name: 'Connect this phone' }).waitFor()
  await page.getByRole('button', { name: 'Scan a screen instead' }).click()
  await page.getByRole('heading', { name: 'Add a screen' }).waitFor()
  // No camera exists in this browser, so the scanner must fail into manual
  // entry rather than leaving the parent staring at a broken button.
  await page.getByRole('button', { name: 'Scan the screen’s code' }).click()
  await page.getByLabel('Code from the screen').waitFor()
  const cameraRefusal = await page.getByRole('alert').textContent()
  if (!/camera/i.test(cameraRefusal)) throw new Error(`a broken camera did not explain itself: ${cameraRefusal}`)
  await noOverflow(page, 'manual code entry')

  await page.getByLabel('Household server address').fill(origin)
  await page.getByLabel('Code from the screen').fill(GOOD_CODE)
  await page.getByRole('button', { name: 'Continue' }).click()
  const unclaimed = await page.getByText('has not been set up yet').textContent()
  if (!unclaimed.includes(`${origin}/admin/`)) throw new Error('an unclaimed household did not say where to go and set it up')
  if (enrolAttempts.length !== 0) throw new Error('an unclaimed household had a code redeemed against it anyway')
  await page.getByRole('button', { name: 'Close' }).click()

  // ---- Case 3: the household has a PIN, this phone has not joined it.
  configured = true
  await page.getByRole('button', { name: 'Scan a screen instead' }).click()
  await page.getByRole('button', { name: 'Type the code instead' }).click()
  await page.getByLabel('Household server address').fill(origin)
  await page.getByLabel('Code from the screen').fill('k7m2 qx4a')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Household PIN').waitFor()

  // A wrong PIN must name the PIN, and must not cost the parent what they typed.
  await page.getByLabel('Name for this screen').fill('Kitchen wall')
  await page.getByLabel('A name for this phone').fill('Mum phone')
  await page.getByLabel('Household PIN').fill('0000')
  await page.getByRole('button', { name: 'Connect and add the screen' }).click()
  const pinRefusal = await page.getByRole('alert').textContent()
  if (!/PIN/.test(pinRefusal)) throw new Error(`a wrong PIN produced an error that does not mention the PIN: ${pinRefusal}`)
  if (await page.getByLabel('Name for this screen').inputValue() !== 'Kitchen wall') throw new Error('a refused PIN erased the screen name the parent had typed')
  if (await page.evaluate(() => localStorage.getItem('osl.apiBaseUrl')) !== null) throw new Error('a refused pairing left an address behind')

  await page.getByLabel('Household PIN').fill(PIN)
  await page.getByRole('button', { name: 'Connect and add the screen' }).click()
  await page.getByText('Kitchen wall has joined the household').waitFor()
  if (parentDevices.length !== 1 || parentDevices[0].name !== 'Mum phone') throw new Error('the scan did not pair the phone under the name the parent gave it')
  if (displays.length !== 1 || displays[0].name !== 'Kitchen wall') throw new Error('the code did not register the screen')
  // A hand-typed code with a space in it must reach the server normalised.
  if (enrolAttempts.at(-1).code !== GOOD_CODE) throw new Error(`a typed code reached the server as ${enrolAttempts.at(-1).code}`)
  await noOverflow(page, 'the pair-and-enrol step')
  await page.getByRole('button', { name: 'Done' }).click()

  // ---- Case 2: the same phone, now paired, adds a second screen. No wizard,
  // no address, no PIN — just a name.
  await page.getByRole('heading', { level: 1, name: 'Home' }).waitFor()
  await page.getByRole('button', { name: 'Displays', exact: true }).click()
  await page.getByRole('button', { name: 'Add a screen' }).click()
  await page.getByRole('button', { name: 'Type the code instead' }).click()
  await page.getByLabel('Code from the screen').waitFor()
  if (await page.getByLabel('Household server address').count() !== 0) throw new Error('a paired phone was asked for the server address it already has')
  await page.getByLabel('Code from the screen').fill('WRONGCOD')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Name for this screen').fill('Hallway')
  if (await page.getByLabel('Household PIN').count() !== 0) throw new Error('a paired phone was re-asked for the household PIN')
  await page.getByRole('button', { name: 'Add this screen' }).click()

  // An expired or wrong code must send them back to the screen, keeping the name.
  const codeRefusal = await page.getByRole('alert').textContent()
  if (!/expired/.test(codeRefusal) || !/screen/.test(codeRefusal)) throw new Error(`a refused code did not say what to do next: ${codeRefusal}`)
  if (await page.getByLabel('Name for this screen').inputValue() !== 'Hallway') throw new Error('a refused code erased the screen name')
  if (displays.length !== 1) throw new Error('a refused code registered a screen anyway')

  await page.getByRole('button', { name: 'Type the new code' }).click()
  await page.getByLabel('Code from the screen').fill(GOOD_CODE)
  await page.getByRole('button', { name: 'Continue' }).click()
  if (await page.getByLabel('Name for this screen').inputValue() !== 'Hallway') throw new Error('re-reading the code lost the name already typed')
  await page.getByRole('button', { name: 'Add this screen' }).click()
  await page.getByText('Hallway has joined the household').waitFor()
  if (displays.length !== 2 || displays[1].name !== 'Hallway') throw new Error('the second screen was not added')
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Add a screen' }).waitFor()

  // The enrolment code is a short-lived secret: it must not outlive the flow.
  const leaked = await page.evaluate((code) => Object.keys(localStorage).some((key) => (localStorage.getItem(key) ?? '').includes(code)), GOOD_CODE)
  if (leaked) throw new Error('an enrolment code was persisted into local storage')
  if ((await page.content()).includes(CREDENTIAL)) throw new Error('the parent credential was rendered into the app UI')
  await noOverflow(page, 'the displays list')
  await page.close()

  // ---- The household that installed nothing. The QR is a URL, so a parent
  // pointing their phone's ordinary camera at the screen lands on `/admin/`
  // with the code in the fragment and no app in sight.
  root = browserRoot
  const browserPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await browserPage.goto(`${origin}/admin/#enrol=${GOOD_CODE}`)
  await browserPage.getByRole('heading', { name: 'Parent sign in' }).waitFor()
  if (browserPage.url().includes(GOOD_CODE)) throw new Error('the enrolment code was left sitting in the address bar')
  await browserPage.getByLabel('Household PIN').fill(PIN)
  await browserPage.getByRole('button', { name: 'Sign in' }).click()

  // Straight to naming the screen: the parent has already done the reading.
  await browserPage.getByLabel('Name for this screen').waitFor()
  await browserPage.getByLabel('Name for this screen').fill('Playroom')
  await browserPage.getByRole('button', { name: 'Add this screen' }).click()
  await browserPage.getByText('Playroom has joined the household').waitFor()
  if (enrolAttempts.at(-1).code !== GOOD_CODE || displays.at(-1).name !== 'Playroom') throw new Error('a code carried in the address bar did not redeem in the browser')
  await browserPage.getByRole('button', { name: 'Done' }).click()

  // And the old ceremony still exists for a screen that does have a keyboard.
  await browserPage.getByRole('button', { name: 'Register display' }).click()
  await browserPage.getByLabel('Display name').fill('Study')
  await browserPage.getByRole('button', { name: 'Register', exact: true }).click()
  await browserPage.getByRole('button', { name: 'Copy enrollment link' }).waitFor()
  await browserPage.getByRole('button', { name: 'Done' }).click()
  await noOverflow(browserPage, 'the browser displays page')

  // A reload must not replay the code, nor reopen the flow: the fragment was
  // scrubbed, the code was spent, and the parent is back to ordinary admin.
  const before = enrolAttempts.length
  await browserPage.reload()
  await browserPage.locator('h1').filter({ hasText: 'Home' }).waitFor()
  await browserPage.getByRole('button', { name: 'Displays', exact: true }).click()
  await browserPage.getByRole('button', { name: 'Add a screen' }).waitFor()
  if (await browserPage.getByLabel('Name for this screen').count() !== 0) throw new Error('a reload reopened the enrolment flow with a code that was already spent')
  if (enrolAttempts.length !== before) throw new Error('a reload replayed an enrolment code that had already been spent')

  console.log('SCREEN ENROLMENT E2E PASS: all three household cases, manual fallback, expired-code recovery, the browser fragment path, nothing persisted')
} finally {
  await browser.close()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
