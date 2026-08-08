import { createHeadlessServer, installGracefulShutdown } from './server'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { openServerDatabase } from './db'
import { createHouseholdSettingsService } from './domain/settings'
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
  if (configuredTimezone !== undefined) {
    createHouseholdSettingsService(database.sqlite).setTimezone(configuredTimezone)
  }
  const server = createHeadlessServer({
    host: process.env.OSL_SERVER_HOST ?? '0.0.0.0',
    port: configuredPort,
    database,
    staticDir: resolve(process.env.OSL_KIOSK_ASSETS_PATH ?? './out/kiosk'),
    companionStaticDir: resolve(process.env.OSL_COMPANION_ASSETS_PATH ?? './out/companion')
  })
  const started = await server.start()
  console.info(JSON.stringify({
    event: 'server.started',
    ...started,
    releaseVersion: process.env.OSL_RELEASE_VERSION ?? 'dev',
    ...(configuredTimezone === undefined ? {} : { householdTimezone: configuredTimezone })
  }))
  installGracefulShutdown(server)
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: 'server.start_failed', error: safeLogErrorMessage(error) }))
  process.exitCode = 1
})
