---
name: amazon-kdp-connect
description: Connects and manages the Amazon KDP browser session for Playwright automation. Use when signing in to KDP, checking if the session is valid, reconnecting after expiry, or disconnecting.
disable-model-invocation: true
---

# KDP Connect Session

**Agent runs all commands.** Only the Amazon sign-in step requires the user (MFA in Chromium).

## Ensure server is running

```bash
npm run server:start   # background if not already listening on :3001
```

## Check status

```bash
npm run status
```

`connected: true` means ready. `connected: false` with `code: auth_required` means normal Amazon login is required. `egress_down`, `operation_busy`, `challenge_required` and `kdp` errors do not establish expiry. Fix reported cause; preserve saved session. Before allocating desktop, run `npm run egress:verify`. Read [SSH egress](../../docs/SSH-EGRESS.md) for route setup and IP pin. No direct fallback.

## Sign in (agent-driven, machine with a display)

1. Agent starts server if needed.
2. Agent runs: `npm run login`
3. **Tell the user** to complete Amazon sign-in in the visible Chromium window (MFA if prompted).
4. Agent polls: `npm run status` until `connected: true`

Session saved to `~/.config/amazon-kdp-skill/amazon-kdp.json` (mode 0600).

## Sign in (headless VPS — temporary remote desktop)

`npm run login` fails fast here with `code: no_display`; do not retry it. When
`remote-gui` is installed, use:

1. Agent runs `npm run login:remote`.
2. Send returned secret `url` to user; password is carried only in URL fragment.
3. User signs in and completes MFA, waits for KDP to load, then closes tab.
4. Agent polls `npm run session:verify` until valid.

Desktop link expires after ten minutes if unopened. First disconnect removes
remote access; login worker retains same browser long enough to save Playwright
storage state, then all display processes stop.

If remote GUI is unavailable, use storage-state capture/import from
`docs/HEADLESS-LOGIN.md`.

Never print, echo, or paste the contents of the storage-state file.

## Disconnect

```bash
curl -X DELETE http://localhost:3001/api/kdp/session
```

Clears session cookies and local metadata cache.

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/kdp/status` | Connection + session timestamp |
| POST | `/api/kdp/login/start` | Open login browser |
| DELETE | `/api/kdp/session` | Log out locally |

## Errors

- **`auth_required`** → Amazon requires sign-in; use remote login and normal MFA after healthy route check.
- **`egress_down`** → fix SSH/config/IP before login; never fall back to direct.
- **`operation_busy`** → wait for current operation.
- **`challenge_required`** → stop and hand off to user; no automated bypass.
- **`kdp`** → response/schema/service error; session expiry not established.
- **`code: no_display` from login** → headless host; use the import path above, do not retry
- **Login already in progress** → wait for browser window to finish

See [references/troubleshooting.md](../../references/troubleshooting.md).
