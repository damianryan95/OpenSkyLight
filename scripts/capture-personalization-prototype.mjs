import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const port = 4176
const baseUrl = `http://127.0.0.1:${port}/?prototype=personalization`
const outputDirectory = new URL('../docs/screenshots/personalization/', import.meta.url)
const outputPath = fileURLToPath(outputDirectory)
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const mode = process.argv[2] ?? 'all'
if (!['all', 'kiosk', 'phone', 'reduced-motion'].includes(mode)) throw new Error('Use one of: all, kiosk, phone, reduced-motion')
const server = spawn(npm, ['run', 'dev:kiosk', '--', '--host', '127.0.0.1', '--port', String(port)], { stdio: 'inherit' })

try {
  await waitForServer()
  await mkdir(outputDirectory, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    if (mode === 'all' || mode === 'kiosk') {
      for (const { name, width, height } of [
        { name: 'kiosk-1280x800', width: 1280, height: 800 },
        { name: 'kiosk-1920x1080', width: 1920, height: 1080 },
        { name: 'kiosk-2400x900', width: 2400, height: 900 }
      ]) {
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
        await page.getByRole('button', { name: "Show Minecraft's view" }).click()
        await page.getByRole('button', { name: 'Preview celebration' }).click()
        await page.screenshot({ path: `${outputPath}${name}.png`, animations: 'disabled' })
        await page.close()
      }
    }

    if (mode === 'all' || mode === 'phone') {
      const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
      await phone.goto(baseUrl, { waitUntil: 'domcontentloaded' })
      await phone.locator('.prototype-theme-frozen').click()
      await phone.screenshot({ path: `${outputPath}phone-390x844.png`, animations: 'disabled' })
      await phone.close()
    }

    if (mode === 'all' || mode === 'reduced-motion') {
      const reduced = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
      await reduced.goto(baseUrl, { waitUntil: 'domcontentloaded' })
      await reduced.getByRole('button', { name: 'Reduce motion' }).click()
      await reduced.getByRole('button', { name: 'Complete feed cat +2 ★' }).click()
      await reduced.screenshot({ path: `${outputPath}kiosk-1280x800-reduced-motion.png`, animations: 'disabled' })
      await reduced.close()
    }
  } finally {
    await browser.close()
  }
  console.info('Personalization prototype screenshots captured.')
} finally {
  server.kill('SIGTERM')
}

async function waitForServer() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl)
      if (response.ok) return
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Timed out waiting for ${baseUrl}`)
}
