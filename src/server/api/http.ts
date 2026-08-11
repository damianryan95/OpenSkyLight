import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import {
  apiErrorResponseSchema,
  type ApiErrorCode,
  type ApiValidationIssue
} from '../../shared/api/contract'

export const MAX_JSON_BODY_BYTES = 1_048_576
export const MAX_MEDIA_BODY_BYTES = 25 * 1_024 * 1_024

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly issues?: ApiValidationIssue[]
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff'
  })
  response.end(JSON.stringify(body))
}

export function sendApiError(response: ServerResponse, error: ApiRequestError): void {
  const body = apiErrorResponseSchema.parse({
    error: {
      code: error.code,
      message: error.message,
      ...(error.issues === undefined ? {} : { issues: error.issues })
    }
  })
  sendJson(response, error.status, body)
}

export async function readJsonBody<T>(request: IncomingMessage, schema: z.ZodType<T>): Promise<T> {
  const contentLength = request.headers['content-length']
  if (contentLength !== undefined && Number(contentLength) > MAX_JSON_BODY_BYTES) {
    throw new ApiRequestError(413, 'payload_too_large', 'JSON request body exceeds the 1048576 byte limit')
  }

  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.length
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new ApiRequestError(413, 'payload_too_large', 'JSON request body exceeds the 1048576 byte limit')
    }
    chunks.push(buffer)
  }

  let value: unknown
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ApiRequestError(400, 'invalid_json', 'Request body must be valid JSON')
  }

  return validateApiInput(value, schema)
}

/** Read a small, explicitly bounded binary upload without buffering an unbounded request. */
export async function readBinaryBody(request: IncomingMessage, maxBytes = MAX_MEDIA_BODY_BYTES): Promise<Buffer> {
  const contentLength = request.headers['content-length']
  if (contentLength !== undefined && Number(contentLength) > maxBytes) throw new ApiRequestError(413, 'payload_too_large', 'Media upload exceeds the 25 MB limit')
  const chunks: Buffer[] = []; let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw new ApiRequestError(413, 'payload_too_large', 'Media upload exceeds the 25 MB limit')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

export function formatZodIssues(error: z.ZodError): ApiValidationIssue[] {
  return error.issues.map((issue) => ({ path: issue.path, code: issue.code, message: issue.message }))
}

export function validateApiInput<T>(value: unknown, schema: z.ZodType<T>): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ApiRequestError(400, 'bad_request', 'Request validation failed', formatZodIssues(result.error))
  }
  return result.data
}
