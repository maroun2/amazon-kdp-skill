import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePrintSetupContent, parsePrintSetupResponse, type ParsedPrintContent } from '../server/src/kdpPrintContent.js'
import { normalizeBookMetadata } from '../server/src/metadataStore.js'
import fs from 'node:fs'
import { launchKdpBrowser } from '../server/src/browserLaunch.js'

const failed = () => ({
  isbn: { type: 'FREE', freeIsbn: '9790000000000', freeImprint: 'Independently published' },
  manufacturingSpecs: {
    trimSize: { width: 8, height: 10, unit: 'INCHES' },
    interior: { bleed: true, inkColor: 'PREMIUM_COLOR', paper: { color: 'WHITE', type: 'STANDARD' } },
  },
  publisherAssets: {
    interiorAsset: { uploaded: { asset: { sourceFileName: 'diagnostic.pdf', printReady: false } } },
    coverAsset: { uploaded: { asset: { sourceFileName: 'cover.pdf', printReady: false } } },
  },
  derivedAssets: { pageCount: 42 },
  derivedAssetsSpec: { printPreviewerAvailability: {
    status: 'UNAVAILABLE', unavailabilityReasons: ['INTERIOR_PROCESSING_FAILED', 'COVER_PROCESSING_FAILED'],
  } },
})
const response = (status: number, data: unknown, url = 'https://kdp.amazon.com/get-setup-page') =>
  ({ status: () => status, url: () => url, json: async () => data })

test('failed uploads retain actual filenames, print settings and separate failure codes', () => {
  const parsed = parsePrintSetupContent(failed())!
  assert.equal(parsed.isbn, '9790000000000')
  assert.equal(parsed.trimSize, '8x10')
  assert.equal(parsed.inkAndPaper, 'Premium color interior, white paper')
  assert.equal(parsed.bleed, true)
  assert.equal(parsed.interiorFileName, 'diagnostic.pdf')
  assert.equal(parsed.coverFileName, 'cover.pdf')
  assert.equal(parsed.pageCount, '42')
  assert.equal(parsed.manuscriptStatus, 'FAILED')
  assert.equal(parsed.coverStatus, 'FAILED')
  assert.deepEqual(parsed.processingErrors, ['INTERIOR_PROCESSING_FAILED', 'COVER_PROCESSING_FAILED'])
  assert.equal(parsed.printPreviewerStatus, 'UNAVAILABLE')
})
test('page count alone does not mark an uploaded manuscript as successful', () => {
  const data = failed()
  data.derivedAssetsSpec.printPreviewerAvailability.unavailabilityReasons = []
  assert.equal(parsePrintSetupContent(data)!.manuscriptStatus, 'NOT_READY')
})
test('ready assets preserve SUCCESS status consumed by existing upload checks', () => {
  const data = failed()
  data.derivedAssetsSpec.printPreviewerAvailability = { status: 'AVAILABLE', unavailabilityReasons: [] }
  data.publisherAssets.interiorAsset.uploaded.asset.printReady = true
  data.publisherAssets.coverAsset.uploaded.asset.printReady = true
  assert.equal(parsePrintSetupContent(data)!.manuscriptStatus, 'SUCCESS')
  assert.equal(parsePrintSetupContent(data)!.coverStatus, 'SUCCESS')
})
test('empty draft differs from an unreadable shell and unknown schema', () => {
  const data = { ...failed(), publisherAssets: {}, derivedAssets: {}, derivedAssetsSpec: {} }
  assert.equal(parsePrintSetupContent(data)!.manuscriptStatus, 'NOT_UPLOADED')
  assert.equal(parsePrintSetupContent(data)!.pageCount, '')
  assert.equal(parsePrintSetupContent({}), null)
  assert.equal(parsePrintSetupContent({ manufacturingSpecs: {}, publisherAssets: {} }), null)
})
test('expired auth is never treated as an unsupported legacy endpoint', async () => {
  await assert.rejects(parsePrintSetupResponse(response(200, {}, 'https://www.amazon.com/ap/signin')), { name: 'KdpAuthError' })
  await assert.rejects(parsePrintSetupResponse(response(401, {})), { name: 'KdpAuthError' })
  await assert.rejects(parsePrintSetupResponse(response(403, {})), { name: 'KdpAuthError' })
})
test('unsupported endpoint allows legacy fallback, server failure does not cache blanks', async () => {
  assert.equal(await parsePrintSetupResponse(response(404, {})), null)
  assert.equal(await parsePrintSetupResponse(response(405, {})), null)
  await assert.rejects(parsePrintSetupResponse(response(500, {})), /failed \(500\)/)
})
test('unexpected JSON and HTML fail with actionable errors', async () => {
  await assert.rejects(parsePrintSetupResponse(response(200, {})), /schema changed/)
  await assert.rejects(parsePrintSetupResponse({ ...response(200, null), json: async () => { throw new Error('HTML') } }), /non-JSON/)
})
test('old metadata caches gain safe defaults without inventing failure causes', () => {
  const old = normalizeBookMetadata({ titleId: 'EXAMPLETITLE', format: 'paperback', title: 'Example', syncedAt: '' })
  assert.equal(old.bleed, null)
  assert.deepEqual(old.processingErrors, [])
  assert.equal(old.printPreviewerStatus, '')
  const current = normalizeBookMetadata({ ...old, ...parsePrintSetupContent(failed())! })
  assert.deepEqual(current.processingErrors, ['INTERIOR_PROCESSING_FAILED', 'COVER_PROCESSING_FAILED'])
})

test('legacy server-rendered form still reads settings and processing status', async () => {
  const browser = await launchKdpBrowser({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(`<input name="data[print_book][trim_size][width]" value="8">
      <input name="data[print_book][trim_size][height]" value="10">
      <input name="data[print_book][interior_has_bleed]" type="radio" value="false" checked>
      <input name="data[print_book][publisher_interior][source_file_name]" value="legacy.pdf">
      <input name="data[print_book][publisher_interior][status]" value="SUCCESS">`)
    const parser = fs.readFileSync(new URL('../server/browser/parseBookContent.js', import.meta.url), 'utf8')
    const content = await page.evaluate<ParsedPrintContent>(`(${parser})()`)
    assert.equal(content.trimSize, '8x10')
    assert.equal(content.interiorFileName, 'legacy.pdf')
    assert.equal(content.manuscriptStatus, 'SUCCESS')
    assert.equal(content.bleed, false)
    assert.deepEqual(content.processingErrors, [])
  } finally { await browser.close() }
})
