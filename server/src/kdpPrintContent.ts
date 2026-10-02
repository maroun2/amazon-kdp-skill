import type { APIResponse, Page } from 'playwright'
import { KdpAuthError, KdpClientError } from './kdpClient.js'
import { kdpRequestGet } from './kdpHttp.js'
import type { KdpBookFormat } from './metadataStore.js'

export type ParsedPrintContent = {
  isbn: string
  imprint: string
  trimSize: string
  inkAndPaper: string
  interiorFileName: string
  coverFileName: string
  pageCount: string
  manuscriptStatus: string
  coverStatus: string
  bleed: boolean | null
  processingErrors: string[]
  printPreviewerStatus: string
}

type JsonObject = Record<string, unknown>
const object = (value: unknown): JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject : {}
const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : ''

/** Parse the JSON used by KDP's React print content page, not its empty HTML shell. */
export function parsePrintSetupContent(value: unknown): ParsedPrintContent | null {
  const data = object(value)
  if (!data.manufacturingSpecs || !data.publisherAssets) return null
  const specs = object(data.manufacturingSpecs)
  const interior = object(specs.interior)
  const paper = object(interior.paper)
  const trim = object(specs.trimSize)
  if (!Number.isFinite(Number(trim.width)) || Number(trim.width) <= 0 ||
      !Number.isFinite(Number(trim.height)) || Number(trim.height) <= 0 ||
      Array.isArray(data.publisherAssets)) return null
  const isbn = object(data.isbn)
  const assets = object(data.publisherAssets)
  const interiorAsset = object(object(object(assets.interiorAsset).uploaded).asset)
  const coverAsset = object(object(object(assets.coverAsset).uploaded).asset)
  const availability = object(object(data.derivedAssetsSpec).printPreviewerAvailability)
  const errors = Array.isArray(availability.unavailabilityReasons)
    ? availability.unavailabilityReasons.filter((v): v is string => typeof v === 'string') : []
  const status = (asset: JsonObject, prefix: string): string => {
    if (errors.includes(`${prefix}_PROCESSING_FAILED`)) return 'FAILED'
    if (asset.printReady === true) return 'SUCCESS'
    // A filename or recorded page count alone does not prove processing succeeded.
    return asset.sourceFileName || asset.id ? 'NOT_READY' : 'NOT_UPLOADED'
  }
  const ink = text(interior.inkColor)
  const paperColor = text(paper.color).toLowerCase()
  const inkLabel: Record<string, string> = {
    PREMIUM_COLOR: 'Premium color interior', STANDARD_COLOR: 'Standard color interior',
    BLACK_AND_WHITE: 'Black & white interior', BLACK: 'Black & white interior',
  }
  const inkAndPaper = inkLabel[ink]
    ? `${inkLabel[ink]}, ${paper.type === 'GROUNDWOOD' ? 'groundwood' : paperColor} paper`
    : [ink, text(paper.color), text(paper.type)].filter(Boolean).join(' ')
  const isFree = isbn.type === 'FREE'
  return {
    isbn: text(isFree ? isbn.freeIsbn : isbn.ownerIsbn),
    imprint: text(isFree ? isbn.freeImprint : isbn.ownerImprint),
    trimSize: trim.width != null && trim.height != null
      ? `${text(trim.width)}x${text(trim.height)}` : '',
    inkAndPaper,
    interiorFileName: text(interiorAsset.sourceFileName),
    coverFileName: text(coverAsset.sourceFileName),
    pageCount: text(object(data.derivedAssets).pageCount),
    manuscriptStatus: status(interiorAsset, 'INTERIOR'),
    coverStatus: status(coverAsset, 'COVER'),
    bleed: typeof interior.bleed === 'boolean' ? interior.bleed : null,
    processingErrors: errors,
    printPreviewerStatus: text(availability.status),
  }
}

/** Keep authentication failures distinct from unsupported legacy endpoints. */
export async function parsePrintSetupResponse(
  response: Pick<APIResponse, 'status' | 'url' | 'json'>,
): Promise<ParsedPrintContent | null> {
  if ([401, 403].includes(response.status()) || /\/ap\/|signin/i.test(response.url())) {
    throw new KdpAuthError()
  }
  if ([404, 405].includes(response.status())) return null
  if (response.status() < 200 || response.status() >= 300) {
    throw new KdpClientError(`KDP print content request failed (${response.status()}).`)
  }
  let data: unknown
  try { data = await response.json() } catch {
    throw new KdpClientError('KDP print content returned non-JSON data; metadata was not saved.')
  }
  const parsed = parsePrintSetupContent(data)
  if (!parsed) throw new KdpClientError('KDP print content schema changed; metadata was not saved.')
  return parsed
}

export async function fetchPrintSetupContent(
  page: Page, titleId: string, format: KdpBookFormat,
): Promise<ParsedPrintContent | null> {
  if (format === 'kindle') return null
  const url = `https://kdp.amazon.com/print-setup/print-book/${encodeURIComponent(titleId)}/${format}/en-US/v2/get-setup-page`
  return parsePrintSetupResponse(await kdpRequestGet(page, url))
}
