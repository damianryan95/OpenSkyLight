import { createHeadlessServer, installGracefulShutdown } from './server'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { openServerDatabase } from './db'
import { createHouseholdSettingsService } from './domain/settings'
import { HouseholdTimezoneRequiredError } from './domain/errors'
import { safeLogErrorMessage } from './logging'

async function main(): Promise<void> {
  const configuredPort = Number(process.env.OSL_SERVER_PORT ?? '3000')
  if (!Number.isInteger(configuredPort) || configuredPort < 0 || configuredPort > 65535) {
    throw new Error('OSL_SERVER_PORT must be an integer between 0 and 65535')
  }

  const databasePath = resolve(process.env.OSL_DATABASE_PATH ?? './data/openskylight.db')
  mkdirSync(dirname(databasePath), { recursive: true })
  const database = openServerDatabase(databasePath)
  const configuredTimezone = process.env.OSL_HOUSEHOLD_TIMEZONE
  const settings = createHouseholdSettingsService(database.sqlite)
  // The environment value seeds a new household only.  Once a parent has
  // chosen a timezone, deployments must not silently overwrite it.
  try {
    settings.get()
  } catch (error) {
    if (!(error instanceof HouseholdTimezoneRequiredError)) throw error
    settings.setTimezone(configuredTimezone ?? 'Etc/UTC')
  }
  const server = createHeadlessServer({
    host: process.env.OSL_SERVER_HOST ?? '0.0.0.0',
    port: configuredPort,
    database,
    mediaDir: resolve(process.env.OSL_MEDIA_PATH ?? join(dirname(databasePath), 'media')),
    staticDir: resolve(process.env.OSL_KIOSK_ASSETS_PATH ?? './out/kiosk'),
    companionStaticDir: resolve(process.env.OSL_COMPANION_ASSETS_PATH ?? './out/companion')
  })
  const started = await server.start()
  console.info(JSON.stringify({
    event: 'server.started',
    ...started,
    releaseVersion: process.env.OSL_RELEASE_VERSION ?? 'dev',
    householdTimezone: settings.get().timezone
  }))
  installGracefulShutdown(server)
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: 'server.start_failed', error: safeLogErrorMessage(error) }))
  process.exitCode = 1
})
