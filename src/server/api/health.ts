import type { ServerResponse } from 'node:http'

export function sendLiveHealth(response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({ status: 'live' }))
}

export function sendReadyHealth(response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({ status: 'ready' }))
}
