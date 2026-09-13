#!/usr/bin/env node
/**
 * Prove the resolved Chromium actually launches, without touching Amazon.
 * Usage: npm run browser:check
 */
import {
  defaultHeadless,
  hasDisplay,
  launchKdpBrowser,
  resolveChromiumExecutablePath,
} from '../server/src/browserLaunch.js'
import { getKdpRequestDelayRangeMs } from '../server/src/kdpRateLimit.js'

const { minMs, maxMs } = getKdpRequestDelayRangeMs()
console.log(`Display available: ${hasDisplay() ? 'yes' : 'no (headless-only host)'}`)
console.log(`Default headless: ${defaultHeadless()}`)
console.log(`Request delay window: ${minMs}-${maxMs}ms`)

const exe = resolveChromiumExecutablePath()
console.log(`Resolved Chromium: ${exe ?? 'NOT FOUND'}`)
if (!exe) {
  console.error('\nNo Chromium found. Set KDP_CHROMIUM_PATH or run: npx playwright install chromium')
  process.exit(1)
}

const started = Date.now()
const browser = await launchKdpBrowser({ headless: true })
try {
  const page = await browser.newPage()
  await page.setContent('<h1 id="probe">kdp browser check</h1>')
  const text = await page.textContent('#probe')
  if (text !== 'kdp browser check') {
    console.error(`FAIL: unexpected page text ${JSON.stringify(text)}`)
    process.exit(1)
  }
  const rss = process.memoryUsage().rss
  console.log(`Browser version: ${browser.version()}`)
  console.log(`Launch + render: ${Date.now() - started}ms`)
  console.log(`Node RSS: ${(rss / 1024 / 1024).toFixed(0)} MB (browser runs in its own processes)`)
  console.log('PASS: Chromium launched and rendered a page.')
} finally {
  await browser.close()
}
