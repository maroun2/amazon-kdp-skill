#!/usr/bin/env node
/**
 * Verify the stored Amazon session works, without the server running.
 * Usage: npm run session:verify
 *
 * Makes one throttled request to KDP reports. Prints no cookie values.
 */
import { checkSession } from '../server/src/kdpClient.js'
import {
  readSessionMeta,
  sessionExists,
  sessionFileIsPrivate,
  sessionFilePath,
} from '../server/src/session.js'
import { hasDisplay, resolveChromiumExecutablePath } from '../server/src/browserLaunch.js'

console.log(`Session file: ${sessionFilePath()}`)
console.log(`Display available: ${hasDisplay() ? 'yes' : 'no (headless-only host)'}`)
console.log(`Chromium: ${resolveChromiumExecutablePath() ?? 'NOT FOUND'}`)

if (!(await sessionExists())) {
  console.error('\nNo session file. Import one: npm run session:import -- <storage-state.json>')
  console.error('See docs/HEADLESS-LOGIN.md')
  process.exit(1)
}

if (!(await sessionFileIsPrivate())) {
  console.error('\nWARNING: session file is readable by other users. Fix with:')
  console.error(`  chmod 600 ${sessionFilePath()}`)
}

const { savedAt } = await readSessionMeta()
console.log(`Saved at: ${savedAt ?? 'unknown'}`)

const result = await checkSession().catch(error => {
  console.error(JSON.stringify({ code: error.code ?? (error.name === 'KdpClientError' ? 'kdp' : 'unknown'), error: error.message }))
  console.error('Fix reported error before requesting login. Saved session preserved.')
  process.exit(2)
})
if (!result.connected) {
  console.error('\nSession is NOT valid — Amazon redirected to sign-in, or the cookies expired.')
  console.error('Route is healthy but Amazon requires authentication. Run npm run login:remote once.')
  process.exit(1)
}

console.log('\nSession is valid. Connected to Amazon KDP.')
if (result.accountCreationDate) {
  console.log(`Account creation date reported by KDP: ${result.accountCreationDate}`)
}
