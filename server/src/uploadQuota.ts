import fs from 'node:fs/promises'
import path from 'node:path'
import type { Locator } from 'playwright'
import { SESSION_DIR } from './config.js'
import { atomicPrivateJson, withPrivateLock } from './privateState.js'

export const UPLOAD_LIMIT = 20
export const UPLOAD_WINDOW_MS = 60 * 60 * 1000
export class UploadLimitError extends Error {
  readonly code = 'upload_limit'
  constructor(readonly retryAt: number) { super(`20 uploads reserved in rolling hour. Next slot at ${new Date(retryAt).toISOString()}. Failed and uncertain transfers count.`); this.name = 'UploadLimitError' }
}
export function reserveInWindow(times: number[], now: number): number[] {
  if (!times.every(t => Number.isFinite(t) && t >= 0)) throw new Error('Upload ledger is invalid; refusing upload.')
  const recent = times.filter(t => t > now - UPLOAD_WINDOW_MS).sort((a,b) => a-b)
  if (recent.some(t => t > now)) throw new Error('Clock moved backwards or ledger has future reservations; refusing upload.')
  if (recent.length >= UPLOAD_LIMIT) throw new UploadLimitError(recent[0] + UPLOAD_WINDOW_MS)
  return [...recent, now]
}
/** Reserve before transfer; never refund an attempt after uncertain network outcome. */
export async function reserveUpload(): Promise<void> {
  await withPrivateLock(path.join(SESSION_DIR, 'uploads.lock'), async () => {
    const file = path.join(SESSION_DIR, 'uploads.json')
    let times: number[] = []
    try { times = JSON.parse(await fs.readFile(file, 'utf8')); if (!Array.isArray(times)) throw new Error('Invalid upload ledger.') }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    await atomicPrivateJson(file, reserveInWindow(times, Date.now()))
  })
}
export async function uploadFile(input: Locator, filePath: string): Promise<void> {
  await reserveUpload()
  await input.setInputFiles(filePath)
}
