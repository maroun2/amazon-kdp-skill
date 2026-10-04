import { KDP_API, KDP_ROYALTIES_PAGE } from './config.js'
import { hasDisplay, launchKdpBrowser, NoDisplayError } from './browserLaunch.js'
import { saveSession, withSessionOperation, sessionExists, sessionFilePath } from './session.js'
import { KdpClientError } from './kdpClient.js'
import { kdpFetchJson } from './kdpHttp.js'

let loginInProgress = false
let loginError: string | null = null
export function getLoginState() { return { loginInProgress, loginError } }

/** User handles normal Amazon sign-in/MFA. Existing state survives failed login. */
export async function startInteractiveLogin(): Promise<void> {
  if (loginInProgress) throw new Error('Login already in progress.')
  if (!hasDisplay()) { loginError = new NoDisplayError().message; throw new NoDisplayError() }
  loginInProgress = true
  loginError = null
  void withSessionOperation(async () => {
    const browser = await launchKdpBrowser({ headless: false })
    try {
      const context = await browser.newContext(await sessionExists() ? { storageState: sessionFilePath() } : {})
      const page = await context.newPage()
      await page.goto(KDP_ROYALTIES_PAGE, { waitUntil: 'domcontentloaded' })
      const deadline = Date.now() + 10 * 60 * 1000
      while (Date.now() < deadline) {
        if (new URL(page.url()).hostname === 'kdpreports.amazon.com' && page.url().includes('/reports/')) {
          const html = await page.content()
          if (html.includes('csrftoken":{"token":"')) {
            const account = await kdpFetchJson<{ customerAccountInfoModel?: object }>(page, KDP_API.accountInfo)
            if (!account?.customerAccountInfoModel) throw new KdpClientError('Login dashboard loaded but account response is unreadable. Existing session preserved.')
            await saveSession(context)
            return
          }
        }
        await page.waitForTimeout(1500)
      }
      throw new Error('Sign-in timed out. Existing session preserved. Finish normal Amazon login and MFA before retrying.')
    } finally { await browser.close() }
  }).catch(error => { loginError = error instanceof Error ? error.message : 'Unexpected Amazon login error.' })
    .finally(() => { loginInProgress = false })
}
