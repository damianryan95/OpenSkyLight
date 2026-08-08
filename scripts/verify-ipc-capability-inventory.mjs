import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const contract = readFileSync(resolve(root, 'src/shared/ipc/contract.ts'), 'utf8')
const inventory = readFileSync(resolve(root, 'docs/ipc-capability-inventory.md'), 'utf8')
const invokeInventory = inventory.split('## One-way Electron push channels')[0]

const contractChannels = [...contract.matchAll(/^  '([^']+)':/gm)].map((match) => match[1])
const inventoryRows = [...invokeInventory.matchAll(/^\| `([^`]+)` \| ([a-z-]+) \|/gm)]
const inventoryChannels = inventoryRows.map((match) => match[1])
const dispositions = new Set([
  'display-read',
  'display-chore-write',
  'parent-write',
  'obsolete-event-write',
  'obsolete-feature'
])

const errors = []
for (const channel of contractChannels) {
  const count = inventoryChannels.filter((candidate) => candidate === channel).length
  if (count !== 1) errors.push(`${channel}: expected exactly one inventory row, found ${count}`)
}
for (const channel of inventoryChannels) {
  if (!contractChannels.includes(channel)) errors.push(`${channel}: not an IpcContract channel`)
}
for (const [, channel, disposition] of inventoryRows) {
  if (!dispositions.has(disposition)) errors.push(`${channel}: invalid disposition ${disposition}`)
}

if (errors.length > 0) {
  console.error('IPC capability inventory verification failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log(`IPC capability inventory verified: ${contractChannels.length} contract channels, each exactly once.`)
}
