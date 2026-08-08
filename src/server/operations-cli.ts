import { backupDatabase, inspectDatabase, restoreDatabase } from './operations'
import { safeLogErrorMessage } from './logging'

type Operation = 'backup' | 'restore' | 'inspect'

function usage(): never {
  throw new Error('Usage: operations-cli <backup|restore|inspect> <path> [destination]')
}

async function main(args: string[]): Promise<void> {
  const [operation, firstPath, secondPath, ...extra] = args as [Operation | undefined, string | undefined, string | undefined, ...string[]]
  if (operation === undefined || firstPath === undefined || extra.length > 0) usage()
  let result
  switch (operation) {
    case 'backup':
      if (secondPath === undefined) usage()
      result = await backupDatabase(firstPath, secondPath)
      break
    case 'restore':
      if (secondPath === undefined) usage()
      result = await restoreDatabase(firstPath, secondPath)
      break
    case 'inspect':
      if (secondPath !== undefined) usage()
      result = inspectDatabase(firstPath)
      break
    default:
      usage()
  }
  console.info(JSON.stringify({ event: `database.${operation}`, ...result }))
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(JSON.stringify({ event: 'database.operation_failed', error: safeLogErrorMessage(error) }))
  process.exitCode = 1
})
