import fs from 'node:fs'
import path from 'node:path'
import { chromium, type Browser } from 'playwright'

/**
 * One place that decides *which* Chromium runs and *whether* it can be headful.
 *
 * This repo used to rely on `postinstall: playwright install chromium`, which
 * downloads its own ~350 MB copy. On a machine that already has a Playwright
 * browser (Nix `playwright-driver.browsers`, an existing `~/.cache/ms-playwright`,
 * or a system Chromium) that is a second copy for no benefit, so the download is
 * no longer automatic — we locate an existing binary instead. See docs/RESOURCES.md.
 */

export type LaunchOptions = {
  headless?: boolean
  args?: string[]
}

const BASE_ARGS = ['--disable-blink-features=AutomationControlled']

/** Linux without X11/Wayland cannot run a visible browser. */
export function hasDisplay(): boolean {
  if (process.platform !== 'linux') return true
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
}

/** Headless unless the caller insists and a display actually exists. */
export function defaultHeadless(): boolean {
  if (process.env.KDP_HEADLESS === 'true') return true
  if (process.env.KDP_HEADLESS === 'false') return false
  return !hasDisplay()
}

function isExecutableFile(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK)
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function firstMatch(dir: string, prefix: string, tail: string[]): string | null {
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return null
  }
  const candidates = entries
    .filter((name) => name.startsWith(prefix))
    .sort()
    .reverse() // highest revision first
  for (const name of candidates) {
    for (const t of tail) {
      const full = path.join(dir, name, ...t.split('/'))
      if (isExecutableFile(full)) return full
    }
  }
  return null
}

function nixPlaywrightBrowsers(): string[] {
  const store = '/nix/store'
  try {
    return fs
      .readdirSync(store)
      .filter((name) => name.endsWith('-playwright-browsers'))
      .sort()
      .reverse()
      .map((name) => path.join(store, name))
  } catch {
    return []
  }
}

function fromPath(binary: string): string | null {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    const full = path.join(dir, binary)
    if (isExecutableFile(full)) return full
  }
  return null
}

/**
 * Locate a usable Chromium without downloading one.
 * `headful` skips headless_shell builds, which cannot open a visible window.
 * Returns null to mean "let Playwright use its own bundled path".
 */
export function resolveChromiumExecutablePath(headful = false): string | null {
  const override = process.env.KDP_CHROMIUM_PATH
  if (override && override.trim() !== '') {
    if (!isExecutableFile(override)) {
      throw new Error(
        `KDP_CHROMIUM_PATH is set to "${override}" but that is not an executable file.`,
      )
    }
    return override
  }

  // 1. Playwright's own download, if it happens to be present already.
  try {
    const bundled = chromium.executablePath()
    if (bundled && isExecutableFile(bundled)) return bundled
  } catch {
    /* Playwright has no browser registered — keep looking. */
  }

  // 2. Nix `playwright-driver.browsers` (how this machine ships Chromium).
  for (const root of nixPlaywrightBrowsers()) {
    const full = firstMatch(root, 'chromium-', [
      'chrome-linux/chrome',
      'chrome-linux64/chrome',
    ])
    if (full) return full
    if (headful) continue
    const shell = firstMatch(root, 'chromium_headless_shell-', [
      'chrome-linux/headless_shell',
      'chrome-headless-shell-linux64/chrome-headless-shell',
    ])
    if (shell) return shell
  }

  // 3. Any other ms-playwright cache root on this machine.
  const cacheRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(process.env.HOME || '', '.cache', 'ms-playwright'),
  ].filter((p): p is string => Boolean(p))
  for (const root of cacheRoots) {
    const full = firstMatch(root, 'chromium-', [
      'chrome-linux/chrome',
      'chrome-linux64/chrome',
    ])
    if (full) return full
  }

  // 4. System Chromium / Chrome.
  for (const bin of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    const full = fromPath(bin)
    if (full) return full
  }

  return null
}

export class NoDisplayError extends Error {
  readonly code = 'no_display'
  constructor() {
    super(
      [
        'Cannot open an interactive browser: this machine has no display ' +
          '(neither DISPLAY nor WAYLAND_DISPLAY is set).',
        '',
        'Interactive Amazon sign-in is impossible here. Import a session captured',
        'on a machine that does have a browser instead:',
        '',
        '  1. On your own machine, follow docs/HEADLESS-LOGIN.md to export a',
        '     Playwright storage_state file for kdp.amazon.com.',
        '  2. Copy it to this machine at ~/.config/amazon-kdp-skill/amazon-kdp.json',
        '     (chmod 600).',
        '  3. Verify with: npm run session:verify',
        '',
        'Full instructions: docs/HEADLESS-LOGIN.md',
      ].join('\n'),
    )
    this.name = 'NoDisplayError'
  }
}

export class ChromiumNotFoundError extends Error {
  readonly code = 'chromium_not_found'
  constructor() {
    super(
      [
        'No Chromium binary found.',
        '',
        'This project deliberately does not download its own browser. Point it at',
        'an existing one, or install a Playwright browser once:',
        '',
        '  export KDP_CHROMIUM_PATH=/path/to/chrome        # explicit override',
        '  npx playwright install chromium                 # ~350 MB download',
        '',
        'See docs/RESOURCES.md for the sizes involved.',
      ].join('\n'),
    )
    this.name = 'ChromiumNotFoundError'
  }
}

/** Launch Chromium using an already-installed binary. */
export async function launchKdpBrowser(
  options: LaunchOptions = {},
): Promise<Browser> {
  const headless = options.headless ?? defaultHeadless()
  if (!headless && !hasDisplay()) throw new NoDisplayError()

  const executablePath = resolveChromiumExecutablePath(!headless)
  if (!executablePath) throw new ChromiumNotFoundError()

  return chromium.launch({
    headless,
    executablePath,
    args: [
      ...BASE_ARGS,
      ...(process.platform === 'linux'
        ? ['--no-sandbox', '--disable-dev-shm-usage']
        : []),
      ...(options.args ?? []),
    ],
  })
}
