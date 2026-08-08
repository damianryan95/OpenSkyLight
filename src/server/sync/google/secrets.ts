import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'

const VERSION = 'v1'

export class GoogleSecretConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoogleSecretConfigurationError'
  }
}

function b64url(value: Buffer): string {
  return value.toString('base64url')
}

function fromB64url(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}

/** Reads operator-mounted secrets only; database values never contain these secrets. */
export function readGoogleSecret(path: string): string {
  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(path)
  } catch {
    throw new GoogleSecretConfigurationError('Google secret mount is unavailable.')
  }
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new GoogleSecretConfigurationError('Google secret mount must be a private regular file.')
  }
  const value = readFileSync(path, 'utf8').trim()
  if (!value) throw new GoogleSecretConfigurationError('Google secret mount is empty.')
  return value
}

export function readGoogleTokenEncryptionKey(path: string): Buffer {
  const key = Buffer.from(readGoogleSecret(path), 'base64')
  if (key.length !== 32) throw new GoogleSecretConfigurationError('Google token encryption key must decode to exactly 32 bytes.')
  return key
}

/** Versioned AES-256-GCM envelope with household/account binding as AAD. */
export function encryptRefreshToken(key: Buffer, householdId: string, accountId: string, token: string): Buffer {
  if (key.length !== 32) throw new GoogleSecretConfigurationError('Google token encryption key must be 32 bytes.')
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from(`${householdId}:${accountId}`, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return Buffer.from(`${VERSION}.${b64url(nonce)}.${b64url(cipher.getAuthTag())}.${b64url(ciphertext)}`, 'utf8')
}

export function decryptRefreshToken(key: Buffer, householdId: string, accountId: string, envelope: Buffer): string {
  const [version, nonceText, tagText, ciphertextText, extra] = envelope.toString('utf8').split('.')
  if (version !== VERSION || !nonceText || !tagText || !ciphertextText || extra) {
    throw new GoogleSecretConfigurationError('Google token envelope version is unsupported.')
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, fromB64url(nonceText))
    decipher.setAAD(Buffer.from(`${householdId}:${accountId}`, 'utf8'))
    decipher.setAuthTag(fromB64url(tagText))
    return Buffer.concat([decipher.update(fromB64url(ciphertextText)), decipher.final()]).toString('utf8')
  } catch {
    throw new GoogleSecretConfigurationError('Google token envelope could not be authenticated.')
  }
}
