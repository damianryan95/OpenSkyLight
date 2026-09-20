import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type Database from 'better-sqlite3'
import { DomainValidationError } from './errors'

export type MediaKind = 'celebration' | 'photo'
export interface CelebrationMedia { id: string; originalName: string; mediaType: 'image/png' | 'image/gif' | 'image/webp' | 'image/jpeg'; byteSize: number; width: number; height: number; frameCount: number; createdAt: string }
interface MediaRow extends CelebrationMedia { storage_key: string; kind: MediaKind }
const MAX_DIMENSION = 4096; const MAX_FRAMES = 600

export function createMediaService(sqlite: Database.Database, mediaDirectory: string) {
  mkdirSync(mediaDirectory, { recursive: true })
  const toAsset = (row: MediaRow): CelebrationMedia => ({ id: row.id, originalName: row.originalName, mediaType: row.mediaType, byteSize: row.byteSize, width: row.width, height: row.height, frameCount: row.frameCount, createdAt: row.createdAt })
  const COLUMNS = 'id, original_name AS originalName, media_type AS mediaType, byte_size AS byteSize, width, height, frame_count AS frameCount, created_at AS createdAt, storage_key, kind'
  const active = sqlite.prepare<[string], MediaRow>(`SELECT ${COLUMNS} FROM media_assets WHERE id = ? AND deleted_at IS NULL`)
  function list(kind: MediaKind = 'celebration'): CelebrationMedia[] { return sqlite.prepare<[string], MediaRow>(`SELECT ${COLUMNS} FROM media_assets WHERE kind = ? AND deleted_at IS NULL ORDER BY created_at DESC`).all(kind).map(toAsset) }
  function listPhotos(): CelebrationMedia[] { return list('photo') }
  async function upload(input: { bytes: Buffer; contentType: string | undefined; originalName: string | undefined; kind?: MediaKind }): Promise<CelebrationMedia> {
    const kind: MediaKind = input.kind ?? 'celebration'
    const inspected = inspectImage(input.bytes)
    if (input.contentType?.split(';')[0].trim().toLowerCase() !== inspected.mediaType) throw new DomainValidationError('The file type does not match its image data.')
    const sha256 = createHash('sha256').update(input.bytes).digest('hex')
    const duplicate = sqlite.prepare<[string, string], MediaRow>(`SELECT ${COLUMNS} FROM media_assets WHERE kind = ? AND sha256 = ? AND deleted_at IS NULL`).get(kind, sha256)
    if (duplicate) return toAsset(duplicate)
    const id = randomUUID(), extension = inspected.mediaType.split('/')[1], storageKey = `${sha256}.${extension}`, target = join(mediaDirectory, storageKey)
    try { await writeFile(target, input.bytes, { flag: 'wx' }) } catch (error: unknown) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error }
    const now = new Date().toISOString(); const originalName = safeName(input.originalName)
    try { sqlite.prepare('INSERT INTO media_assets (id, kind, original_name, media_type, byte_size, width, height, frame_count, sha256, storage_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, kind, originalName, inspected.mediaType, input.bytes.length, inspected.width, inspected.height, inspected.frameCount, sha256, storageKey, now) }
    catch (error) { await unlink(target).catch(() => undefined); throw error }
    return { id, originalName, mediaType: inspected.mediaType, byteSize: input.bytes.length, width: inspected.width, height: inspected.height, frameCount: inspected.frameCount, createdAt: now }
  }
  async function remove(id: string): Promise<void> {
    const row = active.get(id); if (!row) throw new DomainValidationError('Media asset not found.')
    if (row.kind === 'celebration') {
      const references = sqlite.prepare<[string, string], { count: number }>("SELECT COUNT(*) AS count FROM people WHERE (celebration_asset_id = ? OR EXISTS (SELECT 1 FROM json_each(people.celebration_asset_ids) WHERE value = ?)) AND deleted_at IS NULL").get(id, id)!.count
      if (references > 0) throw new DomainValidationError('This celebration is still assigned to a person.')
    }
    sqlite.prepare('DELETE FROM media_assets WHERE id = ?').run(id)
    await unlink(join(mediaDirectory, row.storage_key)).catch(() => undefined)
  }
  function file(id: string): { path: string; mediaType: string; byteSize: number } | undefined { const row = active.get(id); return row && { path: join(mediaDirectory, row.storage_key), mediaType: row.mediaType, byteSize: row.byteSize } }
  /** What a registered display may fetch: any photo, or a celebration that is actually assigned to someone. */
  function assignedFile(id: string) {
    const row = active.get(id); if (!row) return undefined
    const asset = { path: join(mediaDirectory, row.storage_key), mediaType: row.mediaType, byteSize: row.byteSize }
    if (row.kind === 'photo') return asset
    return sqlite.prepare<[string], { id: string }>('SELECT p.id FROM people p, json_each(p.celebration_asset_ids) selected WHERE selected.value = ? AND p.deleted_at IS NULL LIMIT 1').get(id) ? asset : undefined
  }
  return { list, listPhotos, upload, remove, file, assignedFile }
}

function safeName(value: string | undefined): string { const name = basename(value ?? 'upload').replace(/[\x00-\x1f]/g, '').trim(); return (name || 'upload').slice(0, 140) }
function invalid(): never { throw new DomainValidationError('The uploaded file is not a supported, valid PNG, JPEG, GIF, or WebP image.') }

/**
 * Family photos are overwhelmingly JPEG, so the screensaver needs it even
 * though celebrations never did. Dimensions come from the first SOF frame
 * header; the segment walk also proves the file is structurally a JPEG rather
 * than something merely starting with its magic bytes.
 */
function inspectJpeg(bytes: Buffer): { width: number; height: number } {
  let i = 2
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) invalid()
    const marker = bytes[i + 1]
    // Standalone markers carry no length payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
    const length = bytes.readUInt16BE(i + 2)
    if (length < 2 || i + 2 + length > bytes.length) invalid()
    // SOF0-SOF15, excluding the non-frame DHT/JPG/DAC markers.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 7) invalid()
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) }
    }
    i += 2 + length
  }
  return invalid()
}
function inspectImage(bytes: Buffer): { mediaType: 'image/png' | 'image/gif' | 'image/webp' | 'image/jpeg'; width: number; height: number; frameCount: number } {
  let result: { mediaType: 'image/png' | 'image/gif' | 'image/webp' | 'image/jpeg'; width: number; height: number; frameCount: number }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) { const jpeg = inspectJpeg(bytes); result = { mediaType: 'image/jpeg', width: jpeg.width, height: jpeg.height, frameCount: 1 } }
  else if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) { if (bytes.length < 45 || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.toString('ascii', bytes.length - 8, bytes.length - 4) !== 'IEND') invalid(); result = { mediaType: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), frameCount: 1 } }
  else if (bytes.toString('ascii', 0, 6) === 'GIF87a' || bytes.toString('ascii', 0, 6) === 'GIF89a') {
    if (bytes.length < 14) invalid()
    let i = 13; let frames = 0
    // Skip the global colour table before parsing GIF blocks. Counting raw
    // 0x2c bytes is wrong because LZW-compressed image data contains them too.
    if ((bytes[10] & 0x80) !== 0) i += 3 * (1 << ((bytes[10] & 0x07) + 1))
    while (i < bytes.length) {
      const marker = bytes[i++]
      if (marker === 0x3b) { if (i !== bytes.length) invalid(); break }
      if (marker === 0x21) { if (i >= bytes.length) invalid(); i += 1; i = skipGifSubBlocks(bytes, i); continue }
      if (marker !== 0x2c || i + 9 > bytes.length) invalid()
      const packed = bytes[i + 8]; i += 9
      if ((packed & 0x80) !== 0) i += 3 * (1 << ((packed & 0x07) + 1))
      if (i >= bytes.length) invalid()
      i += 1 // LZW minimum code size
      i = skipGifSubBlocks(bytes, i); frames += 1
    }
    if (i !== bytes.length || frames === 0) invalid()
    result = { mediaType: 'image/gif', width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8), frameCount: frames }
  }
  else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') { let width = 0, height = 0, frames = 0; for (let i = 12; i + 8 <= bytes.length;) { const kind = bytes.toString('ascii', i, i + 4), length = bytes.readUInt32LE(i + 4), start = i + 8; if (start + length > bytes.length) invalid(); if (kind === 'VP8X' && length >= 10) { width = 1 + bytes.readUIntLE(start + 4, 3); height = 1 + bytes.readUIntLE(start + 7, 3) } if (kind === 'ANMF') frames += 1; i = start + length + (length % 2) } result = { mediaType: 'image/webp', width, height, frameCount: Math.max(1, frames) } }
  else invalid()
  if (!Number.isInteger(result.width) || !Number.isInteger(result.height) || result.width < 1 || result.height < 1 || result.width > MAX_DIMENSION || result.height > MAX_DIMENSION || result.frameCount < 1 || result.frameCount > MAX_FRAMES) throw new DomainValidationError('Image dimensions or animation frames exceed the allowed limit.')
  return result
}
function skipGifSubBlocks(bytes: Buffer, offset: number): number { let i = offset; while (i < bytes.length) { const length = bytes[i++]; if (length === 0) return i; if (i + length > bytes.length) invalid(); i += length } return invalid() }
export type MediaService = ReturnType<typeof createMediaService>
