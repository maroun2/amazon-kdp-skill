import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { APPROVALS_FILE } from './config.js'
import { ensureSessionDir } from './session.js'

/**
 * One-shot approval tickets for irreversible KDP operations.
 *
 * Upstream, publish / unpublish / delete / archive executed the moment a request
 * arrived. The only gate was a sentence in SKILL.md asking the agent to check
 * with the user first — prose, in a file the agent may summarise away.
 *
 * A ticket is minted out of band (`npm run approve -- delete B0XXXX paperback`),
 * is bound to that exact action, titleId and format, expires, and is consumed on
 * first use. What this buys: a hallucinated or replayed destructive call fails
 * closed, the scope of an approval cannot drift to a different book, and every
 * live change leaves a record of a separate deliberate act.
 *
 * What it does NOT buy: proof that a human was present. Anything that can run
 * the API can usually run the mint command too. It raises the floor from "one
 * stray POST deletes a published book" to "two distinct, scoped, logged steps" —
 * that is the honest claim.
 */

export type ApprovalAction = 'publish' | 'unpublish' | 'delete' | 'archive'

export const APPROVAL_ACTIONS: readonly ApprovalAction[] = [
  'publish',
  'unpublish',
  'delete',
  'archive',
]

export const DEFAULT_TTL_MS = 10 * 60 * 1000

type Ticket = {
  token: string
  action: ApprovalAction
  titleId: string
  format: string
  createdAt: string
  expiresAt: string
  usedAt: string | null
}

type ApprovalsFile = {
  version: 1
  tickets: Ticket[]
}

const EMPTY: ApprovalsFile = { version: 1, tickets: [] }

export function isApprovalAction(value: unknown): value is ApprovalAction {
  return typeof value === 'string' && APPROVAL_ACTIONS.includes(value as ApprovalAction)
}

async function read(): Promise<ApprovalsFile> {
  try {
    const raw = await fs.readFile(APPROVALS_FILE, 'utf8')
    const parsed = JSON.parse(raw) as ApprovalsFile
    if (parsed?.version !== 1 || !Array.isArray(parsed.tickets)) return { ...EMPTY }
    return parsed
  } catch {
    return { ...EMPTY }
  }
}

async function write(data: ApprovalsFile): Promise<void> {
  await ensureSessionDir()
  // Keep spent tickets for a day so a replay reports "already used" rather than
  // "unknown", then drop them so the file cannot grow without bound.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  const tickets = data.tickets.filter((t) => new Date(t.expiresAt).getTime() > cutoff)
  await fs.writeFile(
    APPROVALS_FILE,
    `${JSON.stringify({ version: 1, tickets }, null, 2)}\n`,
    { mode: 0o600 },
  )
  await fs.chmod(APPROVALS_FILE, 0o600).catch(() => {})
}

export async function mintApproval(input: {
  action: ApprovalAction
  titleId: string
  format: string
  ttlMs?: number
}): Promise<{ token: string; expiresAt: string }> {
  const now = Date.now()
  const ttl = input.ttlMs && input.ttlMs > 0 ? input.ttlMs : DEFAULT_TTL_MS
  const ticket: Ticket = {
    token: crypto.randomBytes(24).toString('base64url'),
    action: input.action,
    titleId: input.titleId,
    format: input.format,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl).toISOString(),
    usedAt: null,
  }
  const data = await read()
  data.tickets.push(ticket)
  await write(data)
  return { token: ticket.token, expiresAt: ticket.expiresAt }
}

export class ApprovalRequiredError extends Error {
  readonly code = 'approval_required'
  constructor(
    readonly action: ApprovalAction,
    readonly titleId: string,
    readonly format: string,
    detail: string,
  ) {
    super(
      [
        `${detail}`,
        '',
        `This operation is irreversible on a live Amazon listing, so it needs an`,
        `approval ticket scoped to exactly this book. Mint one:`,
        '',
        `  npm run approve -- ${action} ${titleId} ${format}`,
        '',
        'then resend the request with the printed token as "approval".',
        'Tickets are single-use and expire. See docs/SECURITY-HARDENING.md',
      ].join('\n'),
    )
    this.name = 'ApprovalRequiredError'
  }
}

/**
 * Consume a ticket, or throw ApprovalRequiredError.
 * A ticket is valid for one action on one book, once, before it expires.
 */
export async function consumeApproval(input: {
  action: ApprovalAction
  titleId: string
  format: string
  token: unknown
}): Promise<void> {
  const { action, titleId, format } = input

  if (typeof input.token !== 'string' || input.token.trim() === '') {
    throw new ApprovalRequiredError(action, titleId, format, 'No approval ticket supplied.')
  }
  const token = input.token.trim()

  const data = await read()
  const ticket = data.tickets.find((t) => t.token === token)
  if (!ticket) {
    throw new ApprovalRequiredError(action, titleId, format, 'Unknown approval ticket.')
  }
  if (ticket.usedAt) {
    throw new ApprovalRequiredError(
      action,
      titleId,
      format,
      `That ticket was already used at ${ticket.usedAt}. Tickets are single-use.`,
    )
  }
  if (new Date(ticket.expiresAt).getTime() <= Date.now()) {
    throw new ApprovalRequiredError(
      action,
      titleId,
      format,
      `That ticket expired at ${ticket.expiresAt}.`,
    )
  }
  if (ticket.action !== action || ticket.titleId !== titleId || ticket.format !== format) {
    throw new ApprovalRequiredError(
      action,
      titleId,
      format,
      `That ticket approves ${ticket.action} on ${ticket.titleId} (${ticket.format}), ` +
        `not ${action} on ${titleId} (${format}). Approvals do not transfer between books.`,
    )
  }

  ticket.usedAt = new Date().toISOString()
  // write() drops used tickets, so this both records and retires it.
  await write(data)
}
