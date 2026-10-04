import type { BrowserContext, BrowserContextOptions } from 'playwright'
import { launchKdpBrowser, type LaunchOptions } from './browserLaunch.js'
import { sessionExists, sessionFilePath, saveSession, withSessionOperation } from './session.js'
import { KdpAuthError, KdpChallengeError } from './kdpClient.js'

/** Every caller reads latest state under same lock and saves refreshes on success. */
export async function withSavedBrowser<T>(fn: (context: BrowserContext) => Promise<T>,
  launch: LaunchOptions = {}, options: BrowserContextOptions = {}): Promise<T> {
  return withSessionOperation(async () => {
    if (!(await sessionExists())) throw new KdpAuthError()
    const browser = await launchKdpBrowser(launch)
    try {
      const context = await browser.newContext({ ...options, storageState: sessionFilePath() })
      return await withRefreshedState(context, fn)
    } finally { await browser.close() }
  })
}

/** Separated from launching so cookie refresh and failed-auth preservation can be tested locally. */
export async function withRefreshedState<T>(context: BrowserContext, fn: (context: BrowserContext) => Promise<T>): Promise<T> {
  let authRedirect = false
  let challenge = false
  context.on('response', response => {
    const pathname = new URL(response.url()).pathname
    if (/captcha|robotcheck/i.test(pathname)) challenge = true
    if (/\/ap\/signin|\/signin/i.test(pathname)) authRedirect = true
  })
  const result = await fn(context)
  if (challenge || context.pages().some(page => /captcha|robotcheck/i.test(page.url()))) throw new KdpChallengeError()
  if (authRedirect || context.pages().some(page => /\/ap\/signin|\/signin/i.test(page.url()))) throw new KdpAuthError()
  await saveSession(context)
  return result
}
