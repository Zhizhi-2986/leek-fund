/**
 * Market data fetching and parsing for dsh-leek-fund.
 *
 * Field semantics are ported from the Hermes plugin backend
 * (dashboard/plugin_api.py): Sina quotes for A-shares / US stocks / global
 * indices, Tencent quotes for HK stocks, and ETF price truncation to three
 * decimals.
 */
import type { Quote } from './types.js'

const SINA_QUOTE_URL = 'https://hq.sinajs.cn/list='
const TENCENT_QUOTE_URL = 'https://qt.gtimg.cn/q='

const SINA_LINE_PATTERN = /^var hq_str_([^=]+)="([^"]*)";?$/gm

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
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

function parseSinaUs(code: string, params: string[]): Quote | undefined {
  if (params.length <= 26) return undefined
  return quote(
    code,
    params[0],
    number(params[1]),
    number(params[26]),
    number(params[5]),
    number(params[6]),
    number(params[7]),
    params[3] ?? ''
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

async function fetchText(url: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal
  try {
    const response = await fetch(url, {
      signal: combined,
      headers: {
        Accept: '*/*',
        Referer: 'http://finance.sina.com.cn/',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = await response.arrayBuffer()
    // Sina returns GB18030; Tencent HK returns GBK. Both are covered by the
    // WHATWG encoding labels implemented by Node's full-ICU TextDecoder.
    return new TextDecoder('gb18030').decode(buffer)
  } finally {
    clearTimeout(timer)
  }
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
      if (!/^(?:(?:sh|sz|bj)\d{6}|hk\d{5}|(?:usr_|gb_)[a-z0-9._-]+)$/.test(normalized)) {
        continue
      }
      item = normalized.startsWith('usr_') || normalized.startsWith('gb_')
        ? parseSinaUs(normalized, params)
        : parseSinaCn(normalized, params)
    }
    if (item) result.set(item.code, item)
  }
  return result
}

/** Fetch Sina quotes for A-share / US / global-index codes. */
export async function fetchSinaQuotes(codes: string[], timeoutMs = 8000, signal?: AbortSignal): Promise<Map<string, Quote>> {
  const requested = [...new Set(codes)].map((code) => code.replace(/\./g, '$')).join(',')
  if (!requested) return new Map()
  const body = await fetchText(`${SINA_QUOTE_URL}${requested}`, timeoutMs, signal)
  return parseSinaBody(body)
}

/** Fetch HK quotes through the Tencent endpoint (`r_` prefixed JSON). */
export async function fetchHkQuotes(codes: string[], timeoutMs = 8000, signal?: AbortSignal): Promise<Map<string, Quote>> {
  const normalized = [...new Set(codes)].filter((code) => code.startsWith('hk'))
  if (normalized.length === 0) return new Map()
  const query = normalized.map((code) => `r_${code}`).join(',')
  const body = await fetchText(`${TENCENT_QUOTE_URL}${query}&fmt=json`, timeoutMs, signal)
  let payload: Record<string, string[] | undefined> = {}
  try {
    payload = JSON.parse(body) as Record<string, string[] | undefined>
  } catch {
    return new Map()
  }
  const result = new Map<string, Quote>()
  for (const code of normalized) {
    const params = payload[`r_${code}`]
    if (!Array.isArray(params) || params.length <= 37) continue
    const item = quote(
      code,
      params[1] ?? '',
      number(params[3]),
      number(params[4]),
      number(params[5]),
      number(params[33]),
      number(params[34]),
      params[30] ?? ''
    )
    if (item) result.set(code, item)
  }
  return result
}

/** Fetch quotes for any mix of A-share / HK / US / index codes. */
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
  const [sina, hk] = await Promise.all([
    fetchSinaQuotes(normalized.filter((code) => !code.startsWith('hk')), timeoutMs, signal),
    fetchHkQuotes(normalized.filter((code) => code.startsWith('hk')), timeoutMs, signal),
  ])
  return new Map([...sina, ...hk])
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
