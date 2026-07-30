import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

export const PORT = Number(process.env.KDP_SERVER_PORT || 3001)

function envInt(name: string): number | null {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * Gap between KDP page loads and API calls, drawn uniformly at random from
 * [KDP_REQUEST_DELAY_MIN_MS, KDP_REQUEST_DELAY_MAX_MS] before every request.
 * A fixed cadence is the easiest automation tell there is; jitter also spreads
 * bursts out so Amazon is less likely to answer with "Server Busy".
 *
 * Back-compat: the single-value KDP_REQUEST_DELAY_MS (and its legacy alias
 * KDP_UPDATE_DELAY_MS) pins both ends, reproducing the old fixed delay exactly.
 */
const FIXED_DELAY_MS = envInt('KDP_REQUEST_DELAY_MS') ?? envInt('KDP_UPDATE_DELAY_MS')

const rawMin = FIXED_DELAY_MS ?? envInt('KDP_REQUEST_DELAY_MIN_MS') ?? 4000
const rawMax = FIXED_DELAY_MS ?? envInt('KDP_REQUEST_DELAY_MAX_MS') ?? 10_000

export const KDP_REQUEST_DELAY_MIN_MS = Math.max(0, rawMin)

/** Never below the minimum — a misconfigured max must not shorten the throttle. */
export const KDP_REQUEST_DELAY_MAX_MS = Math.max(
  KDP_REQUEST_DELAY_MIN_MS,
  rawMax,
)

/** Directory for Playwright storage state (Amazon session cookies). */
export const SESSION_DIR =
  process.env.KDP_SESSION_DIR || path.join(repoRoot, '.kdp-session')

export const SESSION_FILE = path.join(SESSION_DIR, 'amazon-kdp.json')

export const KDP_REPORTS_ORIGIN = 'https://kdpreports.amazon.com'

export const KDP_ROYALTIES_PAGE = `${KDP_REPORTS_ORIGIN}/reports/royalties`

export const KDP_PMR_PAGE = `${KDP_REPORTS_ORIGIN}/reports/pmr`

export const KDP_API = {
  accountInfo: `${KDP_REPORTS_ORIGIN}/metadata/customer/accountInfo`,
  /** Full catalog: titles, ASINs, authors (no titleId — use Bookshelf for that). */
  reportsMetadata: `${KDP_REPORTS_ORIGIN}/metadata/reports/reportsMetadata`,
  customerMetadata: `${KDP_REPORTS_ORIGIN}/api/v2/reports/customerMetadata`,
  booksMetadata: `${KDP_REPORTS_ORIGIN}/api/v2/reports/booksMetadata`,
  pagesReadByAsin: `${KDP_REPORTS_ORIGIN}/api/v2/reports/pagesReadByAsin`,
  /** Amazon’s URL uses `.xslx` (typo) — keep as-is. */
  generateReport: `${KDP_REPORTS_ORIGIN}/download/report/royaltiesestimator/en_US/royaltiesEstimatorReport.xslx`,
  pmrReport: `${KDP_REPORTS_ORIGIN}/download/report/pmr/en_US/pmrReport.xslx`,
} as const
