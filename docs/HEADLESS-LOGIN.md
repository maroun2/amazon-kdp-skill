# Signing in on a machine with no display

`npm run login` opens a real Chromium window so you can complete Amazon sign-in and MFA
by hand. On a VPS, a container or CI there is no display, so that path cannot work. The
server now detects this and refuses immediately with an actionable error instead of
spinning for ten minutes:

```
Cannot open an interactive browser: this machine has no display
(neither DISPLAY nor WAYLAND_DISPLAY is set).
```

Detection is `DISPLAY` / `WAYLAND_DISPLAY` on Linux — `server/src/browserLaunch.ts`
(`hasDisplay`). It is checked before the browser launches, in
`server/src/login.ts` (`startInteractiveLogin`).

The supported alternative: **sign in on a machine that does have a browser, export the
session, and import it here.** The session is a Playwright `storage_state` file — exactly
what `npm run login` would have produced — so nothing else in the codebase changes.

---

## Step 1 — capture the session on your own machine

You need Node 20+ and Playwright on your laptop/desktop. You do **not** need this repo there.

```bash
mkdir -p ~/kdp-capture && cd ~/kdp-capture
npm init -y
npm i playwright
npx playwright install chromium
```

Save this as `capture.mjs`:

```js
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: false })
const context = await browser.newContext()
const page = await context.newPage()

await page.goto('https://kdpreports.amazon.com/reports/royalties')
console.log('Sign in to Amazon KDP in the window, including MFA.')
console.log('When the royalties dashboard is fully loaded, press Enter here.')

process.stdin.resume()
await new Promise((resolve) => process.stdin.once('data', resolve))

await context.storageState({ path: 'kdp-storage-state.json' })
await browser.close()
console.log('Wrote kdp-storage-state.json')
```

Run it and finish the sign-in in the window:

```bash
node capture.mjs
```

Important while capturing:

- Tick **"Keep me signed in"** on the Amazon sign-in form. Without it the session cookies
  are browser-session-scoped and expire the moment the browser closes — the imported file
  will look valid but fail on first use.
- Wait until `https://kdpreports.amazon.com/reports/royalties` renders the dashboard, not
  a sign-in or interstitial page, before pressing Enter.
- Also visit `https://kdp.amazon.com/en_US/bookshelf` once before pressing Enter, so
  cookies for the `kdp.amazon.com` host are captured too, not just `kdpreports`.

### What the file must look like

Playwright's `storage_state` format — an object with `cookies` and `origins` arrays:

```json
{
  "cookies": [
    { "name": "session-id", "value": "...", "domain": ".amazon.com", "path": "/",
      "expires": 1793000000, "httpOnly": false, "secure": true, "sameSite": "None" }
  ],
  "origins": []
}
```

A `cookies.txt` (Netscape format), a HAR file, or a browser-extension cookie export is
**not** accepted — the importer rejects them with a message saying so. If you must start
from a cookie-extension export, convert it to the shape above; the required fields per
cookie are `name`, `value`, `domain`, `path`, `expires`, `httpOnly`, `secure`, `sameSite`.

Cookies that must be present (the importer checks for at least one of these):
`session-id`, `at-main`, `sess-at-main`, `x-main`, `ubid-main` — all on `.amazon.com`.

> The file is a live, MFA-satisfied login to an account with real money in it. Treat it
> exactly like a password. Move it over `scp`/`ssh`, never over chat, email or a paste
> site, and delete the local copy afterwards.

## Step 2 — copy it to the headless machine

```bash
scp kdp-storage-state.json you@vps:/tmp/kdp-storage-state.json
rm kdp-storage-state.json     # on your own machine
```

## Step 3 — import it

On the headless machine, in this repo:

```bash
npm run session:import -- /tmp/kdp-storage-state.json
shred -u /tmp/kdp-storage-state.json     # or: rm -P / rm
```

The importer (`scripts/session-import.mjs`):

- rejects anything that is not a Playwright `storage_state` file,
- rejects a capture with no `amazon.com` cookies, or with none of the sign-in cookies
  above (i.e. captured while signed out),
- writes it to `~/.config/amazon-kdp-skill/amazon-kdp.json`, directory `0700`, file `0600`,
- prints the cookie count, the domains covered, and the earliest expiry — **never any
  cookie values**.

### Where the session lives, and why not in the repo

Default: `~/.config/amazon-kdp-skill/amazon-kdp.json` — resolved in
`server/src/config.ts` (`resolveSessionDir`). Override with `KDP_SESSION_DIR`.

It is deliberately outside the working tree so a live Amazon session can never be caught
by a `git add -A`, a `git clean`, or a stray glob. `.kdp-session/` remains gitignored, and
an existing legacy `.kdp-session/amazon-kdp.json` is still honoured for backwards
compatibility, but new sessions go to `~/.config`.

Permissions are enforced in code, not just on import: `ensureSessionDir()` chmods the
directory to `0700` and `secureSessionFile()` chmods the file to `0600` after every write
(`server/src/session.ts`), because Playwright writes `storageState` as `0644`.

## Step 4 — verify it loaded

```bash
npm run session:verify
```

This runs one throttled request against KDP reports with no server needed, and prints:

```
Session file: /home/you/.config/amazon-kdp-skill/amazon-kdp.json
Display available: no (headless-only host)
Chromium: /nix/store/...-playwright-browsers/chromium-1155/chrome-linux/chrome
Saved at: 2026-07-30T…
Session is valid. Connected to Amazon KDP.
```

It exits non-zero and tells you to re-capture if the cookies are expired or the file is
missing, and warns (without failing) if the file is group/other-readable.

To check only the browser side, with no Amazon traffic at all:

```bash
npm run browser:check
```

## How long does it last, and what does expiry look like?

- With **"Keep me signed in"** ticked, Amazon's `at-main`/`sess-at-main` cookies are
  typically good for weeks to months. `npm run session:import` prints the earliest cookie
  expiry it can see — that timestamp is the hard upper bound.
- Real-world expiry is usually earlier than the cookie dates: Amazon invalidates sessions
  on password change, on an explicit "sign out everywhere", and sometimes on a
  sufficiently different source IP. Capturing on your laptop and using it from a VPS in
  another country is exactly the pattern that triggers re-authentication, so expect to
  re-import more often than the cookie expiry suggests.

**The re-auth signal.** Amazon does not return a clean 401 — it 302s to a sign-in page.
The code treats that as `KdpAuthError` (`server/src/kdpClient.ts`), triggered by
`page.url().toLowerCase().includes('signin')`. You will see:

- `npm run session:verify` → `Session is NOT valid — Amazon redirected to sign-in, or the
  cookies expired.` (exit 1)
- the HTTP API → `{"error": "Amazon KDP session expired or not connected.", "code": "auth"}`
- `GET /api/kdp/status` → `connected: false`

Recovery is Steps 1-4 again. Re-importing overwrites the old file in place; no cleanup
needed.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `not valid JSON … not a cookies.txt or HAR export` | Wrong export format | Use the `capture.mjs` above |
| `No amazon.com cookies found` | Captured on the wrong site | Capture while on `kdpreports.amazon.com` |
| `None of the expected Amazon sign-in cookies are present` | Captured while signed out | Complete sign-in before pressing Enter |
| Verify passes, then fails hours later | "Keep me signed in" was not ticked | Re-capture with it ticked |
| `Chromium: NOT FOUND` | No browser on the host | See [RESOURCES.md](RESOURCES.md) |
