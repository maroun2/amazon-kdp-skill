#!/usr/bin/env node
/** Read print settings and KDP's reported processing failures without changing a book. */
import { withKdpPage } from '../server/src/kdpMetadata.js'
import { fetchPrintSetupContent } from '../server/src/kdpPrintContent.js'

async function main() {
  const [titleId, format = 'paperback'] = process.argv.slice(2).filter((arg) => arg !== '--json')
  if (!titleId || !/^[A-Z0-9]{10,14}$/.test(titleId) || !['paperback', 'hardcover'].includes(format)) {
    throw new Error('Usage: npm run content:status -- TITLE_ID paperback|hardcover [--json]')
  }
  await withKdpPage(async (page) => {
    const content = await fetchPrintSetupContent(page, titleId, format as 'paperback' | 'hardcover')
    if (!content) throw new Error('This title uses legacy content setup; use npm run sync:book instead.')
    console.log(JSON.stringify({ titleId, format, ...content }, null, 2))
  })
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
