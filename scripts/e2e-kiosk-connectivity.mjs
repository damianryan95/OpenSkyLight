import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createHeadlessServer } from '../out/server/server.js'
import { openServerDatabase } from '../out/server/db/index.js'
import { DisplayDeviceService } from '../out/server/auth/index.js'
import { createHouseholdSettingsService } from '../out/server/domain/settings.js'

const directory = mkdtempSync(join(tmpdir(), 'osl-kiosk-connectivity-'))
let server
let browser
try {
  if (!process.env.OSL_CHROMIUM_PATH) throw new Error('Set OSL_CHROMIUM_PATH to Chrome or Chromium before running this smoke test.')
  const database = openServerDatabase(join(directory, 'openskylight.db'))
  createHouseholdSettingsService(database.sqlite).setTimezone('UTC')
  const today = new Date().toISOString().slice(0, 10)
  database.sqlite.prepare("INSERT INTO people (id, name, normalized_name, color, role, sort_order, created_at) VALUES ('ava', 'Ava', 'ava', '#E5484D', 'child', 0, ?)").run(`${today}T00:00:00.000Z`)
  database.sqlite.prepare("INSERT INTO google_accounts (id, email, refresh_token_enc, scopes, connected_at) VALUES ('account', 'parent@example.test', X'00', 'calendar.readonly', ?)").run(`${today}T00:00:00.000Z`)
  database.sqlite.prepare("INSERT INTO calendars (id, google_account_id, google_calendar_id, name, color, selected) VALUES ('calendar', 'account', 'family', 'Family', '#0091FF', 1)").run()
  database.sqlite.prepare("INSERT INTO events (id, calendar_id, google_event_id, title, start_at, end_at, timezone, created_at, updated_at) VALUES ('event', 'calendar', 'event', 'Cached family dinner', ?, ?, 'UTC', ?, ?)").run(`${today}T18:00:00.000Z`, `${today}T19:00:00.000Z`, `${today}T00:00:00.000Z`, `${today}T00:00:00.000Z`)
  const credential = new DisplayDeviceService(database.sqlite).register({ name: 'Connectivity smoke' }).credential
  server = createHeadlessServer({ host: '127.0.0.1', port: 0, database, staticDir: resolve('out/kiosk') })
  const started = await server.start()
  browser = await chromium.launch({ executablePath: process.env.OSL_CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.addInitScript((value) => localStorage.setItem('osl.displayCredential', value), credential)
  const page = await context.newPage()
  // Simulate an unavailable server stream while normal cached reads remain usable.
  await page.route('**/api/v1/events', (route) => route.abort('connectionrefused'))
  await page.route('**/api/v1/sync/status', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'stale', lastSyncedAt: '2026-08-01T12:00:00.000Z', lastSucceededAt: '2026-08-01T12:00:00.000Z', calendars: [] }) }))
  await page.goto(started.url, { waitUntil: 'domcontentloaded' })
  await page.getByText('Cached family dinner', { exact: true }).waitFor()
  await page.getByRole('status').filter({ hasText: 'Reconnecting to server…' }).waitFor()
  // Restoring the stream revalidates without a page reload; Google staleness
  // remains a separate, quieter state and cached event content is retained.
  await page.unroute('**/api/v1/events')
  await page.getByRole('status').filter({ hasText: 'Calendar data may be out of date' }).waitFor({ timeout: 5_000 })
  await page.getByText('Cached family dinner', { exact: true }).waitFor()
  console.info('Kiosk connectivity smoke passed')
} finally {
  await browser?.close()
  await server?.stop()
  rmSync(directory, { recursive: true, force: true })
}
