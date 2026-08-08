import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHeadlessServer, type HeadlessServer } from '../../src/server/server'

const servers: HeadlessServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()))
})

describe('headless server skeleton', () => {
  it('serves live and ready health endpoints without Electron', async () => {
    const server = createHeadlessServer({ host: '127.0.0.1', port: 0 })
    servers.push(server)
    const started = await server.start()

    await expect(fetch(`${started.url}/health/live`)).resolves.toMatchObject({ status: 200 })
    await expect(fetch(`${started.url}/health/ready`)).resolves.toMatchObject({ status: 200 })
    await expect(fetch(`${started.url}/not-found`)).resolves.toMatchObject({ status: 404 })
  })

  it('can stop and start again', async () => {
    const server = createHeadlessServer({ host: '127.0.0.1', port: 0 })
    servers.push(server)

    await server.start()
    await server.stop()
    await expect(server.start()).resolves.toMatchObject({ port: expect.any(Number) })
  })

  it('serves the standalone kiosk bundle with an SPA fallback', async () => {
    const staticDir = mkdtempSync(join(tmpdir(), 'osl-kiosk-'))
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>OpenSkyLight</title>')
    writeFileSync(join(staticDir, 'app.js'), 'console.log("kiosk")')
    try {
      const server = createHeadlessServer({ host: '127.0.0.1', port: 0, staticDir })
      servers.push(server)
      const started = await server.start()
      await expect(fetch(`${started.url}/`).then((response) => response.text())).resolves.toContain('OpenSkyLight')
      await expect(fetch(`${started.url}/calendar/week`).then((response) => response.text())).resolves.toContain('OpenSkyLight')
      await expect(fetch(`${started.url}/app.js`).then((response) => response.text())).resolves.toContain('console.log')
    } finally {
      rmSync(staticDir, { recursive: true, force: true })
    }
  })
})
