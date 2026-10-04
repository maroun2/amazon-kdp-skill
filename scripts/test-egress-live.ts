/** Read-only proxy check. No Amazon requests, cookies, uploads or login. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { readEgressConfig } from '../server/src/egress.js'
import { SESSION_DIR } from '../server/src/config.js'
import { launchKdpBrowser } from '../server/src/browserLaunch.js'
import { withSessionOperation } from '../server/src/session.js'

await withSessionOperation(async () => {
  const browser = await launchKdpBrowser({ headless: true })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('https://api.ipify.org', { timeout:15000 })
    const pin = JSON.parse(await fs.readFile(path.join(SESSION_DIR,'egress-ip.json'),'utf8'))
    assert.equal((await page.locator('body').innerText()).trim(),pin.ip)
    assert.equal((await (await page.request.get('https://api.ipify.org',{timeout:15000})).text()).trim(),pin.ip)
    const state = JSON.parse(await fs.readFile(path.join(SESSION_DIR,'egress-process.json'),'utf8'))
    const command = await fs.readFile(`/proc/${state.pid}/cmdline`,'utf8')
    assert.ok(command.includes('ssh') && command.includes(`127.0.0.1:${(await readEgressConfig()).socksPort}`))
    process.kill(state.pid,'SIGTERM')
    await new Promise(resolve=>setTimeout(resolve,250))
    await assert.rejects(page.request.get('https://api.ipify.org',{timeout:5000}))
    await assert.rejects(page.goto('https://api.ipify.org?no-cache=1',{timeout:5000}))
    console.log(JSON.stringify({ browserIp:pin.ip, apiIp:pin.ip, tunnelDownBrowserBlocked:true, tunnelDownApiBlocked:true, amazonRequests:0, uploads:0 }))
  } finally { await browser.close() }
  const restarted = await launchKdpBrowser({headless:true})
  await restarted.close()
  console.log(JSON.stringify({ tunnelRestartVerified:true }))
})
