import assert from 'node:assert/strict'
import {test} from 'node:test'
import {launchKdpBrowser} from '../server/src/browserLaunch.js'
import {printUploadInput} from './upload-print-content.js'

test('modern hidden PDF inputs are isolated by actual upload buttons, not order or legacy IDs',async()=>{
  const browser=await launchKdpBrowser({headless:true})
  try {
    const page=await browser.newPage()
    await page.setContent(`<div><input type="file" accept=".pdf" data-test="cover" style="display:none"><div><button aria-label="Upload your cover file">Upload your cover file</button></div></div>
      <div><input type="file" accept=".pdf,.docx" data-test="interior" style="display:none"><div><button aria-label="Upload manuscript">Upload manuscript</button></div></div>`)
    for (const fileType of ['interior','cover'] as const) {
      const {fileInput}=printUploadInput(page,fileType)
      assert.equal(await fileInput.count(),1)
      assert.equal(await fileInput.getAttribute('data-test'),fileType)
    }
  } finally {await browser.close()}
})

import {changesApplied} from '../server/src/kdpMetadataUpdate.js'
import {normalizeBookMetadata} from '../server/src/metadataStore.js'
test('metadata verification rejects same-prefix descriptions and wrong large-print flags',()=>{
  const description='A'.repeat(90)+' Full ending.'
  const book=normalizeBookMetadata({titleId:'EXAMPLETITLE',format:'paperback',title:'Example',description,largePrint:false,syncedAt:''})
  assert.equal(changesApplied(book,{descriptionHtml:description,largePrint:false}),true)
  assert.equal(changesApplied(book,{descriptionHtml:'A'.repeat(90)+' Wrong ending.'}),false)
  assert.equal(changesApplied(book,{largePrint:true}),false)
})
