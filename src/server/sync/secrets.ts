import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import type Database from 'better-sqlite3'

const VERSION = 'v1'

export class SecretError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretError'
  }
}

/**
 * The application's own encryption key, generated on first use and stored
 * beside SQLite with owner-only permissions. Backups must include both files:
 * the database alone cannot decrypt stored calendar credentials.
 */
export function applicationKey(sqlite: Database.Database): Buffer {
  const databaseName = sqlite.name
  if (!databaseName || databaseName === ':memory:') throw new SecretError('Calendar credentials require a persistent SQLite database.')
  const path = `${databaseName}.app-key`
  try {
    const key = readFileSync(path)
    if (key.length !== 32) throw new Error('invalid key length')
    return key
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') throw new SecretError('Application key could not be read.')
    const key = randomBytes(32)
    writeFileSync(path, key, { flag: 'wx', mode: 0o600 })
    chmodSync(path, 0o600)
    return key
  }
}

/** Versioned AES-256-GCM envelope bound to the owning source by AAD. */
export function encryptSecret(key: Buffer, sourceId: string, plaintext: string): Buffer {
  if (key.length !== 32) throw new SecretError('Application key must be 32 bytes.')
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from(sourceId, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.from([VERSION, nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.'), 'utf8')
}

export function decryptSecret(key: Buffer, sourceId: string, envelope: Buffer): string {
  const [version, nonce, tag, ciphertext, extra] = envelope.toString('utf8').split('.')
  if (version !== VERSION || !nonce || !tag || !ciphertext || extra !== undefined) {
    throw new SecretError('Stored credential envelope version is unsupported.')
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url'))
    decipher.setAAD(Buffer.from(sourceId, 'utf8'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    throw new SecretError('Stored credential could not be authenticated.')
  }
}
