#!/usr/bin/env node
/**
 * Mint a one-shot approval ticket for an irreversible KDP operation.
 *
 *   npm run approve -- delete B0XXXXXXX paperback
 *   npm run approve -- publish new paperback --ttl 30
 *
 * Prints a token. Send it back as "approval" in the request body. The ticket is
 * bound to this exact action, book and format, is consumed on first use, and
 * expires (default 10 minutes).
 */
import {
  APPROVAL_ACTIONS,
  DEFAULT_TTL_MS,
  isApprovalAction,
  mintApproval,
} from '../server/src/approvals.js'

const [action, titleId, format] = process.argv.slice(2)
const ttlIndex = process.argv.indexOf('--ttl')
const ttlMinutes = ttlIndex >= 0 ? Number(process.argv[ttlIndex + 1]) : null

function usage(message: string): never {
  console.error(message)
  console.error('')
  console.error('usage: npm run approve -- <action> <titleId|new> <format> [--ttl MINUTES]')
  console.error(`  action: ${APPROVAL_ACTIONS.join(' | ')}`)
  console.error('  format: kindle | paperback | hardcover')
  process.exit(2)
}

if (!action || !titleId || !format) usage('Missing arguments.')
if (!isApprovalAction(action)) usage(`Unknown action "${action}".`)
if (!['kindle', 'paperback', 'hardcover'].includes(format)) {
  usage(`Unknown format "${format}".`)
}
if (ttlIndex >= 0 && (!Number.isFinite(ttlMinutes) || (ttlMinutes ?? 0) <= 0)) {
  usage('--ttl expects a positive number of minutes.')
}

const ttlMs = ttlMinutes ? ttlMinutes * 60_000 : DEFAULT_TTL_MS
const { token, expiresAt } = await mintApproval({ action, titleId, format, ttlMs })

console.log(`Approved: ${action} ${titleId} ${format}`)
console.log(`Expires:  ${expiresAt} (${Math.round(ttlMs / 60_000)} min)`)
console.log(`Single use: the ticket is consumed by the first matching request.`)
console.log('')
console.log(`approval: ${token}`)
