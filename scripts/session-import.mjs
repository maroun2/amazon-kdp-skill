#!/usr/bin/env node
/**
 * Import a Playwright storage_state file captured on a machine that has a browser.
 *
 * Usage: npm run session:import -- /path/to/kdp-storage-state.json
 *
 * Validates the shape, installs it at the session path with mode 0600, and
 * reports which Amazon domains it covers. Never prints cookie values.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { sessionFilePath, withSessionOperation } from '../server/src/session.js'
import { atomicPrivateJson } from '../server/src/privateState.js'

const REQUIRED_DOMAINS = ['amazon.com']

const src = process.argv[2]
if (!src) {
  console.error('usage: npm run session:import -- <storage-state.json>')
  process.exit(2)
}

let raw
try {
  raw = await fs.readFile(src, 'utf8')
} catch (e) {
  console.error(`Cannot read ${src}: ${e.message}`)
  process.exit(1)
}

let state
try {
  state = JSON.parse(raw)
} catch {
  console.error(
    `${src} is not valid JSON. It must be a Playwright storage_state file ` +
      '(an object with "cookies" and "origins" arrays), not a cookies.txt or HAR export.',
  )
  process.exit(1)
}

if (!Array.isArray(state.cookies)) {
  console.error(
    'Missing a "cookies" array — this is not a Playwright storage_state file. ' +
      'See docs/HEADLESS-LOGIN.md for how to produce one.',
  )
  process.exit(1)
}
if (!Array.isArray(state.origins)) {
  // Playwright accepts a missing origins list; normalise it so it round-trips.
  state.origins = []
}

const domains = [...new Set(state.cookies.map((c) => String(c.domain || '')))]
const amazon = domains.filter((d) => REQUIRED_DOMAINS.some((r) => d.endsWith(r)))
if (amazon.length === 0) {
  console.error(
    `No amazon.com cookies found (saw ${domains.length} domain(s)). ` +
      'Capture the state while signed in to https://kdp.amazon.com.',
  )
  process.exit(1)
}

const hasSessionCookie = state.cookies.some((c) =>
  /^(session-id|at-main|sess-at-main|x-main|ubid-main)$/.test(String(c.name)),
)
if (!hasSessionCookie) {
  console.error(
    'None of the expected Amazon sign-in cookies are present ' +
      '(session-id / at-main / sess-at-main / x-main / ubid-main). ' +
      'The capture was probably taken while signed out.',
  )
  process.exit(1)
}

const dest = sessionFilePath()
const dir = path.dirname(dest)
await fs.mkdir(dir, { recursive: true, mode: 0o700 })
await fs.chmod(dir, 0o700).catch(() => {})
await withSessionOperation(() => atomicPrivateJson(dest, state))

// Cookie expiries tell the operator how long this will last. Values are never printed.
const expiries = state.cookies
  .map((c) => Number(c.expires))
  .filter((n) => Number.isFinite(n) && n > 0)
const soonest = expiries.length > 0 ? Math.min(...expiries) : null

console.log(`Imported ${state.cookies.length} cookies across ${domains.length} domain(s).`)
console.log(`Amazon domains covered: ${amazon.join(', ')}`)
console.log(`Installed: ${dest} (mode 0600)`)
if (soonest) {
  const when = new Date(soonest * 1000)
  const days = Math.round((when.getTime() - Date.now()) / 86_400_000)
  console.log(`Earliest cookie expiry: ${when.toISOString()} (~${days} day(s))`)
}
console.log('Next: npm run session:verify')
