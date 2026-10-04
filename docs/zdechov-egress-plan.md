# Zdechov routing implementation

Implemented through same HA SSH endpoint used by Sbazar. Direct Zdechov hostname was unreachable; user selected HA. SSH exit and both Playwright paths verified as `193.108.20.52`, localhost SOCKS port 11081. See [SSH-EGRESS.md](SSH-EGRESS.md) for current operational instructions.

Verification: 20 tests pass across session safety, print parser and print upload controls. Live proxy test stops SSH, confirms both browser and API fail, then confirms restart through same exit. No uploads during verification. Existing saved Amazon session requires sign-in; failed check preserves session file. Long duration authenticated reuse remains unverified until user completes normal login. Six repository TypeScript diagnostics predate this change and remain unchanged.

## Original design

# Zdechov egress and Amazon session persistence

Historical plan written before implementation. Current status and verified route are recorded above.

## Evidence

- July 29 marketplace session records SSH dynamic forwarding through Czech host, a loopback SOCKS5 listener, remote DNS, an `ensure_egress()` check and per-site routing: Sbazar proxied, Bazos direct.
- Checked marketplace worktree contains older code without that adapter. Current private marketplace config has no egress settings. Recover actual deployed implementation before copying code; recorded design alone is not deployment proof.
- Current SSH config has `ha`, but no `zdechov` alias. History mentions `maron.zdechov.net`; confirm intended host, SSH user, forwarding permission and actual exit IP. Do not assume `ha` and Zdechov are interchangeable.
- Amazon `browserLaunch.ts` has no proxy configuration. `kdpMetadata.ts`, `kdpClient.ts` and `kdpAccount.ts` create fresh contexts from saved state and close without writing refreshed state. `login.ts` saves state during interactive login. Missing refresh persistence is a candidate cause of repeated sign-ins, not a proven explanation for yesterday's expiry.
- `checkSession()` also treats account-date parsing errors as disconnected. That can request login for a parsing problem.

## Implementation sequence

1. Verify Zdechov target and recover marketplace tunnel adapter. Test SSH forwarding and identify exit IP with a read-only request. Confirm connection reaches user's intended residential connection. Check local port availability.
2. Create supervised SSH SOCKS5 tunnel bound only to `127.0.0.1`, using a dedicated port such as 11081. Reuse marketplace lifecycle pattern: ensure running, verify listener ownership and health, reconnect with bounded backoff. Use pinned SSH host key, `ExitOnForwardFailure`, SSH keepalives and remote DNS. Keep proxy private.
3. Add shared Amazon egress configuration and browser/context factory. Pass proxy explicitly to Playwright; environment proxy variables alone are insufficient proof. Cover interactive remote login, session verification, Bookshelf, metadata, pricing, reports, preview, manuscript/cover PUTs, Amazon asset hosts and diagnostic browser scripts. Audit every browser creation path. Local CLI-to-server requests and noVNC transport remain local/VPS traffic.
4. Stop outbound Amazon traffic when tunnel or proxy is unavailable. Never retry account requests directly from VPS. Report `egress_down` separately from `auth_required`, parsing errors, service errors and challenges. Unexpected exit-IP changes stop operations until verified.
5. Add serialized session lifecycle shared by server, CLI and login worker. Save refreshed cookies and browser storage atomically after authenticated operations, with private directory and file permissions. Preserve last valid snapshot on sign-in redirects, challenges and failed operations. Include IndexedDB or session-storage persistence only if inspection shows Amazon needs it. Evaluate one persistent Chromium profile if refreshed snapshots still fail; do not assume new contexts alone invalidate authentication.
6. Keep login and later operations on identical route and browser configuration. Remote GUI worker already inherits parent environment; verify proxy config reaches both its worker and systemd runtime. Keep existing MFA/CAPTCHA handoff. A tunnel does not remove Amazon's authentication requirements.
7. Move 20-file-per-rolling-hour upload cap into shared per-account runtime ledger. Reserve each attempt before upload, including failures and uncertain outcomes. Keep one write at a time and existing request delays. No automatic repeated uploads after ambiguous failures.
8. Test without account writes first. Browser navigation and `page.request` must show same verified exit IP. Check remote DNS and absence of direct Amazon TCP/UDP connections. Stop tunnel and prove requests fail instead of switching routes. Test parser-error versus authentication-error classification and session-file concurrency/permissions.
9. Migrate with one normal login through Zdechov, since current saved session is invalid. Run repeated read-only checks across process and service restarts, then later checks over 24 hours without synthetic keepalive traffic. Record whether refreshed state persists and how long Amazon accepts it. Test one draft upload only when needed, within cap.
10. Update skill instructions, runtime pin and deployment configuration after tests pass. Verify running service and CLI use same revision, session directory and egress settings. Rollback stops account traffic; return to direct mode requires explicit route change and session verification.

## Acceptance

All outbound Amazon communication uses verified Zdechov route. Tunnel failure produces a clear connection error. Refreshed authentication survives process restarts without lost updates. Login prompts appear only when authentication is actually required. Upload quota is shared across sessions. No promise of permanent login or protection from account restrictions.

Playwright supports browser and API-request proxy configuration: [network](https://playwright.dev/docs/network), [APIRequest proxy](https://playwright.dev/docs/api/class-apirequest#api-request-new-context-option-proxy). Authentication state and session-storage limits: [authentication](https://playwright.dev/docs/auth).
