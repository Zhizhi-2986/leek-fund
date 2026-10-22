/**
 * Market data fetching and parsing for dsh-leek-fund.
 *
 * Field semantics are ported from the Hermes plugin backend
 * (dashboard/plugin_api.py): Sina quotes for A-shares and global indices,
 * Tencent speed rankings, Eastmoney industry metadata, and ETF price
 * truncation to three decimals.
 */
import type { Quote, SpeedRankingItem } from './types.js'

const SINA_QUOTE_URL = 'https://hq.sinajs.cn/list='
const TENCENT_SPEED_RANKING_URL = 'https://proxy.finance.qq.com/cgi/cgi-bin/rank/hs/getBoardRankList'
const EASTMONEY_BASIC_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get'
const SECTOR_CACHE_TTL_MS = 10 * 60_000
const EMPTY_SECTOR_CACHE_TTL_MS = 30_000

const SINA_LINE_PATTERN = /^var hq_str_([^=]+)="([^"]*)";?$/gm

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

interface TencentSpeedRankingRow {
  code?: unknown
  name?: unknown
  zxj?: unknown // latest price
  zdf?: unknown // daily percent
  zd?: unknown // price change
  speed?: unknown // five-minute speed
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function normalizeTencentCode(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase()
  if (/^(sh|sz|bj)\d{6}$/.test(raw)) return raw
  if (!/^\d{6}$/.test(raw)) return ''
  if (raw.startsWith('6')) return `sh${raw}`
  if (raw.startsWith('0') || raw.startsWith('3')) return `sz${raw}`
  if (raw.startsWith('4') || raw.startsWith('8') || raw.startsWith('9')) return `bj${raw}`
  return ''
}

function rankingRows(payload: unknown): unknown[] {
  const data = record(record(payload)?.data)
  return Array.isArray(data?.rank_list) ? data.rank_list : []
}

/** Parse Tencent's live A-share five-minute speed ranking. */
export function parseTencentSpeedRanking(payload: unknown, limit = 20): SpeedRankingItem[] {
  return rankingRows(payload)
    .map((raw) => {
      const row = record(raw) as TencentSpeedRankingRow | undefined
      if (!row) return undefined
      const code = normalizeTencentCode(row.code)
      const name = String(row.name ?? '').trim()
      const price = finiteNumber(row.zxj)
      const percent = finiteNumber(row.zdf)
      const speed = finiteNumber(row.speed)
      const yestclose = price !== undefined && percent !== undefined && percent > -100
        ? price / (1 + percent / 100)
        : undefined
      if (!code || !name || price === undefined || price <= 0 || speed === undefined || yestclose === undefined || yestclose <= 0) {
        return undefined
      }
      const updown = finiteNumber(row.zd) ?? price - yestclose
      return {
        code,
        name,
        price,
        yestclose,
        open: price,
        high: price,
        low: price,
        updown,
        percent: percent ?? (updown / yestclose) * 100,
        time: '',
        available: true,
        speed,
        sector: '',
      }
    })
    .filter((item): item is SpeedRankingItem => item !== undefined)
    .sort((left, right) => right.speed - left.speed || left.code.localeCompare(right.code))
    .slice(0, Math.max(0, limit))
}

function sectorFromLevel(value: unknown): string {
  if (typeof value !== 'string') return ''
  const levels = value.split('-').map((item) => item.trim()).filter(Boolean)
  if (levels.length === 0) return ''
  return levels.length > 1 ? levels[levels.length - 2] : levels[0]
}

function eastmoneySectorRows(payload: unknown): unknown[] {
  const result = record(record(payload)?.result)
  return Array.isArray(result?.data) ? result.data : []
}

function parseEastmoneySectors(payload: unknown): Map<string, string> {
  const sectors = new Map<string, string>()
  for (const raw of eastmoneySectorRows(payload)) {
    const row = record(raw)
    const secucode = String(row?.SECUCODE ?? '').trim().toUpperCase()
    if (!secucode) continue
    sectors.set(secucode, sectorFromLevel(row?.BOARD_NAME_LEVEL))
  }
  return sectors
}

/** Parse one Eastmoney industry hierarchy response into its sector label. */
export function parseEastmoneySector(payload: unknown): string {
  return parseEastmoneySectors(payload).values().next().value ?? ''
}

/** Whether a code/name pair denotes an ETF (three-decimal display rule). */
export function isEtf(code: string, name: string): boolean {
  return (
    code.startsWith('sh51') ||
    code.startsWith('sh52') ||
    code.startsWith('sh56') ||
    code.startsWith('sh588') ||
    code.startsWith('sh589') ||
    code.startsWith('sz159') ||
    name.toUpperCase().includes('ETF')
  )
}

/** Truncate a positive decimal to `digits` fractional digits (never rounds). */
function truncateDecimal(value: number, digits: number): string {
  const text = value.toFixed(digits + 2)
  const dot = text.indexOf('.')
  const intPart = dot < 0 ? text : text.slice(0, dot)
  const fracPart = dot < 0 ? '' : text.slice(dot + 1)
  return `${intPart}.${fracPart.slice(0, digits).padEnd(digits, '0')}`
}

function formatPrice(value: number, digits: number): string {
  return value.toFixed(digits)
}

/** Display price following the ETF / low-price rules. */
export function displayPrice(code: string, name: string, value: number): string {
  if (isEtf(code, name)) return truncateDecimal(value, 3)
  return formatPrice(value, value < 1 ? 3 : 2)
}

/** Display percent with an explicit sign, e.g. "+1.23%". */
export function formatPercent(percent: number): string {
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`
}

function quote(
  code: string,
  name: string,
  priceValue: number,
  closeValue: number,
  openValue = 0,
  highValue = 0,
  lowValue = 0,
  timeText = ''
): Quote | undefined {
  if (!name || priceValue <= 0) return undefined
  const updown = priceValue - closeValue
  const percent = closeValue ? (updown / closeValue) * 100 : 0
  return {
    code,
    name,
    price: priceValue,
    yestclose: closeValue,
    open: openValue,
    high: highValue,
    low: lowValue,
    updown,
    percent,
    time: timeText,
    available: true,
  }
}

function parseSinaCn(code: string, params: string[]): Quote | undefined {
  if (params.length <= 5) return undefined
  let price = number(params[3])
  if (price === 0) {
    const buy1 = params.length > 6 ? number(params[6]) : 0
    price = buy1 !== 0 ? buy1 : number(params[2])
  }
  const timeText = [params[30], params[31]].filter(Boolean).join(' ')
  return quote(
    code,
    params[0],
    price,
    number(params[2]),
    number(params[1]),
    number(params[4]),
    number(params[5]),
    timeText
  )
}

function parseSinaGlobalIndex(code: string, params: string[]): Quote | undefined {
  if (code.startsWith('int_')) {
    if (params.length <= 3) return undefined
    const price = number(params[1])
    const yestclose = price - number(params[2])
    return quote(code, params[0], price, yestclose, price, price, price)
  }
  if (params.length <= 11) return undefined
  const price = number(params[1])
  const yestclose = price - number(params[2])
  const timeText = [params[6], params[7] || params[5]].filter(Boolean).join(' ')
  return quote(
    code,
    params[0],
    price,
    yestclose,
    number(params[8]) || price,
    number(params[10]) || price,
    number(params[11]) || price,
    timeText
  )
}

async function fetchText(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
  encoding = 'gb18030',
  referer = 'http://finance.sina.com.cn/'
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal
  try {
    const response = await fetch(url, {
      signal: combined,
      headers: {
        Accept: '*/*',
        Referer: referer,
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = await response.arrayBuffer()
    // Sina returns GB18030; the Tencent ranking JSON endpoint returns UTF-8.
    // Both are supported by TextDecoder.
    return new TextDecoder(encoding).decode(buffer)
  } finally {
    clearTimeout(timer)
  }
}

const sectorCache = new Map<string, { at: number; sector: string }>()
let sectorWarmRequest: Promise<void> | undefined

function eastmoneySecuCode(code: string): string | undefined {
  const match = /^(sh|sz|bj)(\d{6})$/.exec(code)
  if (!match) return undefined
  return `${match[2]}.${match[1].toUpperCase()}`
}

function cachedSector(code: string): string {
  const cached = sectorCache.get(code)
  if (!cached) return ''
  const cacheTtl = cached.sector ? SECTOR_CACHE_TTL_MS : EMPTY_SECTOR_CACHE_TTL_MS
  return Date.now() - cached.at < cacheTtl ? cached.sector : ''
}

async function fetchEastmoneySectors(codes: string[], timeoutMs: number): Promise<void> {
  const uniqueCodes = [...new Set(codes)]
  const pendingCodes = uniqueCodes.filter((code) => !cachedSector(code))
  if (pendingCodes.length === 0) return

  const codePairs = pendingCodes
    .map((code) => ({ code, secucode: eastmoneySecuCode(code) }))
    .filter((item): item is { code: string; secucode: string } => item.secucode !== undefined)
  if (codePairs.length === 0) return

  const params = new URLSearchParams({
    reportName: 'RPT_F10_BASIC_ORGINFO',
    columns: 'SECUCODE,BOARD_NAME_LEVEL',
    filter: `(SECUCODE in (${codePairs.map((item) => JSON.stringify(item.secucode)).join(',')}))`,
    source: 'HSF10',
    client: 'WEB',
  })
  let sectors = new Map<string, string>()
  try {
    const body = await fetchText(
      `${EASTMONEY_BASIC_URL}?${params}`,
      timeoutMs,
      undefined,
      'utf-8',
      'https://quote.eastmoney.com/'
    )
    sectors = parseEastmoneySectors(JSON.parse(body) as unknown)
  } catch {
    // Preserve the snapshot response when the supplementary metadata source fails.
  }

  const now = Date.now()
  for (const item of codePairs) {
    sectorCache.set(item.code, { at: now, sector: sectors.get(item.secucode) ?? '' })
  }
}

async function warmSectors(items: SpeedRankingItem[], timeoutMs: number): Promise<void> {
  if (sectorWarmRequest) return sectorWarmRequest
  const request = (async () => {
    try {
      await fetchEastmoneySectors(items.map((item) => item.code), timeoutMs)
    } finally {
      sectorWarmRequest = undefined
    }
  })()
  sectorWarmRequest = request
  return request
}

function attachSectors(
  items: SpeedRankingItem[],
  timeoutMs: number
): SpeedRankingItem[] {
  // Sector metadata is supplementary: return the ranking immediately and
  // let the single batch background fetch populate the cache for the next poll.
  void warmSectors(items, timeoutMs).catch(() => undefined)
  return items.map((item) => ({ ...item, sector: cachedSector(item.code) }))
}

/** Parse a raw Sina response body into a code -> quote map. */
export function parseSinaBody(body: string): Map<string, Quote> {
  const result = new Map<string, Quote>()
  for (const match of body.matchAll(SINA_LINE_PATTERN)) {
    const rawCode = match[1].replace(/\$/g, '.')
    const params = match[2].split(',')
    if (!params[0]) continue
    let item: Quote | undefined
    if (rawCode.startsWith('b_') || rawCode.startsWith('int_')) {
      item = parseSinaGlobalIndex(rawCode, params)
    } else {
      const normalized = rawCode.toLowerCase()
      if (!/^(?:sh|sz|bj)\d{6}$/.test(normalized)) {
        continue
      }
      item = parseSinaCn(normalized, params)
    }
    if (item) result.set(item.code, item)
  }
  return result
}

/** Fetch Sina quotes for A-share / global-index codes. */
export async function fetchSinaQuotes(codes: string[], timeoutMs = 8000, signal?: AbortSignal): Promise<Map<string, Quote>> {
  const requested = [...new Set(codes)].map((code) => code.replace(/\./g, '$')).join(',')
  if (!requested) return new Map()
  const body = await fetchText(`${SINA_QUOTE_URL}${requested}`, timeoutMs, signal)
  return parseSinaBody(body)
}

/** Fetch quotes for any mix of A-share / index codes. */
export async function fetchQuotes(codes: string[], timeoutMs = 8000, signal?: AbortSignal): Promise<Map<string, Quote>> {
  // Index codes (b_NKY, b_KOSPI, int_*) are case-sensitive on the Sina
  // endpoint — keep their original case; everything else is normalized.
  const normalized = [
    ...new Set(
      codes.map((code) =>
        code.startsWith('b_') || code.startsWith('int_')
          ? code
          : code.toLowerCase().replace(/\$/g, '.')
      )
    ),
  ]
  return fetchSinaQuotes(normalized, timeoutMs, signal)
}

/** Fetch the live A-share five-minute speed ranking from Tencent. */
export async function fetchSpeedRanking(
  limit = 20,
  timeoutMs = 8000,
  signal?: AbortSignal
): Promise<SpeedRankingItem[]> {
  const params = new URLSearchParams({
    board_code: 'aStock',
    sort_type: 'speed',
    direct: 'down',
    offset: '0',
    count: String(Math.max(20, limit)),
  })
  try {
    const body = await fetchText(`${TENCENT_SPEED_RANKING_URL}?${params}`, timeoutMs, signal, 'utf-8')
    const ranking = parseTencentSpeedRanking(JSON.parse(body) as unknown, limit)
    return attachSectors(ranking, timeoutMs)
  } catch (error) {
    if (signal?.aborted) throw error
    return []
  }
}

/** Render one quote line for the model-facing text output. */
export function formatQuoteLine(quote: Quote): string {
  const price = displayPrice(quote.code, quote.name, quote.price)
  return [
    `${quote.name}(${quote.code})`,
    `现价 ${price}`,
    `${formatPercent(quote.percent)}`,
    `涨跌 ${quote.updown >= 0 ? '+' : ''}${displayPrice(quote.code, quote.name, quote.updown)}`,
    `今开 ${displayPrice(quote.code, quote.name, quote.open)}`,
    `最高 ${displayPrice(quote.code, quote.name, quote.high)}`,
    `最低 ${displayPrice(quote.code, quote.name, quote.low)}`,
    `昨收 ${displayPrice(quote.code, quote.name, quote.yestclose)}`,
    quote.time ? `时间 ${quote.time}` : '',
  ]
    .filter(Boolean)
    .join(' | ')
}
