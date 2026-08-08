import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright-core'

const root = join(import.meta.dirname, '../out/companion')
let configured = false; let session = false; let nextId = 1
const lists = []; const meals = []
const json = (response, status, body) => { response.setHeader('content-type', 'application/json'); response.writeHead(status).end(JSON.stringify(body)) }
const readBody = async (request) => { let body = ''; for await (const chunk of request) body += chunk; return body ? JSON.parse(body) : {} }
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost'); const hasSession = session && request.headers.cookie?.includes('osl_parent_session=test')
  if (url.pathname === '/api/v1/auth/status') return json(response, 200, { configured, authenticated: hasSession, expiresAt: null })
  if (url.pathname === '/api/v1/auth/setup' && request.method === 'POST') { configured = session = true; response.setHeader('set-cookie', 'osl_parent_session=test; Path=/api/v1'); return json(response, 201, { csrfToken: 'csrf', expiresAt: '2030-01-01T00:00:00.000Z' }) }
  if (!hasSession && url.pathname.startsWith('/api/v1/')) return json(response, 401, { error: { code: 'unauthorized', message: 'Parent session is required' } })
  if (url.pathname === '/api/v1/lists' && request.method === 'GET') return json(response, 200, { lists })
  if (url.pathname === '/api/v1/lists' && request.method === 'POST') { const input = await readBody(request); const list = { id: `list-${nextId++}`, ...input, items: [] }; lists.push(list); return json(response, 201, list) }
  const items = /^\/api\/v1\/lists\/([^/]+)\/items$/.exec(url.pathname)
  if (items && request.method === 'POST') { const list = lists.find((value) => value.id === items[1]); const input = await readBody(request); const item = { id: `item-${nextId++}`, text: input.text, checked: false, sortOrder: list.items.length }; list.items.push(item); return json(response, 201, item) }
  if (url.pathname === '/api/v1/meals' && request.method === 'GET') return json(response, 200, { meals })
  const meal = /^\/api\/v1\/meals\/(\d{4}-\d{2}-\d{2})\/(\w+)$/.exec(url.pathname)
  if (meal && request.method === 'PUT') { const input = await readBody(request); const index = meals.findIndex((value) => value.date === meal[1] && value.slot === meal[2]); if (input.text) { const value = { date: meal[1], slot: meal[2], text: input.text.trim() }; index < 0 ? meals.push(value) : meals.splice(index, 1, value) } return response.writeHead(204).end() }
  // This is the kiosk's intentionally read-only display query: phone mutations
  // become visible here, while no matching mutation route is exposed.
  if (url.pathname === '/api/rpc/lists%3AgetAll' && request.method === 'POST') return json(response, 200, { ok: true, data: lists })
  const file = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^\/+/, ''); if (file.includes('..')) return response.writeHead(403).end()
  try { const content = await readFile(join(root, file)); response.setHeader('content-type', { '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' }[extname(file)] ?? 'text/html'); response.writeHead(200).end(content) } catch { response.writeHead(404).end() }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); await page.goto(`http://127.0.0.1:${address.port}`)
  await page.getByLabel('Household PIN').fill('1234'); await page.getByRole('button', { name: 'Create PIN and continue' }).click(); await page.getByRole('button', { name: 'Planning', exact: true }).click()
  await page.getByRole('button', { name: 'Add list' }).click(); await page.getByPlaceholder('List name').fill('Groceries'); await page.getByRole('button', { name: 'Create list' }).click(); await page.getByPlaceholder('Add an item').fill('Milk'); await page.getByRole('button', { name: 'Add', exact: true }).click(); await page.getByText('Milk').waitFor()
  await page.getByText('Add…').first().click(); await page.getByPlaceholder("What's cooking?").fill('Tacos'); await page.getByRole('button', { name: 'Save', exact: true }).click()
  const display = await fetch(`http://127.0.0.1:${address.port}/api/rpc/lists%3AgetAll`, { method: 'POST' }).then((response) => response.json())
  if (display.data[0]?.items[0]?.text !== 'Milk' || meals[0]?.text !== 'Tacos') throw new Error('planning changes did not reach display data')
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('planning page overflows a 390px phone viewport')
  console.log('PHONE PLANNING E2E PASS: list/item and meal update reached display read data')
} finally { await browser.close(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
