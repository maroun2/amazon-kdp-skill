import fs from 'node:fs/promises'
import path from 'node:path'
import type { BrowserContext } from 'playwright'
import { atomicPrivateJson, withPrivateLock } from './privateState.js'
import { SESSION_DIR, SESSION_FILE } from './config.js'

export async function sessionExists(): Promise<boolean> {
  try {
    await fs.access(SESSION_FILE)
    return true
  } catch {
    return false
  }
}

export async function ensureSessionDir(): Promise<void> {
  await fs.mkdir(SESSION_DIR, { recursive: true, mode: 0o700 })
  // mkdir's mode is masked by the umask, and an existing dir keeps its old mode.
  await fs.chmod(SESSION_DIR, 0o700).catch(() => {})
}

/**
 * The session file is a live Amazon login. Playwright writes it 0644, so tighten
 * it every time we touch it.
 */
export async function secureSessionFile(): Promise<void> {
  await fs.chmod(SESSION_FILE, 0o600).catch(() => {})
}

/** True when the session file is not readable by group or other. */
export async function sessionFileIsPrivate(): Promise<boolean> {
  try {
    const stat = await fs.stat(SESSION_FILE)
    return (stat.mode & 0o077) === 0
  } catch {
    return false
  }
}

export async function removeSession(): Promise<void> {
  try {
    await fs.unlink(SESSION_FILE)
  } catch {
    /* no session file */
  }
}

export async function readSessionMeta(): Promise<{
  savedAt: string | null
}> {
  if (!(await sessionExists())) {
    return { savedAt: null }
  }
  try {
    const stat = await fs.stat(SESSION_FILE)
    return { savedAt: stat.mtime.toISOString() }
  } catch {
    return { savedAt: null }
  }
}

export function sessionFilePath(): string {
  return SESSION_FILE
}

/** Clear authentication without deleting tunnel configuration, locks or upload ledger. */
export async function clearSessionDir(): Promise<void> {
  await withSessionOperation(removeSession)
}

/** Serialize login and all saved-session users across server and CLI processes. */
export async function withSessionOperation<T>(fn: () => Promise<T>): Promise<T> {
  await ensureSessionDir()
  return withPrivateLock(path.join(SESSION_DIR, 'session.lock'), fn)
}

/** Called only after successful authenticated operations; failures keep prior state. */
export async function saveSession(context: BrowserContext): Promise<void> {
  await atomicPrivateJson(SESSION_FILE, await context.storageState({ indexedDB: true }))
}
