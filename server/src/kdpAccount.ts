import { withSavedBrowser } from './savedBrowser.js'
import type { Page } from 'playwright'
import { KdpAuthError, KdpClientError } from './kdpClient.js'
import { kdpFetchJson } from './kdpHttp.js'
import { kdpGoto } from './kdpHttp.js'
import { fetchReportsMetadata } from './kdpReportsApi.js'
import { KDP_API, KDP_ROYALTIES_PAGE } from './config.js'
import { sessionExists } from './session.js'

export type KdpAccountInfo = {
  accountCreationDate: string
  catalogSize: number
  vendorCode: string
  reportingExperience: string
}

export type KdpCatalogBook = {
  key: string
  title: string
  author: string
  coverImageUrl: string
  printAsin: string | null
  digitalAsin: string | null
  hardcoverAsin: string | null
  printIsbn: string | null
  publishedDatePrint: string | null
  publishedDateDigital: string | null
}

async function withReportsPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  return withSavedBrowser(async context => {
    const page = await context.newPage()
    await kdpGoto(page, KDP_ROYALTIES_PAGE, { waitUntil: 'networkidle', timeout: 120_000 })
    if (/signin|captcha|robotcheck/i.test(page.url())) throw new KdpAuthError()
    return await fn(page)
  }, { headless: true })
}

export async function fetchAccountInfo(): Promise<KdpAccountInfo> {
  return withReportsPage(async (page) => {
    const data = await kdpFetchJson<{
      customerAccountInfoModel?: {
        accountCreationDate?: string
        catalogSize?: number
        vendorCode?: string
        reportingExperience?: string
      }
    }>(page, KDP_API.accountInfo)

    const model = data?.customerAccountInfoModel
    if (!model?.accountCreationDate) {
      throw new KdpClientError('Could not read KDP account info.')
    }

    return {
      accountCreationDate: model.accountCreationDate,
      catalogSize: model.catalogSize ?? 0,
      vendorCode: model.vendorCode ?? '',
      reportingExperience: model.reportingExperience ?? '',
    }
  })
}

function parseCatalogBook(key: string, raw: Record<string, unknown>): KdpCatalogBook {
  const asins = (raw.asins ?? {}) as Record<string, string | null>
  const published = (raw.publishedDate ?? {}) as Record<string, string | null>
  return {
    key,
    title: String(raw.titleName ?? ''),
    author: String(raw.author ?? ''),
    coverImageUrl: String(raw.coverImageUrl ?? ''),
    printAsin: asins.print ?? null,
    digitalAsin: asins.digital ?? null,
    hardcoverAsin: asins.hardcover ?? null,
    printIsbn: asins.printisbn ?? null,
    publishedDatePrint: published.print ?? null,
    publishedDateDigital: published.digital ?? null,
  }
}

export async function fetchReportsCatalog(): Promise<KdpCatalogBook[]> {
  return withReportsPage(async (page) => {
    const data = await fetchReportsMetadata(page)
    const books = data?.reportsMetadata?.books
    if (!books || typeof books !== 'object') {
      throw new KdpClientError('Could not read KDP reports catalog.')
    }

    return Object.entries(books)
      .map(([key, raw]) => parseCatalogBook(key, raw as Record<string, unknown>))
      .sort((a, b) => a.title.localeCompare(b.title))
  })
}
