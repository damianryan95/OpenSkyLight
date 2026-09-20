import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { sendLiveHealth, sendReadyHealth } from './api/health'
import { handleApiRequest } from './api/router'
import { DisplayDeviceService, HouseholdAuthService, PARENT_SESSION_COOKIE } from './auth'
import type { ServerDatabase } from './db'
import { createChoresRewardsService, createDisplayReadService, createHouseholdSettingsService, createListsDomain, createMealsDomain, createPeopleService, createMediaService } from './domain'
import { EventStream, type EventStreamAuthenticator } from './events'
import { createCalendarSyncStatusService } from './sync/status'
import { createCalendarSourceService } from './sync/sources'
import { createSyncScheduler } from './sync/scheduler'
import { safeLogErrorMessage } from './logging'
import { createOnlineIconSearchService } from './icons'

export interface HeadlessServerOptions {
  host?: string
  port?: number
  eventStreamAuthenticator?: EventStreamAuthenticator
  /** The server-owned SQLite database; required to enable parent auth routes. */
  database?: ServerDatabase
  /** Built standalone kiosk bundle. Omit in domain-only tests. */
  staticDir?: string
  /** Built parent administration bundle, served at /admin/. */
  companionStaticDir?: string
  /** Persistent server-owned location for celebration media. */
  mediaDir?: string
}

export interface StartedHeadlessServer {
  host: string
  port: number
  url: string
}

export interface HeadlessServer {
  start(): Promise<StartedHeadlessServer>
  stop(): Promise<void>
  readonly eventStream: EventStream
}

/**
 * Minimal Node-only process boundary for the future household service. Domain
 * services are added behind this transport as they are extracted from Electron.
 */
export function createHeadlessServer(options: HeadlessServerOptions = {}): HeadlessServer {
  const host = options.host ?? '0.0.0.0'
  const port = options.port ?? 3000
  const eventStream = new EventStream()
  const auth = options.database === undefined ? undefined : new HouseholdAuthService(options.database.sqlite)
  const displays = options.database === undefined ? undefined : new DisplayDeviceService(options.database.sqlite)
  const settings = options.database === undefined ? undefined : createHouseholdSettingsService(options.database.sqlite)
  const people = options.database === undefined ? undefined : createPeopleService(options.database.sqlite)
  const media = options.database === undefined || options.mediaDir === undefined ? undefined : createMediaService(options.database.sqlite, options.mediaDir)
  const syncStatus = options.database === undefined ? undefined : createCalendarSyncStatusService(options.database.sqlite, {
    publish: (data) => eventStream.publish({ type: 'sync.status', data })
  })
  const calendarSources = options.database === undefined || settings === undefined ? undefined : createCalendarSourceService(
    options.database.sqlite,
    () => settings.get().timezone,
    { status: syncStatus, onEventsChanged: () => eventStream.publish({ type: 'query.invalidated', data: { resources: ['events'] } }) }
  )
  const syncScheduler = calendarSources === undefined ? undefined : createSyncScheduler(calendarSources)
  const chores = options.database === undefined ? undefined : createChoresRewardsService(options.database.sqlite, undefined, (event) => {
    eventStream.publish({
      type: 'chore.changed',
      data: { choreId: event.choreId, personId: event.personId, completionId: event.completionId, changedAt: event.completedAt }
    })
    eventStream.publish({
      type: 'celebration.requested',
      data: {
        completionId: event.completionId,
        choreId: event.choreId,
        personId: event.personId,
        stars: event.stars,
        completedAt: event.completedAt,
        initiatingDisplayId: event.initiatingDeviceId ?? null
      }
    })
  })
  const displayRead = options.database === undefined || chores === undefined || settings === undefined ? undefined : createDisplayReadService(options.database.sqlite, chores, settings)
  const lists = options.database === undefined ? undefined : createListsDomain(options.database.sqlite)
  const meals = options.database === undefined ? undefined : createMealsDomain(options.database.sqlite)
  const httpServer = createHttpServer({
    eventStream,
    eventStreamAuthenticator: options.eventStreamAuthenticator ?? (auth === undefined || displays === undefined ? undefined : {
      authenticate(request) {
        const parentToken = readCookie(request, PARENT_SESSION_COOKIE)
        if (auth.getParentSession(parentToken) !== undefined) return { type: 'parent' as const, id: 'household' }
        const credential = readBearerToken(request)
        const device = displays.authenticate(credential)
        return device === undefined ? undefined : { type: 'display' as const, id: device.id }
      }
    }),
    ...(auth === undefined || displays === undefined || settings === undefined || chores === undefined || people === undefined || syncStatus === undefined || displayRead === undefined || lists === undefined || meals === undefined ? {} : { auth, displays, settings, chores, people, media, syncStatus, calendarSources, syncScheduler, displayRead, lists, meals, icons: createOnlineIconSearchService() })
  }, options.staticDir, options.companionStaticDir)
  let started: StartedHeadlessServer | undefined

  return {
    async start(): Promise<StartedHeadlessServer> {
      if (started) return started

      httpServer.listen(port, host)
      await once(httpServer, 'listening')
      const address = httpServer.address()
      if (address === null || typeof address === 'string') {
        throw new Error('Headless server did not bind to a TCP address')
      }

      const publicHost = address.address.includes(':') ? `[${address.address}]` : address.address
      started = { host: address.address, port: address.port, url: `http://${publicHost}:${address.port}` }
      syncScheduler?.start()
      return started
    },
    async stop(): Promise<void> {
      if (!httpServer.listening) return
      syncScheduler?.stop()
      httpServer.close()
      await once(httpServer, 'close')
      options.database?.close()
      started = undefined
    },
    eventStream
  }
}

function readCookie(request: import('node:http').IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie
  const value = Array.isArray(header) ? header[0] : header
  return value?.split(';').map((part: string) => part.trim()).find((part: string) => part.startsWith(`${name}=`))?.slice(name.length + 1)
}

function readBearerToken(request: import('node:http').IncomingMessage): string | undefined {
  const header = request.headers.authorization
  const value = Array.isArray(header) ? header[0] : header
  return value?.match(/^Bearer ([A-Za-z0-9_-]{32,})$/)?.[1]
}

function createHttpServer(dependencies: Parameters<typeof handleApiRequest>[2] = {}, staticDir?: string, companionStaticDir?: string): Server {
  return createServer((request, response) => {
    const method = request.method ?? 'GET'
    const path = new URL(request.url ?? '/', 'http://localhost').pathname

    if (method === 'GET' && path === '/health/live') {
      sendLiveHealth(response)
      return
    }
    if (method === 'GET' && path === '/health/ready') {
      sendReadyHealth(response)
      return
    }

    void handleApiRequest(request, response, dependencies).then((handled) => {
      if (handled) return
      if (method === 'GET' && path.startsWith('/admin') && companionStaticDir !== undefined && serveStatic(response, path.slice('/admin'.length) || '/', companionStaticDir)) return
      if (method === 'GET' && staticDir !== undefined && serveStatic(response, path, staticDir)) return
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ error: 'Not found' }))
    })
  })
}

/** Serve the Vite kiosk bundle and its SPA fallback without exposing its parent directory. */
function serveStatic(response: import('node:http').ServerResponse, path: string, staticDir: string): boolean {
  if (!existsSync(staticDir)) return false
  const root = resolve(staticDir)
  const requested = path === '/' ? resolve(root, 'index.html') : resolve(root, `.${path}`)
  const file = requested.startsWith(`${root}${sep}`) || requested === root ? requested : resolve(root, 'index.html')
  const target = existsSync(file) && statSync(file).isFile() ? file : resolve(root, 'index.html')
  if (!existsSync(target)) return false
  const contentType = MIME_TYPES[extname(target)] ?? 'application/octet-stream'
  response.writeHead(200, { 'content-type': contentType, 'cache-control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable' })
  createReadStream(target).pipe(response)
  return true
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2'
}

export function installGracefulShutdown(server: HeadlessServer): () => void {
  let stopping = false
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) return
    stopping = true
    console.info(JSON.stringify({ event: 'server.shutdown', signal }))
    void server.stop().catch((error: unknown) => {
      console.error(JSON.stringify({ event: 'server.shutdown_failed', error: safeLogErrorMessage(error) }))
      process.exitCode = 1
    })
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  return () => {
    process.removeListener('SIGINT', shutdown)
    process.removeListener('SIGTERM', shutdown)
  }
}
