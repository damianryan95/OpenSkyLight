import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  serverEventSchema,
  type EventStreamPrincipal,
  type ServerEvent
} from '../../shared/api/contract'

export const SSE_HEARTBEAT_MS = 30_000
export const MAX_EVENT_STREAM_SUBSCRIBERS = 100

export interface EventStreamWriter {
  write(chunk: string): boolean
  end(): void
  once(event: 'close' | 'error', listener: () => void): unknown
}

export interface EventStreamAuthenticator {
  authenticate(request: IncomingMessage): EventStreamPrincipal | undefined
}

type PublishedEvent = Omit<ServerEvent, 'id'>

/**
 * Delivers notifications only; it retains neither event payloads nor per-client
 * queues. A dropped client reconnects and safely revalidates its HTTP cache.
 */
export class EventStream {
  private readonly subscribers = new Set<EventStreamWriter>()
  private nextId = 1

  get subscriberCount(): number {
    return this.subscribers.size
  }

  publish(event: PublishedEvent): ServerEvent {
    const published = serverEventSchema.parse({ ...event, id: String(this.nextId++) })
    const encoded = formatSseEvent(published)
    for (const subscriber of [...this.subscribers]) {
      // Do not accumulate an application-level queue for a slow/dead client.
      if (!subscriber.write(encoded)) this.remove(subscriber)
    }
    return published
  }

  connect(response: ServerResponse, lastEventId: string | undefined): void {
    if (this.subscribers.size >= MAX_EVENT_STREAM_SUBSCRIBERS) {
      response.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'retry-after': '5' })
      response.end(JSON.stringify({ error: { code: 'internal_error', message: 'Event stream is at capacity' } }))
      return
    }

    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff'
    })
    response.write('retry: 5000\n\n')
    this.subscribers.add(response)
    const remove = (): void => this.remove(response)
    response.once('close', remove)
    response.once('error', remove)

    // Always tell a new connection to revalidate: SSE delivery is deliberately
    // best-effort and events published while disconnected are not replayed.
    const connected = serverEventSchema.parse({
      id: String(this.nextId++),
      type: 'stream.connected',
      data: { revalidate: true, resumedFromEventId: lastEventId ?? null }
    })
    if (!response.write(formatSseEvent(connected))) this.remove(response)

    const heartbeat = setInterval(() => {
      if (!response.write(': heartbeat\n\n')) this.remove(response)
    }, SSE_HEARTBEAT_MS)
    heartbeat.unref()
    response.once('close', () => clearInterval(heartbeat))
    response.once('error', () => clearInterval(heartbeat))
  }

  private remove(subscriber: EventStreamWriter): void {
    this.subscribers.delete(subscriber)
  }
}

export function formatSseEvent(event: ServerEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`
}
