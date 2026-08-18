/**
 * A-share stock search through the Tencent smart-box endpoint.
 * Only Shanghai / Shenzhen / Beijing A-share candidates are returned,
 * mirroring the Hermes backend `search_a_stocks` behavior.
 */
import type { StockCandidate } from './types.js'

const TENCENT_SEARCH_URL = 'https://proxy.finance.qq.com/ifzqgtimg/appstock/smartbox/search/get'

const CODE_PATTERN = /^(?:(?:sh|sz|bj)\d{6}|hk\d{5}|(?:usr_|gb_)[a-z0-9._-]+)$/i

function normalizeCode(value: string): string {
  return value.trim().replace(/\$/g, '.').toLowerCase()
}

/** Parse a raw Tencent search payload into A-share candidates. */
export function parseTencentStockSearch(payload: unknown): StockCandidate[] {
  if (typeof payload !== 'object' || payload === null) return []
  const data = (payload as Record<string, unknown>).data
  const candidates = (typeof data === 'object' && data !== null
    ? (data as Record<string, unknown>).stock
    : []) as unknown
  if (!Array.isArray(candidates)) return []
  const result: StockCandidate[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || candidate.length < 3) continue
    const market = String(candidate[0] ?? '').trim().toLowerCase()
    const code = normalizeCode(`${market}${candidate[1]}`)
    const name = String(candidate[2] ?? '').trim()
    if (market !== 'sh' && market !== 'sz' && market !== 'bj') continue
    if (!CODE_PATTERN.test(code) || !name) continue
    if (seen.has(code)) continue
    seen.add(code)
    result.push({ code, name })
  }
  return result
}

/** Search A-share stocks by code or Chinese name. */
export async function searchAStocks(keyword: string, timeoutMs = 8000, signal?: AbortSignal): Promise<StockCandidate[]> {
  const query = keyword.trim()
  if (!query) return []
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal
  try {
    const url = new URL(TENCENT_SEARCH_URL)
    url.searchParams.set('q', query)
    const response = await fetch(url, {
      signal: combined,
      headers: {
        Accept: '*/*',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload: unknown = await response.json()
    return parseTencentStockSearch(payload)
  } finally {
    clearTimeout(timer)
  }
}
