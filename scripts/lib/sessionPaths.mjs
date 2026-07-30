/**
 * Session paths for plain-node scripts, mirroring server/src/config.ts.
 * Kept dependency-free so it works before/without tsx.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export function sessionDir() {
  const explicit = process.env.KDP_SESSION_DIR
  if (explicit && explicit.trim() !== '') return path.resolve(explicit)

  const legacy = path.join(repoRoot, '.kdp-session')
  if (fs.existsSync(path.join(legacy, 'amazon-kdp.json'))) return legacy

  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(base, 'amazon-kdp-skill')
}

export function sessionFilePath() {
  return path.join(sessionDir(), 'amazon-kdp.json')
}
