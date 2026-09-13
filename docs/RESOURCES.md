# Resource footprint

All numbers below were **measured on this host**, not estimated.
Host: NixOS, Linux 6.6.94 x86_64, Node v22.16.0, npm 10.9.2, `playwright` resolved to 1.61.0.
Reproduce with `npm run browser:check` and the commands shown.

## Disk

| Item | Size | How measured |
| --- | --- | --- |
| Repo working tree (no `node_modules`, no `.git`) | **574 KB** | `du -sh --exclude=node_modules --exclude=.git .` |
| `node_modules`, production only (`npm i --omit=dev`) | **34 MB**, 80 packages | `du -sh node_modules` |
| `node_modules`, including devDependencies | **71 MB**, 84 packages | `du -sh node_modules` |
| **Total without a browser** | **~35 MB** prod / ~72 MB with dev tooling | |

Largest production dependencies:

| Package | Size |
| --- | --- |
| `playwright-core` | 13 MB |
| `xlsx` | 7.2 MB |
| `codepage` (xlsx dep) | 5.5 MB |
| `playwright` | 4.8 MB |
| `cfb` (xlsx dep) | 378 KB |
| `iconv-lite` | 366 KB |

Largest dev-only additions: `typescript` 24 MB, `@esbuild` 11 MB (via `tsx`), `@types` 2.7 MB.

## Browser binary

Yes — a Chromium binary is required (see "Is Chromium really needed?" below). It is by far
the biggest item, an order of magnitude larger than everything else combined:

| Browser copy on this host | Size |
| --- | --- |
| `~/.cache/ms-playwright/chromium-1223` | **376 MB** |
| `~/.cache/ms-playwright/chromium_headless_shell-1223` | **259 MB** |
| Nix `playwright-browsers` `chromium-1155` | **~308 MB** (store-shared) |
| Nix `playwright-browsers` `chromium_headless_shell-1155` | **308 MB** (store-shared) |

**This repo no longer downloads one.** Upstream had
`"postinstall": "playwright install chromium"` in `package.json`, so every `npm install`
pulled a fresh ~350 MB Chromium from Microsoft's CDN. That has been removed; the browser is
located at launch time instead (`server/src/browserLaunch.ts`).

Resolution order, first hit wins:

1. `KDP_CHROMIUM_PATH` — explicit override (errors if it is not an executable file)
2. Playwright's own `chromium.executablePath()`, if that file actually exists
3. Nix `/nix/store/*-playwright-browsers/chromium-*` (then `chromium_headless_shell-*`)
4. `PLAYWRIGHT_BROWSERS_PATH` / `~/.cache/ms-playwright`
5. `chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable` on `PATH`

If nothing is found it fails with `ChromiumNotFoundError`, naming both fixes
(`KDP_CHROMIUM_PATH=…` or `npx playwright install chromium`). It never downloads silently.

Verify what it picked, and that it launches:

```console
$ npm run browser:check
Display available: no (headless-only host)
Default headless: true
Request delay window: 4000-10000ms
Resolved Chromium: /nix/store/…-playwright-browsers/chromium-1155/chrome-linux/chrome
Browser version: 138.0.7204.49
Launch + render: 1125ms
Node RSS: 181 MB (browser runs in its own processes)
PASS: Chromium launched and rendered a page.
```

### Is Chromium really needed?

Yes. There is no HTTP-only path to remove. Every KDP interaction goes through a Playwright
`Page`: the JSON endpoints are called via `page.request` so they inherit the browser's
session cookies (`server/src/kdpHttp.ts`), and the whole publishing wizard is DOM driving —
`page.evaluate`, `getByRole`, click, fill (`server/src/kdpCreateTitle.ts`,
`server/src/kdpContentUpdate.ts`, `server/src/kdpMetadataUpdate.ts`,
`server/src/kdpPricingUpdate.ts`, `server/src/kdpPublish.ts`). Amazon's endpoints are also
CSRF-token- and bot-check-guarded; the token is scraped out of rendered page HTML
(`csrftoken":{"token":"` in `server/src/login.ts`).

What *was* redundant is the second **copy**. Playwright 1.61 wants Chromium revision 1228;
this host already has revision 1223 in `~/.cache/ms-playwright` and 1155 in the Nix store,
so the postinstall would have fetched a third build. Chromium revisions are not pinned to a
Playwright version in practice — the CDP surface used here is stable across them — which is
what makes reusing an existing binary safe.

**Proof it still works without the download:** installed with `npm install --ignore-scripts`
(no browser fetched), then launched the Nix-store Chromium through the normal code path —
`npm run browser:check` output above, revision 1155 / Chrome 138, page rendered, PASS. The
headless_shell build from the same store path also launches (Chrome 133).

The binaries in `~/.cache/ms-playwright` on this host are *not* usable — launching them
fails with `spawn … EACCES`. That is a permissions problem on this machine, not a Playwright
one; the resolver falls through to the Nix store, which works.

## RAM at runtime

Measured with `/proc/<pid>/smaps_rollup` PSS summed over the whole process tree
(PSS, not RSS — Chromium's ~12 processes share large mappings, and summing RSS
double-counts them to ~1.5 GB, which is not real memory pressure).

| Scenario | Node alone | Peak, node + Chromium | Chromium share | Processes |
| --- | --- | --- | --- | --- |
| One context, 2 pages, light DOM, 1920x1080 | 145 MB | **571 MB** | 426 MB | 12 |
| Same, 2 pages of ~40k DOM nodes each (stress) | 148 MB | **945 MB** | 797 MB | 12 |

Two pages is the real shape: `withKdpPages` opens an *action* page and a *parse* page in one
context (`server/src/kdpMetadata.ts`).

**Budget ~1 GB RAM** for a KDP run on a heavy bookshelf page, ~600 MB for light work. The
150 MB Node baseline is `tsx`/TypeScript compilation held in memory; `npm run server:start`
without watch mode is at the lower end.

## Processes

- **No daemon, no background process, nothing installed.** No systemd unit, no cron entry,
  no git hook — confirmed in [AUDIT.md](../AUDIT.md).
- `npm run server` / `server:start` runs an Express server in the foreground on port 3001
  (`server/src/index.ts`). It stays up only as long as you run it.
- Chromium is launched per operation and closed in a `finally` block — no browser is left
  running between calls (`server/src/browserLaunch.ts` callers).
- Between the Express process and Chromium, expect **13 processes** at peak during a KDP
  operation, and 1 when idle.

## Time

The throttle dominates wall-clock, by design. Every KDP page load and API call waits a
random **4-10 s** (`KDP_REQUEST_DELAY_MIN_MS` / `KDP_REQUEST_DELAY_MAX_MS`, see the README),
so a wizard step making ten requests takes ~70 s of deliberate waiting. Chromium cold start
is ~1.1 s and is not the bottleneck. Do not lower the throttle to speed things up; Amazon
answers bursts with "Server Busy".
