import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createHeadlessServer } from '../out/server/server.js'
import { openServerDatabase } from '../out/server/db/index.js'
import { createHouseholdSettingsService } from '../out/server/domain/settings.js'

const directory = mkdtempSync(join(tmpdir(), 'osl-multi-display-'))
const databasePath = join(directory, 'openskylight.db')
let server
let browser

function expect(value, message) {
  if (!value) throw new Error(message)
}

async function json(url, path, options = {}) {
  const response = await fetch(`${url}${path}`, options)
  const body = response.status === 204 ? undefined : await response.json()
  return { response, body }
}

function seedDatabase(database) {
  const today = new Date().toISOString().slice(0, 10)
  const createdAt = `${today}T00:00:00.000Z`
  createHouseholdSettingsService(database.sqlite).setTimezone('UTC')
  database.sqlite.prepare("INSERT INTO people (id, name, normalized_name, color, role, sort_order, created_at) VALUES ('ava', 'Ava', 'ava', '#E5484D', 'child', 0, ?)").run(createdAt)
  database.sqlite.prepare("INSERT INTO chores (id, title, person_id, stars_value, due_date, active, sort_order, created_at) VALUES ('dishes', 'Wash dishes', 'ava', 2, ?, 1, 0, ?)").run(today, createdAt)
  return today
}

function start(database, port = 0) {
  return createHeadlessServer({ host: '127.0.0.1', port, database, staticDir: resolve('out/kiosk') })
}

async function registerDisplay(parent, name) {
  const { response, body } = await json(parent.url, '/api/v1/displays', {
    method: 'POST',
    headers: { ...parent.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ name })
  })
  expect(response.status === 201, `Parent could not register ${name}`)
  return body
}

async function displayPage(context, display, url) {
  await context.addInitScript(({ credential, id }) => {
    localStorage.setItem('osl.displayCredential', credential)
    localStorage.setItem('osl.displayId', id)
  }, { credential: display.credential, id: display.id })
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Chores', exact: true }).click()
  await page.getByRole('button', { name: 'Wash dishes' }).waitFor()
  // Let this distinct profile establish its SSE connection before exercising a
  // cross-client notification. Sync-health wording varies by fixture state,
  // so it is deliberately not used as a transport assertion here.
  await page.waitForTimeout(500)
  return page
}

try {
  if (!process.env.OSL_CHROMIUM_PATH) {
    throw new Error('Set OSL_CHROMIUM_PATH to an ordinary Chromium/Chrome executable before running this multi-display E2E.')
  }

  let database = openServerDatabase(databasePath)
  const today = seedDatabase(database)
  server = start(database)
  const started = await server.start()

  // This API session is the parent client in the three-client scenario.
  const setup = await json(started.url, '/api/v1/auth/setup', {
    method: 'POST', headers: { origin: started.url, 'content-type': 'application/json' }, body: JSON.stringify({ pin: '1234' })
  })
  expect(setup.response.status === 201, 'Parent household setup failed')
  const parent = {
    url: started.url,
    headers: {
      origin: started.url,
      cookie: setup.response.headers.get('set-cookie').split(';')[0],
      'x-osl-csrf-token': setup.body.csrfToken
    }
  }
  const kitchen = await registerDisplay(parent, 'Kitchen')
  const bedroom = await registerDisplay(parent, 'Bedroom')

  browser = await chromium.launch({ executablePath: process.env.OSL_CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] })
  const kitchenPage = await displayPage(await browser.newContext({ viewport: { width: 1280, height: 800 } }), kitchen, started.url)
  const bedroomPage = await displayPage(await browser.newContext({ viewport: { width: 1280, height: 800 } }), bedroom, started.url)
  expect(server.eventStream.subscriberCount === 2, 'Both display SSE subscriptions were not connected')

  // A completion on one kiosk reaches the other kiosk over SSE. Only the
  // initiating kiosk is named in the visual-only celebration event; the
  // component's display-id filtering is covered by its focused unit test.
  const published = []
  const publish = server.eventStream.publish.bind(server.eventStream)
  server.eventStream.publish = (event) => { published.push(event); return publish(event) }
  await kitchenPage.getByRole('button', { name: 'Wash dishes' }).click()
  await bedroomPage.getByText('1/1 done', { exact: true }).waitFor({ timeout: 4_000 })
  await kitchenPage.getByText('1/1 done', { exact: true }).waitFor({ timeout: 4_000 })
  const celebration = published.find((event) => event.type === 'celebration.requested')
  expect(celebration?.data.initiatingDisplayId === kitchen.id, 'Celebration was not targeted to Kitchen')

  // Retrying the same command cannot duplicate either the completion or its
  // star award, even if a kiosk loses the first response.
  const retried = await json(started.url, '/api/v1/display/chores/dishes/completion', {
    method: 'POST', headers: { authorization: `Bearer ${kitchen.credential}`, 'content-type': 'application/json' }, body: JSON.stringify({ dueDate: today })
  })
  expect(retried.response.status === 200 && retried.body.created === false, 'Duplicate completion was not idempotent')
  const counts = database.sqlite.prepare("SELECT (SELECT count(*) FROM chore_completions WHERE chore_id = 'dishes' AND due_date = ?) AS completions, (SELECT count(*) FROM star_ledger WHERE person_id = 'ava') AS awards").get(today)
  expect(counts.completions === 1 && counts.awards === 1, 'One chore completion awarded more than once')
  const parentRead = await json(started.url, '/api/v1/chores', { headers: { cookie: parent.headers.cookie } })
  expect(parentRead.response.status === 200 && parentRead.body.chores.length === 1, 'Parent client could not converge on household chore state')

  // A transient stream outage leaves cached content visible and shows a
  // recoverable status; restoring transport reconnects without a new kiosk.
  await kitchenPage.route('**/api/v1/events', (route) => route.abort('connectionrefused'))
  await kitchenPage.reload({ waitUntil: 'domcontentloaded' })
  await kitchenPage.getByText('Wash dishes', { exact: true }).waitFor()
  await kitchenPage.getByRole('status').filter({ hasText: 'Reconnecting to server…' }).waitFor()
  await kitchenPage.unroute('**/api/v1/events')
  await kitchenPage.reload({ waitUntil: 'domcontentloaded' })
  await kitchenPage.getByText('1/1 done', { exact: true }).waitFor()

  // Restart the sole server against its persisted database. The active kitchen
  // kiosk recovers, while a parent-revoked device cannot make fresh reads.
  const restartPort = started.port
  await server.stop()
  await kitchenPage.getByRole('status').filter({ hasText: 'Reconnecting to server…' }).waitFor({ timeout: 5_000 })
  database = openServerDatabase(databasePath)
  server = start(database, restartPort)
  const restarted = await server.start()
  await kitchenPage.reload({ waitUntil: 'domcontentloaded' })
  await kitchenPage.getByText('1/1 done', { exact: true }).waitFor()
  parent.url = restarted.url
  const revoke = await json(restarted.url, `/api/v1/displays/${bedroom.id}/revoke`, { method: 'POST', headers: parent.headers })
  expect(revoke.response.status === 204, 'Parent could not revoke Bedroom')
  const revokedRead = await json(restarted.url, '/api/v1/display/session', { headers: { authorization: `Bearer ${bedroom.credential}` } })
  expect(revokedRead.response.status === 401, 'Revoked display retained API access')
  await bedroomPage.reload({ waitUntil: 'domcontentloaded' })
  await bedroomPage.getByRole('status').filter({ hasText: 'Reconnecting to server…' }).waitFor()
  console.info('MULTI-DISPLAY E2E PASS: convergence, idempotency, targeted celebration, reconnect, restart, and revocation')
} finally {
  await browser?.close()
  await server?.stop()
  rmSync(directory, { recursive: true, force: true })
}
