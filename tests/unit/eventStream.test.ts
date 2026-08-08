import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { handleApiRequest } from '../../src/server/api/router'
import { EventStream, MAX_EVENT_STREAM_SUBSCRIBERS } from '../../src/server/events'

class FakeSseResponse extends EventEmitter {
  readonly chunks: string[] = []
  statusCode: number | undefined
  headers: Record<string, string> | undefined
  writable = true

  writeHead(statusCode: number, headers: Record<string, string>): this {
    this.statusCode = statusCode
    this.headers = headers
    return this
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk)
    return this.writable
  }

  end(chunk?: string): this {
    if (chunk !== undefined) this.chunks.push(chunk)
    this.emit('close')
    return this
  }
}

function response(): FakeSseResponse {
  return new FakeSseResponse()
}

function request(path: string, headers: Record<string, string> = {}): IncomingMessage {
  return { method: 'GET', url: path, headers } as IncomingMessage
}

describe('server event stream', () => {
  it('delivers typed events to multiple authenticated clients', async () => {
    const stream = new EventStream()
    const first = response()
    const second = response()
    const dependencies = { stream, eventStreamAuthenticator: { authenticate: () => ({ type: 'display' as const, id: 'display-1' }) } }

    await handleApiRequest(request('/api/v1/events'), first as unknown as ServerResponse, {
      eventStream: dependencies.stream,
      eventStreamAuthenticator: dependencies.eventStreamAuthenticator
    })
    await handleApiRequest(request('/api/v1/events'), second as unknown as ServerResponse, {
      eventStream: dependencies.stream,
      eventStreamAuthenticator: dependencies.eventStreamAuthenticator
    })
    stream.publish({ type: 'query.invalidated', data: { resources: ['chores', 'events'] } })

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(first.chunks.at(-1)).toContain('event: query.invalidated')
    expect(second.chunks.at(-1)).toContain('event: query.invalidated')
    expect(first.chunks.at(-1)).not.toContain('display-1')
  })

  it('cleans up disconnected and backpressured clients without retaining listeners', () => {
    const stream = new EventStream()
    const disconnected = response()
    const slow = response()
    stream.connect(disconnected as unknown as ServerResponse, undefined)
    stream.connect(slow as unknown as ServerResponse, undefined)
    expect(stream.subscriberCount).toBe(2)

    disconnected.emit('close')
    slow.writable = false
    stream.publish({ type: 'sync.status', data: { state: 'healthy', lastSyncedAt: null } })
    expect(stream.subscriberCount).toBe(0)
  })

  it('forces cache revalidation after reconnect even when the last event was missed', () => {
    const stream = new EventStream()
    const initial = response()
    stream.connect(initial as unknown as ServerResponse, undefined)
    const lastId = /id: (\d+)/.exec(initial.chunks.join(''))?.[1]
    initial.emit('close')
    stream.publish({ type: 'chore.changed', data: { choreId: 'chore-1', personId: 'person-1', completionId: 'completion-1', changedAt: '2026-08-02T00:00:00.000Z' } })

    const reconnected = response()
    stream.connect(reconnected as unknown as ServerResponse, lastId)
    expect(reconnected.chunks.join('')).toContain('event: stream.connected')
    expect(reconnected.chunks.join('')).toContain('"revalidate":true')
    expect(reconnected.chunks.join('')).toContain(`"resumedFromEventId":"${lastId}"`)
  })

  it('rejects unauthenticated stream requests and bounds connections', async () => {
    const denied = response()
    await handleApiRequest(request('/api/v1/events'), denied as unknown as ServerResponse, { eventStream: new EventStream() })
    expect(denied.statusCode).toBe(401)
    expect(denied.chunks.join('')).toContain('"code":"unauthorized"')

    const stream = new EventStream()
    for (let count = 0; count < MAX_EVENT_STREAM_SUBSCRIBERS; count += 1) {
      stream.connect(response() as unknown as ServerResponse, undefined)
    }
    const overCapacity = response()
    stream.connect(overCapacity as unknown as ServerResponse, undefined)
    expect(overCapacity.statusCode).toBe(503)
  })
})
