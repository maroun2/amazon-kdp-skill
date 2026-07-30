import { KDP_ROYALTIES_PAGE } from './config.js'
import { hasDisplay, launchKdpBrowser, NoDisplayError } from './browserLaunch.js'
import { ensureSessionDir, secureSessionFile, sessionFilePath } from './session.js'
import { checkSession } from './kdpClient.js'

let loginInProgress = false
let loginError: string | null = null

export function getLoginState(): {
  loginInProgress: boolean
  loginError: string | null
} {
  return { loginInProgress, loginError }
}

/**
 * Open a visible browser so the user can sign in to Amazon KDP (incl. MFA).
 *
 * Throws synchronously on a display-less host (VPS, container, CI) instead of
 * spinning for ten minutes against a window that can never appear. The message
 * points at the storage_state import path in docs/HEADLESS-LOGIN.md.
 */
export async function startInteractiveLogin(): Promise<void> {
  if (loginInProgress) {
    throw new Error('Login already in progress.')
  }
  if (!hasDisplay()) {
    // Also record it on the polled state, so a client that only reads
    // getLoginState() still learns why nothing happened.
    loginError = new NoDisplayError().message
    throw new NoDisplayError()
  }

  loginInProgress = true
  loginError = null

  void (async () => {
    let browser: Awaited<ReturnType<typeof launchKdpBrowser>> | null = null
    try {
      await ensureSessionDir()
      browser = await launchKdpBrowser({ headless: false })
      const context = await browser.newContext()
      const page = await context.newPage()
      await page.goto(KDP_ROYALTIES_PAGE, { waitUntil: 'domcontentloaded' })

      const deadline = Date.now() + 10 * 60 * 1000
      while (Date.now() < deadline) {
        const url = page.url()
        if (
          url.includes('kdpreports.amazon.com') &&
          url.includes('/reports/') &&
          !url.toLowerCase().includes('signin')
        ) {
          const html = await page.content()
          if (html.includes('csrftoken":{"token":"')) {
            await context.storageState({ path: sessionFilePath() })
            await secureSessionFile()
            loginError = null
            break
          }
        }
        await page.waitForTimeout(1500)
      }

      if (!(await checkSession()).connected) {
        loginError =
          loginError ??
          'Sign-in timed out or was not completed. Try again and finish Amazon login in the browser window.'
      }
    } catch (e) {
      loginError =
        e instanceof Error ? e.message : 'Unexpected error during Amazon login.'
    } finally {
      loginInProgress = false
      await browser?.close().catch(() => {})
    }
  })()
}
