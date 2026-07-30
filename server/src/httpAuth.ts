import crypto from 'node:crypto'
import type express from 'express'
import { ALLOWED_ORIGINS, API_TOKEN, BIND_HOST } from './config.js'

/**
 * Two guards on the way in.
 *
 * This server holds a live, MFA-satisfied Amazon session and can delete a
 * published book. Upstream it listened on every interface with no auth and an
 * any-origin CORS policy, which made "anyone who can reach port 3001" and "any
 * website the operator has open" equivalent to the account owner.
 */

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

export function isLoopbackBind(host: string): boolean {
  return LOOPBACK.has(host)
}

/** Timing-safe compare that does not leak length. */
function tokenMatches(presented: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(presented).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

function presentedToken(req: express.Request): string | null {
  const auth = req.get('authorization')
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim()
  const header = req.get('x-kdp-token')
  if (header) return header.trim()
  return null
}

/**
 * Refuse to start in a configuration that exposes the account to the network.
 * Called before listen() so a mistake is a startup failure, not a quiet risk.
 */
export function assertSafeBindConfig(): void {
  if (!isLoopbackBind(BIND_HOST) && !API_TOKEN) {
    throw new Error(
      [
        `Refusing to start: KDP_BIND_HOST is "${BIND_HOST}", which is reachable from` +
          ' the network, but KDP_API_TOKEN is not set.',
        '',
        'This server can publish and delete books on a live Amazon account. Either:',
        '  - bind loopback only (unset KDP_BIND_HOST, the default is 127.0.0.1), or',
        '  - set KDP_API_TOKEN to a long random secret and send it as',
        '    "Authorization: Bearer <token>" on every request.',
        '',
        'See docs/SECURITY-HARDENING.md',
      ].join('\n'),
    )
  }
}

/**
 * Reject cross-origin browser traffic outright.
 *
 * Without CORS headers a browser cannot read our responses, but a request can
 * still *arrive* and take effect. So an unexpected Origin is refused before any
 * handler runs, rather than merely having its response withheld.
 */
export function originGuard(): express.RequestHandler {
  return (req, res, next) => {
    const origin = req.get('origin')
    if (!origin) return next() // curl, fetch from Node, the CLI — no browser involved
    if (ALLOWED_ORIGINS.includes(origin)) return next()
    res.status(403).json({
      error:
        `Cross-origin request from "${origin}" refused. Add it to KDP_CORS_ORIGINS ` +
        'if this is intentional.',
      code: 'forbidden_origin',
    })
  }
}

/** Require the shared secret on every route when KDP_API_TOKEN is set. */
export function tokenGuard(): express.RequestHandler {
  return (req, res, next) => {
    if (!API_TOKEN) return next()
    const presented = presentedToken(req)
    if (presented && tokenMatches(presented, API_TOKEN)) return next()
    res.status(401).json({
      error:
        'Missing or invalid API token. Send "Authorization: Bearer <KDP_API_TOKEN>".',
      code: 'unauthorized',
    })
  }
}
