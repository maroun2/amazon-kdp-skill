import { launchKdpBrowser } from '../server/src/browserLaunch.js'
import { readEgressConfig } from '../server/src/egress.js'

try {
  const browser = await launchKdpBrowser({ headless: true })
  await browser.close()
  const config = await readEgressConfig()
  console.log(JSON.stringify({ ok: true, route: `${config.sshUser}@${config.sshHost}:${config.sshPort}`, socksPort: config.socksPort, browserAndApiIpMatch: true }))
} catch (error) {
  const e = error as Error & { code?: string }
  console.error(JSON.stringify({ ok: false, code: e.code ?? 'unknown', error: e.message }))
  process.exitCode = 1
}
