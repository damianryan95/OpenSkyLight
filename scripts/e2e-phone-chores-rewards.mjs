import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright-core'

const root = join(import.meta.dirname, '../out/companion')
let session = false; let configured = false
const people = [{ id: 'kid-1', name: 'Ari', color: '#0091ff', role: 'child' }]
const chores = []; const rewards = []; const redemptions = []
const json = (res, status, body) => { res.setHeader('content-type', 'application/json'); res.writeHead(status).end(JSON.stringify(body)) }
const body = async (req) => { let value = ''; for await (const chunk of req) value += chunk; return value ? JSON.parse(value) : {} }
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost'); const hasSession = session && req.headers.cookie?.includes('osl_parent_session=test')
  if (url.pathname === '/api/v1/auth/status') return json(res, 200, { configured, authenticated: Boolean(hasSession), expiresAt: null })
  if (url.pathname === '/api/v1/auth/setup' && req.method === 'POST') { configured = session = true; res.setHeader('set-cookie', 'osl_parent_session=test; Path=/api/v1'); return json(res, 201, { csrfToken: 'csrf', expiresAt: '2030-01-01T00:00:00.000Z' }) }
  if (!hasSession && url.pathname.startsWith('/api/v1/')) return json(res, 401, { error: { code: 'unauthorized', message: 'Parent session is required' } })
  if (url.pathname === '/api/v1/people') return json(res, 200, { people })
  if (url.pathname === '/api/v1/chores' && req.method === 'GET') return json(res, 200, { chores })
  if (url.pathname === '/api/v1/chores' && req.method === 'POST') { const input = await body(req); const chore = { id: `chore-${chores.length + 1}`, ...input, active: true }; chores.push(chore); return json(res, 201, chore) }
  const correction = /^\/api\/v1\/chores\/([^/]+)\/completion$/.exec(url.pathname)
  if (correction) return json(res, 200, { completionId: `completion-${correction[1]}`, balance: 2, created: true })
  if (url.pathname === '/api/v1/rewards' && req.method === 'GET') return json(res, 200, { rewards })
  if (url.pathname === '/api/v1/rewards' && req.method === 'POST') { const input = await body(req); const reward = { id: `reward-${rewards.length + 1}`, ...input, active: true }; rewards.push(reward); return json(res, 201, reward) }
  if (url.pathname === '/api/v1/reward-redemptions') return json(res, 200, { redemptions })
  if (url.pathname === '/api/v1/stars/adjustments') return json(res, 200, { balance: 2 })
  const requested = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^\/+/, ''); if (requested.includes('..')) return res.writeHead(403).end()
  try { const content = await readFile(join(root, requested)); res.setHeader('content-type', { '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' }[extname(requested)] ?? 'text/html'); res.writeHead(200).end(content) } catch { res.writeHead(404).end() }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); await page.goto(`http://127.0.0.1:${address.port}`)
  await page.getByLabel('Household PIN').fill('1234'); await page.getByRole('button', { name: 'Create PIN and continue' }).click(); await page.getByRole('button', { name: 'Chores', exact: true }).click()
  await page.getByRole('button', { name: 'Add chore' }).click(); await page.getByPlaceholder('Chore name').fill('Make bed'); await page.getByRole('button', { name: 'Save chore' }).click(); await page.getByText('Make bed').waitFor()
  await page.getByRole('button', { name: 'Correct history' }).click(); await page.getByRole('button', { name: 'Apply correction' }).click()
  await page.getByRole('button', { name: 'Add reward' }).click(); await page.getByPlaceholder('Reward name').fill('Movie'); await page.getByRole('button', { name: 'Save reward' }).click(); await page.getByText('Movie').waitFor()
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('phone chores page overflows viewport')
  console.log('PHONE CHORES E2E PASS: recurring chore, historical correction, reward, 390px viewport')
} finally { await browser.close(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
