import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createHeadlessServer } from '../out/server/server.js'
import { openServerDatabase } from '../out/server/db/index.js'
import { HouseholdAuthService } from '../out/server/auth/index.js'
import { createHouseholdSettingsService } from '../out/server/domain/settings.js'

/**
 * The screen half of the ADR 0006 ceremony, driven end to end against the real
 * server: a genuinely unregistered kiosk mints a code, shows a QR and a typed
 * fallback, and is adopted by a parent credential redeeming that code — with no
 * keyboard on the screen and no credential ever typed into it.
 *
 * What this cannot do is hold a phone up to a panel. The QR is asserted as a
 * rendered image; that the image encodes the payload is covered by the unit
 * test over `enrolmentQrPayload` and by reading the code out of the DOM, which
 * is the same code the QR is generated from.
 */

const PIN = '135790'
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 2400, height: 900 }
]
const shots = resolve('out/e2e-kiosk-enrolment')

const directory = mkdtempSync(join(tmpdir(), 'osl-kiosk-enrolment-'))
let server
let browser
try {
  if (!process.env.OSL_CHROMIUM_PATH) throw new Error('Set OSL_CHROMIUM_PATH to Chrome or Chromium before running this smoke test.')
  mkdirSync(shots, { recursive: true })
  const database = openServerDatabase(join(directory, 'openskylight.db'))
  createHouseholdSettingsService(database.sqlite).setTimezone('UTC')
  const today = new Date().toISOString().slice(0, 10)
  database.sqlite.prepare("INSERT INTO people (id, name, normalized_name, color, role, sort_order, created_at) VALUES ('ava', 'Ava', 'ava', '#E5484D', 'child', 0, ?)").run(`${today}T00:00:00.000Z`)
  database.sqlite.prepare("INSERT INTO calendar_sources (id, kind, name, connected_at) VALUES ('source', 'caldav', 'Household', ?)").run(`${today}T00:00:00.000Z`)
  database.sqlite.prepare("INSERT INTO calendars (id, source_id, source_calendar_id, name, color, selected) VALUES ('calendar', 'source', 'family', 'Family', '#0091FF', 1)").run()
  database.sqlite.prepare("INSERT INTO events (id, calendar_id, source_event_id, title, start_at, end_at, timezone, created_at, updated_at) VALUES ('event', 'calendar', 'event', 'Family dinner', ?, ?, 'UTC', ?, ?)")
    .run(`${today}T18:00:00.000Z`, `${today}T19:00:00.000Z`, `${today}T00:00:00.000Z`, `${today}T00:00:00.000Z`)
  // A claimed household: this is ADR 0006 case 2, where a screen is simply added.
  new HouseholdAuthService(database.sqlite).setup(PIN)

  server = createHeadlessServer({ host: '127.0.0.1', port: 0, database, staticDir: resolve('out/kiosk') })
  const started = await server.start()
  browser = await chromium.launch({ executablePath: process.env.OSL_CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] })

  // 1. The unreachable-server state comes first: a screen that cannot mint must
  //    say so and keep trying, never blank and never a broken QR.
  {
    const context = await browser.newContext({ viewport: VIEWPORTS[0] })
    const page = await context.newPage()
    await page.route('**/api/v1/display/enrolment-code', (route) => route.abort('connectionrefused'))
    await page.goto(started.url, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-enrolment-phase="offline"]').waitFor({ timeout: 10_000 })
    await page.getByText('This screen cannot reach your household server').waitFor()
    await page.screenshot({ path: join(shots, 'offline-1280x800.png') })
    // Backoff must recover on its own, with nobody touching the screen.
    await page.unroute('**/api/v1/display/enrolment-code')
    await page.locator('[data-enrolment-code]').waitFor({ timeout: 15_000 })
    await context.close()
    console.info('Unreachable server recovers to a code without interaction')
  }

  // 2. The enrolment surface at all three supported viewports.
  let code
  const context = await browser.newContext({ viewport: VIEWPORTS[0] })
  const page = await context.newPage()
  await page.goto(started.url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Set up this screen' }).waitFor({ timeout: 10_000 })
  const codeText = page.locator('[data-enrolment-code]')
  await codeText.waitFor({ timeout: 10_000 })
  const shown = (await codeText.innerText()).trim()
  if (!/^[0-9A-HJKMNP-TV-Z]{4} [0-9A-HJKMNP-TV-Z]{4}$/.test(shown)) {
    throw new Error(`The typed fallback is not two Crockford blocks of four: ${JSON.stringify(shown)}`)
  }
  code = shown.replace(' ', '')

  const qr = page.getByAltText('Setup code for this screen')
  await qr.waitFor()
  const src = await qr.getAttribute('src')
  if (!src?.startsWith('data:image/png;base64,') || src.length < 1_000) throw new Error('The QR did not render as an image')
  const box = await qr.boundingBox()
  if (box === null || box.width < 240) throw new Error(`The QR is too small to scan across a room: ${box?.width}px`)

  // The poll token is a secret that must never reach the DOM in any form.
  const markup = await page.content()
  const grant = await (await fetch(`${started.url}/api/v1/display/enrolment-code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()
  if (grant.pollToken.length < 20) throw new Error('Unexpected poll token shape')
  if (markup.includes('pollToken') || markup.includes('poll_token')) throw new Error('A poll token field leaked into the DOM')

  await page.getByText('This code refreshes in').waitFor()

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await page.waitForTimeout(150)
    const frame = await page.locator('.kiosk-app-shell').boundingBox()
    if (frame !== null && frame.height > viewport.height + 1) {
      throw new Error(`Enrolment overflows ${viewport.width}x${viewport.height}: content is ${frame.height}px tall`)
    }
    const scrolled = await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight)
    if (scrolled > 1) throw new Error(`Enrolment scrolls at ${viewport.width}x${viewport.height} by ${scrolled}px`)
    await page.screenshot({ path: join(shots, `code-${viewport.width}x${viewport.height}.png`) })
  }
  await page.setViewportSize(VIEWPORTS[0])
  console.info(`Enrolment surface renders at ${VIEWPORTS.map((v) => `${v.width}x${v.height}`).join(', ')}`)

  // 2b. Rotation. A code lives five minutes, so the only way to see the wall
  //     survive an expiry inside a smoke test is to make the server say so.
  {
    const rotating = await browser.newContext({ viewport: VIEWPORTS[0] })
    const rotatingPage = await rotating.newPage()
    let expireOnce = true
    await rotatingPage.route('**/api/v1/display/enrolment-code/claim', (route) => {
      if (!expireOnce) return route.continue()
      expireOnce = false
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'expired' }) })
    })
    await rotatingPage.goto(started.url, { waitUntil: 'domcontentloaded' })
    const locator = rotatingPage.locator('[data-enrolment-code]')
    await locator.waitFor({ timeout: 10_000 })
    const before = (await locator.innerText()).trim()
    const deadline = Date.now() + 15_000
    let after = before
    while (after === before && Date.now() < deadline) {
      await rotatingPage.waitForTimeout(250)
      // The heading must stay put through a rotation: the wall should never
      // look like it has crashed and come back.
      if (await rotatingPage.getByRole('heading', { name: 'Set up this screen' }).count() !== 1) {
        throw new Error('The enrolment surface disappeared while rotating its code')
      }
      after = (await rotatingPage.locator('[data-enrolment-code], [data-enrolment-phase="preparing"]').first().innerText()).trim()
    }
    if (after === before) throw new Error('An expired code was not replaced on screen')
    await rotating.close()
    console.info('An expired code is replaced in place, without the screen blanking')
  }

  // 3. The parent's phone: pair with the household PIN (N17), then redeem the
  //    code the screen is showing. Nothing is ever typed into the screen.
  const paired = await (await fetch(`${started.url}/api/v1/parent-devices`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: PIN, name: "Parent's phone" })
  })).json()
  if (typeof paired.credential !== 'string') throw new Error('Phone pairing did not return a credential')

  const enrolled = await fetch(`${started.url}/api/v1/displays/enrol`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${paired.credential}` },
    body: JSON.stringify({ code, name: 'Kitchen wall' })
  })
  if (enrolled.status !== 201) throw new Error(`Redeeming the displayed code failed with ${enrolled.status}`)

  // 4. The screen collects its credential, names the adoption, then boots.
  await page.getByText('This screen is now “Kitchen wall”').waitFor({ timeout: 15_000 })
  await page.screenshot({ path: join(shots, 'adopted-1280x800.png') })
  const stored = await page.evaluate(() => ({
    credential: localStorage.getItem('osl.displayCredential'),
    id: localStorage.getItem('osl.displayId')
  }))
  if (stored.credential === null || stored.id === null) throw new Error('The display credential was not persisted before the board came up')
  console.info('Adoption is confirmed on screen and the credential is persisted')

  // The board must come up on its own, with nobody at the screen.
  await page.getByText('Family dinner').first().waitFor({ timeout: 20_000 })
  await page.screenshot({ path: join(shots, 'board-1280x800.png') })

  // A restart after enrolment must go straight to the board, never back to a QR.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('Family dinner').first().waitFor({ timeout: 20_000 })
  if (await page.locator('[data-enrolment-code]').count() !== 0) throw new Error('A registered screen showed the enrolment surface again')

  console.info(`Kiosk enrolment smoke passed — screenshots in ${shots}`)
} finally {
  await browser?.close()
  await server?.stop()
  rmSync(directory, { recursive: true, force: true })
}
