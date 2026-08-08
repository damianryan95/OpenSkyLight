import Database from 'better-sqlite3'
import { runMigrations } from './migrations'

export interface ServerDatabase {
  sqlite: Database.Database
  close(): void
}

/**
 * Opens the sole server-owned database from a host-local persistent volume.
 * Network filesystems are unsupported because SQLite WAL depends on reliable
 * local locking semantics.
 */
export function openServerDatabase(path: string): ServerDatabase {
  const sqlite = new Database(path)
  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('busy_timeout = 5000')
    runMigrations(sqlite)
  } catch (error) {
    sqlite.close()
    throw error
  }

  return { sqlite, close: () => sqlite.close() }
}
