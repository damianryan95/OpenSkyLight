import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { ApiClient, ApiClientError } from '../../src/shared/api/client'
import { apiErrorResponseSchema } from '../../src/shared/api/contract'
import { ApiRequestError, MAX_JSON_BODY_BYTES, readJsonBody, validateApiInput } from '../../src/server/api/http'
import type { IncomingMessage } from 'node:http'
import { z } from 'zod'

function jsonRequest(body: string, contentLength?: string): IncomingMessage {
  const stream = Readable.from([Buffer.from(body)])
  return Object.assign(stream, { headers: contentLength === undefined ? {} : { 'content-length': contentLength } }) as IncomingMessage
}

describe('HTTP API foundation', () => {
  it('rejects malformed JSON with a stable typed error', async () => {
    await expect(readJsonBody(jsonRequest('{'), z.object({ name: z.string() }))).rejects.toMatchObject({
      status: 400,
      code: 'invalid_json',
      message: 'Request body must be valid JSON'
    } satisfies Partial<ApiRequestError>)
  })

  it('returns stable Zod issue details for invalid input', async () => {
    await expect(readJsonBody(jsonRequest('{"name":1}'), z.object({ name: z.string() }))).rejects.toMatchObject({
      status: 400,
      code: 'bad_request',
      issues: [{ path: ['name'], code: 'invalid_type', message: expect.any(String) }]
    } satisfies Partial<ApiRequestError>)
  })

  it('validates request query objects before API handlers run', () => {
    try {
      validateApiInput({ extra: 'value' }, z.object({}).strict())
      throw new Error('Expected request validation to fail')
    } catch (error) {
      expect(error).toMatchObject({ status: 400, code: 'bad_request' })
    }
  })

  it('enforces the explicit JSON body limit before reading the request', async () => {
    await expect(readJsonBody(jsonRequest('{}', String(MAX_JSON_BODY_BYTES + 1)), z.object({}))).rejects.toMatchObject({
      status: 413,
      code: 'payload_too_large'
    } satisfies Partial<ApiRequestError>)
  })

  it('parses successful typed client responses without Node dependencies', async () => {
    const client = new ApiClient('http://example.test', async () => new Response('{"version":"v1"}', { status: 200 }))
    await expect(client.getInfo()).resolves.toEqual({ version: 'v1' })
  })

  it('surfaces typed API error envelopes from the browser client', async () => {
    const error = apiErrorResponseSchema.parse({ error: { code: 'bad_request', message: 'Request validation failed' } })
    const client = new ApiClient('http://example.test', async () => new Response(JSON.stringify(error), { status: 400 }))
    await expect(client.getInfo()).rejects.toBeInstanceOf(ApiClientError)
  })
})
