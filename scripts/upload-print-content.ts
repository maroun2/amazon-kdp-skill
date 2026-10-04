import { uploadFile } from '../server/src/uploadQuota.js'
/** One modern print upload. No processing retries, preview approval, or publication. */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import type { Page } from 'playwright'
import { withKdpPage, setupPageUrl } from '../server/src/kdpMetadata.js'
import { fetchPrintSetupContent } from '../server/src/kdpPrintContent.js'
import { kdpGoto } from '../server/src/kdpHttp.js'
import { kdpThrottle } from '../server/src/kdpRateLimit.js'

export function printUploadInput(page: Page, fileType: 'interior' | 'cover') {
  const button = page.getByRole('button',{name:fileType === 'interior' ? 'Upload manuscript' : 'Upload your cover file',exact:true})
  return {button,fileInput:button.locator('xpath=../..').locator('input[type="file"]')}
}

/** Headful Chromium on Linux needs a display, even for a saved-session upload. */
async function withUploadDisplay<T>(fn: () => Promise<T>): Promise<T> {
  if (process.platform !== 'linux' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return fn()
  const display = spawn('Xvfb',['-displayfd','3','-screen','0','1920x1080x24','-nolisten','tcp'],{stdio:['ignore','ignore','ignore','pipe']})
  try {
    const number = await new Promise<string>((resolve,reject)=>{
      const timer = setTimeout(()=>reject(Error('Xvfb did not become ready. Install Xvfb or provide DISPLAY.')),5000)
      let buffer = ''
      display.once('error',e=>{clearTimeout(timer);reject(e)})
      display.once('exit',code=>{clearTimeout(timer);reject(Error(`Xvfb exited (${code}).`))})
      display.stdio[3]?.on('data',chunk=>{
        buffer += chunk.toString()
        if (/^\d+\n/.test(buffer)) {clearTimeout(timer);resolve(buffer.trim())}
      })
    })
    process.env.DISPLAY = `:${number}`
    return await fn()
  } finally {
    delete process.env.DISPLAY
    display.kill('SIGTERM')
  }
}

async function main() {
  const [specPath] = process.argv.slice(2).filter(x => !x.startsWith('--'))
  if (!specPath) throw Error('Usage: upload:print-content -- spec.json [--dry-run]')
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'))
  const { titleId, format, fileType, filePath, expected } = spec
  if (!/^[A-Z0-9]{10,14}$/.test(titleId) || !['paperback','hardcover'].includes(format) ||
      !['interior','cover'].includes(fileType) || !path.isAbsolute(filePath) || !fs.existsSync(filePath) ||
      path.extname(filePath).toLowerCase() !== '.pdf' || !expected?.trimSize || typeof expected.bleed !== 'boolean' || !expected.inkAndPaper)
    throw Error('Invalid spec: require existing absolute PDF, print title/format/type and expected print settings.')
  if (fs.statSync(filePath).size > 650_000_000) throw Error('PDF exceeds KDP file limit.')
  const dryRun = process.argv.includes('--dry-run')
  await withUploadDisplay(() => withKdpPage(async page => {
    page.setDefaultTimeout(30000)
    const before = await fetchPrintSetupContent(page, titleId, format)
    if (!before) throw Error('Modern print setup unavailable; use legacy upload endpoint.')
    for (const key of ['trimSize','bleed','inkAndPaper'] as const)
      if (before[key] !== expected[key]) throw Error(`Print setting mismatch: ${key}, got ${JSON.stringify(before[key])}`)
    await kdpGoto(page, setupPageUrl(format,titleId,'content'), {waitUntil:'domcontentloaded',timeout:30000})
    if (/\/ap\/|signin|captcha|robotcheck/i.test(page.url()) || await page.locator('#captchacharacters').count()) throw Error('Authentication or CAPTCHA requires user handoff.')
    const {button,fileInput} = printUploadInput(page,fileType)
    await button.waitFor({state:'visible'})
    if (/\/ap\/|signin|captcha/i.test(page.url())) throw Error('Authentication or CAPTCHA requires user handoff.')
    // Bound to nearest common parent, never generic first PDF input.
    if (await fileInput.count() !== 1 || !(await button.isEnabled())) throw Error('Upload control unavailable or ambiguous.')
    const accept = await fileInput.getAttribute('accept')
    if (!accept?.includes('.pdf')) throw Error('Selected upload control does not accept PDF files.')
    if (expected.coverFinish && !(await page.locator(`#cover-finish-${expected.coverFinish}`).isChecked())) throw Error('Cover finish mismatch.')
    if (typeof expected.hasPublisherBarcode === 'boolean' && (await page.locator('#publisher-barcode').getAttribute('aria-checked') === 'true') !== expected.hasPublisherBarcode) throw Error('Barcode setting mismatch.')
    console.log(JSON.stringify({dryRun,titleId,format,fileType,fileName:path.basename(filePath),accept,settings:before}))
    if (dryRun) return
    if (spec.aiImages) {
      const imageSelect = page.getByRole('combobox').filter({hasText:/AI-generated images/})
      if (!(await imageSelect.innerText()).includes(spec.aiImages)) {
        await imageSelect.click()
        await page.getByRole('option',{name:spec.aiImages,exact:true}).click()
      }
    }
    page.on('response',r=>{
      const u = new URL(r.url())
      if (/upload|asset|save|setup-page/i.test(u.pathname) && r.request().method() !== 'GET')
        console.log(JSON.stringify({requestPath:u.pathname,status:r.status(),method:r.request().method()}))
    })
    await kdpThrottle()
    const assetType = fileType === 'interior' ? 'KDP_PRINT_BOOK_PUBLISHER_INTERIOR' : 'KDP_PRINT_BOOK_PUBLISHER_COVER'
    const transferred = page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith(`/${assetType}`),{timeout:60000})
    await uploadFile(fileInput, filePath)
    const transferResponse = await transferred
    if (!transferResponse.ok()) throw Error(`KDP file transfer failed (${transferResponse.status()}). No retry performed.`)
    // Upload completion is distinct from background PDF processing. Let KDP finish
    // uploading bytes, then persist draft. Read content:status separately.
    try { await page.getByText(path.basename(filePath),{exact:false}).first().waitFor({timeout:60000}) }
    catch (error) {
      console.log(JSON.stringify({after:await fetchPrintSetupContent(page,titleId,format),visibleText:(await page.locator('body').innerText()).slice(-9000)}))
      throw error
    }
    if (spec.confirmAiDisclosure) {
      const confirmation = page.getByRole('checkbox',{name:'By clicking this, I confirm that my answers are accurate',exact:true})
      if (await confirmation.count() === 1 && await confirmation.getAttribute('aria-checked') === 'false') await confirmation.click()
    }
    const save = page.getByRole('button',{name:'Save as Draft',exact:true})
    await save.waitFor({state:'visible'})
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.trim()==='Save as Draft'&&!b.disabled),null,{timeout:20000})
    await kdpThrottle()
    const savedResponse = page.waitForResponse(r => r.request().method()==='POST' && /save|setup-page/i.test(new URL(r.url()).pathname),{timeout:30000})
    await save.click()
    const response = await savedResponse
    console.log(JSON.stringify({saveHttpStatus:response.status(),savePath:new URL(response.url()).pathname}))
    if (!response.ok()) throw Error(`KDP draft save failed (${response.status()}). No retry performed.`)
    const after = await fetchPrintSetupContent(page,titleId,format)
    console.log(JSON.stringify({after}))
    if (after?.[fileType === 'interior' ? 'interiorFileName' : 'coverFileName'] !== path.basename(filePath)) throw Error('KDP did not persist uploaded filename. No retry performed.')
  },{headless:false}))
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href)
  main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1})
