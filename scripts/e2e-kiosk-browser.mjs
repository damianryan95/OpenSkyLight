import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createHeadlessServer } from '../out/server/server.js'
import { openServerDatabase } from '../out/server/db/index.js'
import { DisplayDeviceService } from '../out/server/auth/index.js'
import { createHouseholdSettingsService } from '../out/server/domain/settings.js'

const directory = mkdtempSync(join(tmpdir(), 'osl-kiosk-browser-'))
let server
let browser
try {
  if (!process.env.OSL_CHROMIUM_PATH) {
    throw new Error('Set OSL_CHROMIUM_PATH to an ordinary Chromium/Chrome executable before running this smoke test.')
  }
  const database = openServerDatabase(join(directory, 'openskylight.db'))
  createHouseholdSettingsService(database.sqlite).setTimezone('UTC')
  const today = new Date().toISOString().slice(0, 10)
  database.sqlite.prepare("INSERT INTO people (id, name, normalized_name, color, role, sort_order, created_at) VALUES (?, ?, ?, ?, 'child', ?, ?)").run('ava', 'Ava', 'ava', '#E5484D', 0, `${today}T00:00:00.000Z`)
  database.sqlite.prepare("INSERT INTO people (id, name, normalized_name, color, role, sort_order, created_at) VALUES (?, ?, ?, ?, 'child', ?, ?)").run('leo', 'Leo', 'leo', '#0091FF', 1, `${today}T00:00:00.000Z`)
  database.sqlite.prepare("INSERT INTO google_accounts (id, email, refresh_token_enc, scopes, connected_at) VALUES ('account', 'parent@example.test', X'00', 'calendar.readonly', ?)").run(`${today}T00:00:00.000Z`)
  database.sqlite.prepare("INSERT INTO calendars (id, google_account_id, google_calendar_id, name, color, selected) VALUES ('calendar', 'account', 'family', 'Family', '#0091FF', 1)").run()
  const insertEvent = database.sqlite.prepare("INSERT INTO events (id, calendar_id, google_event_id, title, start_at, end_at, timezone, created_at, updated_at) VALUES (?, 'calendar', ?, ?, ?, ?, 'UTC', ?, ?)")
  insertEvent.run('family-event', 'family-event', 'Family dinner', `${today}T18:00:00.000Z`, `${today}T19:00:00.000Z`, `${today}T00:00:00.000Z`, `${today}T00:00:00.000Z`)
  insertEvent.run('ava-event', 'ava-event', 'Ava swimming', `${today}T10:00:00.000Z`, `${today}T11:00:00.000Z`, `${today}T00:00:00.000Z`, `${today}T00:00:00.000Z`)
  insertEvent.run('leo-event', 'leo-event', 'Leo music', `${today}T12:00:00.000Z`, `${today}T13:00:00.000Z`, `${today}T00:00:00.000Z`, `${today}T00:00:00.000Z`)
  database.sqlite.prepare("INSERT INTO chores (id, title, person_id, stars_value, due_date, active, sort_order, created_at) VALUES ('dishes', 'Wash dishes', 'ava', 1, ?, 1, 0, ?)").run(today, `${today}T00:00:00.000Z`)
  database.sqlite.prepare("INSERT INTO rewards (id, title, cost_stars, active, sort_order, created_at) VALUES ('movie', 'Movie night', 3, 1, 0, ?)").run(`${today}T00:00:00.000Z`)
  database.sqlite.prepare("INSERT INTO lists (id, name, color, kind, sort_order, created_at) VALUES ('groceries', 'Groceries', '#0091FF', 'grocery', 0, ?)").run(`${today}T00:00:00.000Z`)
  database.sqlite.prepare("INSERT INTO list_items (id, list_id, text, checked, sort_order, created_at) VALUES ('milk', 'groceries', 'Milk', 0, 0, ?)").run(`${today}T00:00:00.000Z`)
  database.sqlite.prepare("INSERT INTO meal_slots (id, date, slot, free_text) VALUES ('dinner', ?, 'dinner', 'Pasta')").run(today)
  const credential = new DisplayDeviceService(database.sqlite).register({ name: 'Browser smoke' }).credential
  server = createHeadlessServer({ host: '127.0.0.1', port: 0, database, staticDir: resolve('out/kiosk') })
  const started = await server.start()
  browser = await chromium.launch({
    executablePath: process.env.OSL_CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox']
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.addInitScript((value) => localStorage.setItem('osl.displayCredential', value), credential)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  // The authenticated SSE stream intentionally stays open, so networkidle
  // would never resolve for a healthy kiosk.
  await page.goto(started.url, { waitUntil: 'domcontentloaded' })
  await page.locator('header').waitFor()
  // A display has no route into mutation UI. The server separately refuses
  // those legacy RPC commands in the unit test above.
  for (const name of ['Add event', 'Settings', 'Customize home screen']) {
    if (await page.getByRole('button', { name }).count() !== 0) throw new Error(`Read-only kiosk exposed ${name}`)
  }
  await page.getByText('Ava swimming', { exact: true }).first().waitFor()
  // Family is the launch default and includes both personal feeds plus Family-only events.
  if (await page.getByText('Leo music', { exact: true }).count() === 0) throw new Error('Family launch did not include Leo\'s event')
  await page.getByRole('button', { name: "Show Ava's view" }).click()
  await page.getByText('Ava swimming', { exact: true }).first().waitFor()
  await page.waitForTimeout(50)
  if (await page.getByText('Leo music', { exact: true }).count() !== 0) throw new Error('Ava view included Leo\'s event')
  if (await page.getByText('Family dinner', { exact: true }).count() !== 0) throw new Error('Ava view included a Family-only event')
  await page.getByRole('button', { name: 'Show Family view' }).click()
  await page.getByText('Leo music', { exact: true }).first().waitFor()
  await page.getByRole('button', { name: 'Day', exact: true }).click()
  await page.getByText('Ava swimming', { exact: true }).last().click()
  await page.getByLabel('Close').click()
  await page.getByRole('button', { name: 'Chores', exact: true }).click()
  await page.getByRole('button', { name: 'Wash dishes' }).click()
  await page.waitForTimeout(100)
  if (database.sqlite.prepare("SELECT count(*) AS count FROM chore_completions WHERE chore_id = 'dishes' AND due_date = ?").get(today).count !== 1) throw new Error('Today chore completion was not server-authorized')
  await page.getByRole('button', { name: '★ Rewards' }).click()
  await page.getByText('Parent only', { exact: true }).waitFor()
  if (await page.getByRole('button', { name: 'Redeem' }).count() !== 0) throw new Error('Read-only kiosk exposed reward redemption')
  await page.getByLabel('Close').click()
  await page.getByRole('button', { name: 'Lists', exact: true }).click()
  await page.getByText('Milk', { exact: true }).waitFor()
  for (const name of ['New list', 'Add item', 'Check', 'Uncheck', 'Delete item']) {
    if (await page.getByRole('button', { name }).count() !== 0) throw new Error(`Read-only kiosk exposed ${name}`)
  }
  if (errors.length > 0) throw new Error(`Browser kiosk produced runtime errors: ${errors.join('; ')}`)
  console.info('Browser kiosk smoke passed')
} finally {
  await browser?.close()
  await server?.stop()
  rmSync(directory, { recursive: true, force: true })
}
