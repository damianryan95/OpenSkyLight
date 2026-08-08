import Database from 'better-sqlite3'
import { constants, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { latestSchemaVersion } from './db/migrations'
import { openServerDatabase } from './db'

export interface DatabaseSnapshot {
  path: string
  schemaVersion: number
}

function assertDistinctPaths(sourcePath: string, destinationPath: string): void {
  if (resolve(sourcePath) === resolve(destinationPath)) throw new Error('Source and destination database paths must differ.')
}

/**
 * Creates a transactionally consistent SQLite snapshot. SQLite's backup API is
 * safe while the single server is running in WAL mode, unlike copying .db and
 * its sidecar files directly.
 */
export async function backupDatabase(sourcePath: string, destinationPath: string): Promise<DatabaseSnapshot> {
  assertDistinctPaths(sourcePath, destinationPath)
  if (!existsSync(sourcePath)) throw new Error(`Database does not exist: ${sourcePath}`)
  mkdirSync(dirname(destinationPath), { recursive: true })
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
  try {
    source.pragma('busy_timeout = 5000')
    await source.backup(destinationPath)
  } finally {
    source.close()
  }
  return inspectDatabase(destinationPath)
}

/**
 * Restores a snapshot only into a clean target path. The caller must stop the
 * active server first; refusing an existing target prevents an accidental live
 * overwrite and preserves rollback data.
 */
export async function restoreDatabase(snapshotPath: string, targetPath: string): Promise<DatabaseSnapshot> {
  assertDistinctPaths(snapshotPath, targetPath)
  if (!existsSync(snapshotPath)) throw new Error(`Backup does not exist: ${snapshotPath}`)
  if (existsSync(targetPath)) throw new Error(`Restore target already exists: ${targetPath}. Restore only into a clean volume.`)
  mkdirSync(dirname(targetPath), { recursive: true })
  // A backup snapshot is one self-contained SQLite file. Copy it exclusively
  // to the empty target; opening a read-only snapshot through SQLite's backup
  // API can require adjacent WAL/shm files on some bind-mounted filesystems.
  copyFileSync(snapshotPath, targetPath, constants.COPYFILE_EXCL)
  return inspectDatabase(targetPath)
}

/** Opens the snapshot through the normal migration path before it is trusted. */
export function inspectDatabase(path: string): DatabaseSnapshot {
  const database = openServerDatabase(path)
  try {
    const schemaVersion = database.sqlite.pragma('user_version', { simple: true }) as number
    if (schemaVersion !== latestSchemaVersion) throw new Error(`Database schema is not ready: ${schemaVersion}`)
    return { path: resolve(path), schemaVersion }
  } finally {
    database.close()
  }
}
