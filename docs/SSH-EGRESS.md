# Owned SSH egress

All Amazon browsers use one localhost SOCKS5 route. Browser navigation, login,
page.request, report downloads and asset uploads share that route. Local CLI HTTP
and remote desktop transport stay local. No direct fallback, proxy rotation,
CAPTCHA solving or automated MFA.

Configure `~/.config/amazon-kdp-skill/egress.json` with mode 0600:

```json
{
  "sshHost": "owned.example",
  "sshUser": "owner",
  "sshPort": 22,
  "socksPort": 11081,
  "expectedIp": "203.0.113.10"
}
```

`expectedIp` is optional. First successful owned SSH route pins observed exit IP
in `egress-ip.json`. Later IP or SSH target changes stop operations. Investigate
before explicitly resetting pin. `KDP_EGRESS_CONFIG` selects another config file;
it does not enable direct access. All commands for one account must share
`KDP_SESSION_DIR`, including server, CLI and remote login worker.

Runtime requires Linux, `ssh`, `flock`, Node 20+ and existing Chromium. SSH must
already have trusted known_hosts entry and working key authentication. Agent does
not accept unknown host keys, enter SSH passwords or change remote configuration.

```bash
npm run egress:verify
npm run session:verify
```

Egress verification compares browser and API request IP using public HTTPS IP
endpoint before any Amazon request. Browser DNS goes through SOCKS5; local DNS is
blocked for remote destinations. WebRTC direct UDP and QUIC are disabled. Missing
config, unavailable SSH, occupied port, changed exit IP or failed probe stops
operation before Amazon access.

Application owns dedicated SSH child, recorded with PID and Linux process start
identity. It reuses only its recorded tunnel. SSH binds `127.0.0.1`, refuses failed
forwarding, uses keepalive, and exits on lost connection. Next operation can start
replacement to same endpoint. No reconnection retries during failed writes. No
persistent OS service or remote SSH setting is changed.

Session operations use kernel lock across processes. Successful requests save
cookies, localStorage and IndexedDB atomically with mode 0600. Authentication,
challenge and parser failures preserve previous file. Login holds same lock and
validates current browser before saving. `login:remote` verifies route before
allocating desktop; child loads same config. Existing state is reused first.

Uploads reserve slot immediately before setInputFiles. Shared private ledger
`uploads.json` permits 20 attempts per rolling hour, including failed and uncertain
transfers. Restart preserves ledger. Invalid ledger or clock rollback blocks.
Dry-run reserves no slot. Recovery stops on quota, auth, challenge and tunnel
errors. Disconnect clears authentication, retains quota and route state.

| Code | Next action |
|---|---|
| `egress_down` | Fix SSH/config/IP pin. Preserve session; do not request login. |
| `operation_busy` | Wait for current account operation. |
| `auth_required` | Healthy route, Amazon requires normal login/MFA. |
| `challenge_required` | Stop automation and hand off to user. |
| `kdp` | Inspect response/schema/service error. Expiry not established. |
| `upload_limit` | Wait until next slot; do not retry transfer. |

`/api/kdp/health` reports local tunnel health and last verified exit IP without
Amazon requests. Never claim sessions cannot expire or accounts cannot be banned.

Tests:

```bash
npm run test:session-safety
npm run test:print-content
npm run test:print-upload
```

Explicit live proxy test stops dedicated tunnel, confirms browser and API failures,
then verifies restart. It sends no Amazon requests and uploads nothing:

```bash
node_modules/.bin/tsx scripts/test-egress-live.ts
```

Measured verification cost: two public HTTPS IP lookups per browser launch, no paid API calls. Session safety suite ran 10 checks in 8.84 seconds on deployed host; print checks add 11 tests. Live routing test uploaded zero files.
