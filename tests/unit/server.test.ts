import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHeadlessServer, kioskBuildIdFor, type HeadlessServer } from '../../src/server/server'

const servers: HeadlessServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()))
})

describe('the kiosk bundle digest a display reloads on', () => {
  it('changes when the served bundle changes, and only then', () => {
    const first = mkdtempSync(join(tmpdir(), 'osl-build-a-'))
    const second = mkdtempSync(join(tmpdir(), 'osl-build-b-'))
    try {
      writeFileSync(join(first, 'index.html'), '<script src="/assets/index-AAAA.js"></script>')
      writeFileSync(join(second, 'index.html'), '<script src="/assets/index-AAAA.js"></script>')
      // Same bundle in two places is the same build.
      expect(kioskBuildIdFor(first)).toBe(kioskBuildIdFor(second))
      // A rebuilt bundle renames its hashed assets, so the digest moves.
      writeFileSync(join(second, 'index.html'), '<script src="/assets/index-BBBB.js"></script>')
      expect(kioskBuildIdFor(second)).not.toBe(kioskBuildIdFor(first))
      // No bundle served at all — domain-only tests — reports nothing rather
      // than inventing a value the display would then reload on.
      expect(kioskBuildIdFor(undefined)).toBeUndefined()
      expect(kioskBuildIdFor(join(first, 'does-not-exist'))).toBeUndefined()
    } finally {
      rmSync(first, { recursive: true, force: true })
      rmSync(second, { recursive: true, force: true })
    }
  })
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
