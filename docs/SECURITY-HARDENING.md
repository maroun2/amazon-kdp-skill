# Server hardening: who can reach this API, and what it may do without asking

This server holds a live, MFA-satisfied Amazon session. Through it, one HTTP
request can change a price, rewrite a listing, unpublish a book or delete a
published title. Three things about the original design made that riskier than
it needed to be, and all three are fixed here.

## 1. It listened on every interface, with no authentication

`app.listen(PORT)` with no host argument binds `0.0.0.0` and `::`, not loopback.
The middleware stack was `cors` and `express.json` — no auth of any kind. On a
VPS that means anyone who can reach port 3001 is, for practical purposes, the
account owner.

**Now:** loopback by default, and the process refuses to start in an unsafe
configuration.

```console
$ npm run server:start
KDP sync server listening on http://127.0.0.1:3001
  bind: loopback only
  api token: not set
  cross-origin: refused
  publish/unpublish/delete/archive: approval ticket required
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `KDP_BIND_HOST` | `127.0.0.1` | Interface to listen on |
| `KDP_API_TOKEN` | *(unset)* | Shared secret required on every request when set |

If you bind something reachable, a token becomes mandatory — not advisory:

```console
$ KDP_BIND_HOST=0.0.0.0 npm run server:start
Error: Refusing to start: KDP_BIND_HOST is "0.0.0.0", which is reachable from
the network, but KDP_API_TOKEN is not set.
```

The startup banner always states the actual posture, so a misconfiguration is
visible in the first five lines of output rather than discovered later.

### Using a token

```bash
export KDP_API_TOKEN="$(openssl rand -base64 32)"
npm run server:start
```

Every request must then carry it:

```bash
curl -H "Authorization: Bearer $KDP_API_TOKEN" http://127.0.0.1:3001/api/kdp/status
```

`X-KDP-Token: <token>` is accepted as an alternative. Comparison is timing-safe
over a hash of each side, so it leaks neither the value nor its length. The
bundled clients (`kdp-cli.mjs`, `publish-book.mjs`, `update-kdp-metadata.mjs`,
`test-all.mjs`) send the header automatically when `KDP_API_TOKEN` is in their
environment, so nothing else changes for you.

Keep the token out of the repo. Put it in your shell profile or `.env`, which is
already gitignored.

## 2. Any website could drive it

`cors({ origin: true, credentials: true })` echoes back whatever `Origin` the
caller sends and permits credentials. Combined with `express.json()` and plain
JSON `POST` bodies, that means a page open in the operator's browser — any page —
could issue requests to `localhost:3001` and have them take effect. There was no
CSRF token anywhere.

**Now:** cross-origin browser traffic is refused by default.

```console
$ curl -H "Origin: https://evil.com" http://127.0.0.1:3001/api/kdp/health
HTTP 403
{"error":"Cross-origin request from \"https://evil.com\" refused. …","code":"forbidden_origin"}
```

Two layers, deliberately:

- CORS is configured from `KDP_CORS_ORIGINS`, an explicit allowlist, empty by
  default. Nothing is reflected.
- An unexpected `Origin` is rejected **before any handler runs**. Withholding
  CORS response headers only stops the attacker *reading* the reply; the request
  would still have executed. Refusing it outright stops the write.

Requests with no `Origin` header — curl, Node `fetch`, the bundled CLIs — are
unaffected, because no browser is involved.

If you genuinely need a browser client:

```bash
KDP_CORS_ORIGINS=http://localhost:5173,https://your.tool npm run server:start
```

## 3. Publish and delete executed on arrival

This was the sharpest edge. `POST /api/kdp/titles/delete` parsed a body and
deleted. `POST /api/kdp/publish` parsed a body and published. `dryRun` defaulted
to `false`, so an *omitted* field meant a live write. The only thing standing
between a stray request and a deleted listing was a sentence of prose in
`SKILL.md` asking the agent to confirm with the user first — in a file the agent
is free to summarise away.

Two changes.

### Safe-by-default dry runs

`dryRun` now defaults to **true** for metadata, pricing and content upload, on
both the single and batch endpoints. A live write requires `"dryRun": false`
explicitly. Omitting the field can no longer change anything on Amazon.

### One-shot approval tickets

The four irreversible operations — `publish` (live), `unpublish`, `delete`,
`archive` — now require an approval ticket minted out of band:

```console
$ npm run approve -- delete B0XXXXXXX paperback
Approved: delete B0XXXXXXX paperback
Expires:  2026-07-30T07:12:44.031Z (10 min)
Single use: the ticket is consumed by the first matching request.

approval: 8ZQ2r0m-Kx1fV3sN9pL7wYdB4tHcJeAu
```

Send the token back in the request body:

```bash
curl -X POST http://127.0.0.1:3001/api/kdp/titles/delete \
  -H 'Content-Type: application/json' \
  -d '{"titleId":"B0XXXXXXX","format":"paperback","approval":"8ZQ2r0m-…"}'
```

Or through the CLI:

```bash
npm run title:delete -- B0XXXXXXX paperback --approval 8ZQ2r0m-…
```

A ticket is bound to one action, one `titleId` and one format; it is consumed on
first use; and it expires (10 minutes, `--ttl MINUTES` to change). Without one:

```console
HTTP 403
{
  "code": "approval_required",
  "error": "No approval ticket supplied. …",
  "remedy": "npm run approve -- delete B0XXXXXXX paperback"
}
```

A dry-run publish needs no ticket, because it changes nothing. `create: true`
has no `titleId` yet, so its ticket is scoped to the literal `new`.

Tickets live in `approvals.json` in the session directory at mode `0600`, and
spent ones are kept for 24 hours so a replay is reported as *already used* rather
than *unknown*.

### What this does and does not buy you

It buys: a hallucinated, duplicated or replayed destructive call fails closed;
an approval cannot drift from the book it was granted for; and every live change
leaves a record of a separate, deliberate act.

It does **not** buy proof that a human was present. Anything that can call the
API can usually also run `npm run approve`. This raises the floor from *one stray
POST deletes a published book* to *two distinct, scoped, expiring, logged steps* —
that is the honest claim, and it is worth making explicitly rather than letting
the word "approval" imply more than it delivers.

If you want a real human gate, keep the mint step somewhere the agent cannot
reach: run the server under one user and `npm run approve` as another, with
`KDP_APPROVALS_FILE` pointing at a path only the operator can write.

## Configuration summary

| Variable | Default | Purpose |
| --- | --- | --- |
| `KDP_BIND_HOST` | `127.0.0.1` | Listen interface; non-loopback requires a token |
| `KDP_API_TOKEN` | *(unset)* | Bearer secret required on every request |
| `KDP_CORS_ORIGINS` | *(empty)* | Comma-separated browser origins allowed |
| `KDP_APPROVALS_FILE` | `<session dir>/approvals.json` | Where tickets are stored |

## Verified

Against a running server, with no live Amazon account involved:

- `KDP_BIND_HOST=0.0.0.0` without a token → refuses to start, with the reason.
- Loopback bind → `http://<public-ip>:3001` is not connectable.
- `Origin: https://evil.com` → 403 `forbidden_origin`, on `GET` and on `POST /titles/delete`.
- No token / wrong token with `KDP_API_TOKEN` set → 401 `unauthorized`; correct token → 200.
- Delete with no `approval` → 403 `approval_required` naming the exact mint command.
- Ticket for a different `titleId`, or for `delete` used on `archive` → refused, and the message says which book and action it actually approves.
- Correct ticket → passes the gate and reaches the KDP layer (which then fails
  with `auth`, because no session exists — the gate was the only thing being tested).
- Same ticket twice → second attempt refused as already used, with the timestamp.

The `dryRun` default flip is a code-level change (`raw.dryRun !== false`); its
runtime effect cannot be observed without a live session, so it is verified by
reading rather than by execution.
