# Security audit — amazon-kdp-skill

Audited commit: `9194489`
Scope: every executable file in the repo — `server/src/*.ts`, `server/browser/*.js`, `scripts/*`, `lib/*.ts`, `package.json`, `SKILL.md`, `skills/*/SKILL.md`, `references/*`, `.gitignore`, `.env.example`.
Method: static reading only. The code was never run against a live KDP account.

## Verdict: **SAFE WITH CHANGES**

No malicious code found. No backdoor, no exfiltration, no telemetry, no obfuscated payload,
no hidden network destination, no committed secret, no installed hook/cron/unit,
nothing destructive outside its own session directory.

What *is* wrong is a cluster of real, non-malicious security weaknesses: the control server is
unauthenticated and network-reachable, its CORS policy accepts any origin with credentials, and
the destructive KDP operations (publish / unpublish / delete / archive / price change) have **no
approval gate enforced in code** — the only gate is prose in the skill prompts. Fix those before
pointing this at an account with real money in it.

---

## What was checked and found clean

| Question | Answer | Evidence |
| --- | --- | --- |
| Network calls to non-Amazon hosts? | None. Every outbound URL is `kdp.amazon.com` or `kdpreports.amazon.com`; the only other host is `localhost` for its own API. | `server/src/config.ts:22-37`, `server/src/kdpMetadata.ts` (`https://kdp.amazon.com/en_US/bookshelf`), `scripts/kdp-cli.mjs:9` |
| Telemetry / analytics / webhook / pastebin? | None. No analytics SDK, no beacon, no third-party endpoint anywhere in the tree. | full-tree URL grep — only the hosts above |
| Reads credentials, `~/.ssh`, `~/.aws`, keychain, browser profiles? | No. No reference to any of these paths. Only `process.env` reads are its own `KDP_*` config vars. | `server/src/config.ts:7-18`, `server/src/kdpRecoveryStore.ts:31`, `server/src/kdpMetadata.ts:129` |
| `eval` / `new Function` / `curl \| sh` / base64 blob? | None. `page.evaluate()` is used, but every argument is a static, hand-written DOM script targeting KDP's own page. | `server/src/kdpCategories.ts:88`, `server/src/kdpCreateTitle.ts:77,84,114,121,128,143`, `server/src/kdpContentWait.ts:49,118,138` |
| Git hooks / cron / systemd unit? | None. Repo ships no `.git/hooks` content, no crontab, no unit file. | repo file listing |
| `rm -rf` / writes outside its own directory? | No. All deletes are single-file `fs.unlink` inside `SESSION_DIR`. | `server/src/session.ts:20,49`, `server/src/metadataStore.ts:155` |
| Secrets committed? | None. No key, token, cookie or session file in the tree; `.kdp-session/` is gitignored. | `.gitignore:2` (verified with `git check-ignore`) |

---

## Findings

### H1 — Control server binds all interfaces with no authentication — **HIGH**

`app.listen(PORT, ...)` is called with no host argument, so Express binds `0.0.0.0`/`::`, not
loopback. There is no auth middleware of any kind — the only `app.use` calls are `cors` and
`express.json`.

- `server/src/index.ts:694` — `app.listen(PORT, () => {` (no host bind; the log line says `localhost` but the socket is not restricted to it)
- `server/src/index.ts:53-54` — the complete middleware stack

Anyone who can reach port 3001 gets the full API, including `POST /api/kdp/titles/delete`
(`server/src/index.ts:405`) and `POST /api/kdp/publish` (`server/src/index.ts:376`), acting with the
stored Amazon session. On a VPS this is internet-exposed unless a firewall happens to block it.

**Fix:** bind `127.0.0.1` and/or require a local shared-secret header.

### H2 — CORS reflects any origin with credentials — **HIGH**

- `server/src/index.ts:53` — `app.use(cors({ origin: true, credentials: true }))`

`origin: true` echoes back whatever `Origin` the caller sends. Combined with `express.json()` and
`POST` endpoints that take a plain JSON body, any web page the operator visits while the server is
running can issue cross-origin requests that delete or publish titles. No CSRF token exists.

**Fix:** restrict to an explicit allowlist, or drop CORS entirely (the CLI clients are server-side —
`scripts/kdp-cli.mjs:9` uses plain `fetch` from Node and never needs CORS).

### H3 — No code-enforced approval gate on destructive KDP operations — **HIGH**

Publish, unpublish, delete and archive parse their body and execute immediately. There is no
`confirm` flag, no interactive prompt, no allowlist, no dry-run requirement in code.

- `server/src/index.ts:376-389` — publish
- `server/src/index.ts:391-403` — unpublish
- `server/src/index.ts:405-417` — delete
- `server/src/index.ts:419-431` — archive

`dryRun` exists only for metadata / pricing / content-upload (`server/src/index.ts:195,222,264,294`)
and defaults to `false` in every parser (`server/src/index.ts:567,581,638` — `raw.dryRun === true`).
So an omitted field means *live write*, not a safe default.

The only gate is prose an agent may ignore:
- `SKILL.md:123` — "Never set `publish: true` without explicit user confirmation."
- `SKILL.md:146` — same, restated
- `skills/publish-book/SKILL.md:22` — same

**Fix:** require an explicit `confirm: true` (and ideally a matching title string) in the request body
for publish/unpublish/delete/archive; default `dryRun` to `true`.

### M1 — Auto-clicks KDP's own "are you sure?" confirmation modals — **MEDIUM**

Amazon's last-chance dialogs are dismissed programmatically, so the human safety net that would
otherwise stop an erroneous automated delete is removed.

- `server/src/kdpTitleActions.ts:51-53` — clicks `/confirm|unpublish|yes/i`
- `server/src/kdpTitleActions.ts:175-180` — clicks `#delete-title-ok-announce`
- `server/src/kdpTitleActions.ts:229-231` — clicks `/archive|confirm|yes/i`

Not a defect on its own — unattended automation needs this — but it means H3 is the *only* thing
standing between a bad request and a deleted listing.

### M2 — Recovery playbook auto-approves manuscript previews — **MEDIUM**

When a KDP page reports "preview and approve" or "approve these changes", the recovery engine
clicks approve without human review, i.e. it can attest to content it never showed anyone.

- `server/src/kdpRecovery.ts:48-52` — playbook rule mapping the pattern to `approve_manuscript_preview`
- `server/src/kdpRecovery.ts:53-57` — same action on the pricing-unavailable path
- `server/src/kdpRecovery.ts:178` — action dispatch

### M3 — Session cookies stored inside the repo tree at default permissions — **MEDIUM**

The Playwright `storage_state` (live Amazon session — full account access, MFA already satisfied) is
written to `<repo>/.kdp-session/amazon-kdp.json` by default, with no explicit mode.

- `server/src/config.ts:17-20` — `SESSION_DIR` defaults to `path.join(repoRoot, '.kdp-session')`
- `server/src/session.ts:15` — `fs.mkdir(SESSION_DIR, { recursive: true })` — no `mode`, so umask-default `0755`
- `server/src/login.ts:47` — `context.storageState({ path: sessionFilePath() })` — Playwright writes `0644`

Result: any local user can read the session. It is gitignored (`.gitignore:2`) so it will not be
committed, but "one `git clean` / one bad glob away from the repo" is the wrong place for it.

**Fix:** default outside the repo (`~/.config/amazon-kdp-skill/`), dir `0700`, file `0600`.

### M4 — `postinstall` triggers an unpinned browser download — **MEDIUM**

- `package.json:10` — `"postinstall": "playwright install chromium"`

`npm install` silently downloads a ~150 MB Chromium from Microsoft's CDN. The version is whatever the
resolved `playwright ^1.55.0` (`package.json:36`) asks for — a caret range, so not reproducible.
Not malicious, but it is remote code fetched and executed as a side effect of install, and it is
redundant on a machine that already has a Playwright browser.

### L1 — Headless/no-display login fails silently — **LOW**

- `server/src/login.ts:29-32` — `chromium.launch({ headless: false, ... })`, the only login path
- `server/src/login.ts:37-53` — on failure it simply spins for a 10-minute deadline

On a display-less VPS the launch throws (or, worse, the loop runs to the deadline) and the caller
only learns about it by polling `getLoginState()` (`server/src/index.ts:71`). No display detection,
no actionable error, no cookie-import alternative. Availability issue, not a security one.
*Addressed in phase 2 of this branch.*

### L2 — `execSync` with an interpolated path — **LOW**

- `scripts/test-all.mjs:245` — `execSync(\`npx tsx scripts/parse-report.ts "${usePath}"\`)`
- `scripts/test-all.mjs:260` — `execSync(\`node scripts/export-metadata-xlsx.mjs "${outPath}"\`)`

Shell-quoted interpolation of a path that comes from local test config. Not reachable from the HTTP
API and not attacker-controlled in normal use, but it is a shell-injection shape that should be
`spawnSync` with an argv array (as `scripts/upload-staging-all.ts:17` already does correctly).

---

### N1 — Not security, but noted: `kdpPublish.ts` references an undefined variable — **INFO**

`npx tsc --noEmit` on the audited commit fails with `TS2304: Cannot find name 'saveResult'`:

- `server/src/kdpPublish.ts:231` (twice), `server/src/kdpPublish.ts:240`

This is on the publish path. Whatever it was meant to check is not being checked, and the
code would throw a `ReferenceError` if that branch runs. Pre-existing upstream; not
introduced or fixed by this branch. Consistent with the README calling the publish wizard
"still in development".

---

## Bottom line

The code does what it claims: it drives Amazon KDP with Playwright, using a session the operator
established themselves. Nothing in it phones home, steals credentials, or hides behaviour.

Before trusting it with a live account, fix **H1, H2 and H3** — an unauthenticated,
any-origin-accepting API that can delete a published book with a single un-gated POST is the real
risk here, not the third-party authorship.
