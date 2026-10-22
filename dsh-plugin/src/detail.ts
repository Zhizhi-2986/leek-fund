/**
 * Stock detail data for the LeekFund tab: intraday minute chart (SVG),
 * today's high/low, volume-weighted average price, and MA5/MA10/MA20 from
 * daily closes.
 *
 * Data sources (priority order):
 *   1. Tencent minute API (ifzq.gtimg.cn) — primary intraday data,
 *      includes yestclose / limit-up / limit-down in one call.
 *   2. Eastmoney (push2his.eastmoney.com) — fallback when Tencent is
 *      unavailable or returns empty data.
 *   3. Sina daily K-line (money.finance.sina.com.cn) — for MA computation.
 */
import type { Quote } from './types.js'

const TENCENT_MINUTE_URL = 'https://ifzq.gtimg.cn/appstock/app/minute/query'
const EASTMONEY_KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get'
const SINA_DAILY_URL =
  'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData'

export interface MinutePoint {
  /** HH:mm */
  time: string
  price: number
  /** Cumulative-volume-weighted average price (分时均价). */
  avgPrice: number
  volume: number
}

export interface DailyClose {
  date: string
  close: number
}

export interface StockDetail {
  code: string
  name: string
  price: number
  open: number
  high: number
  low: number
  yestclose: number
  limitUp: number
  limitDown: number
  time: string
  minute: MinutePoint[]
  ma: { ma5: number | null; ma10: number | null; ma20: number | null }
  daily: DailyClose[]
  /** 流通市值（元） */
  circulatingMarketCap: number
  /** 量比 */
  volumeRatio: number
}

// ── Low-level fetch helpers ────────────────────────────────────────────

async function fetchJsonOnce(url: string, timeoutMs: number, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: '*/*',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
        ...headers,
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = await response.arrayBuffer()
    const text = new TextDecoder('utf-8').decode(buffer)
    try {
      return JSON.parse(text)
    } catch {
      return JSON.parse(new TextDecoder('gb18030').decode(buffer))
    }
  } finally {
    clearTimeout(timer)
  }
}

/** One retry for transient network / anti-bot failures. */
async function fetchJson(url: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<unknown> {
  try {
    return await fetchJsonOnce(url, timeoutMs, headers)
  } catch {
    return await fetchJsonOnce(url, timeoutMs, headers)
  }
}

// ── Primary: Tencent minute API ─────────────────────────────────────────

/**
 * Fetch the intraday minute line from Tencent.
 * Returns `{ points, yestclose, limitUp, limitDown, name }`.
 * When data is unavailable (e.g. non-trading day with no minute data)
 * `points` is an empty array.
 */
export interface TencentMinuteResult {
  points: MinutePoint[]
  yestclose: number
  open: number
  limitUp: number
  limitDown: number
  name: string
}

export async function fetchTencentMinute(code: string, timeoutMs = 8000): Promise<TencentMinuteResult> {
  const empty = { points: [] as MinutePoint[], yestclose: 0, open: 0, limitUp: 0, limitDown: 0, name: '' }
  if (!/^(sh|sz)\d{6}$/.test(code)) return empty

  try {
    const payload = (await fetchJson(
      `${TENCENT_MINUTE_URL}?code=${code}`,
      timeoutMs,
      { Referer: 'https://finance.qq.com/' }
    )) as Record<string, unknown>

    if ((payload as { code?: number }).code !== 0) return empty
    const dataRoot = (payload as { data?: Record<string, unknown> }).data
    if (!dataRoot) return empty

    const stockData = dataRoot[code] as Record<string, unknown> | undefined
    if (!stockData) return empty

    // --- Extract metadata from the qt array ---
    // qt[code] is an array like ["1","贵州茅台","600519","1291.50","1307.88",...]
    // Indices (1-indexed):
    //   1  name
    //   4  yestclose / preclose
    //  48  limit-up price
    //  49  limit-down price
    const qt = (stockData.qt as Record<string, unknown>) ?? {}
    const qtArr = qt[code] as string[] | undefined
    let yestclose = 0
    let open = 0
    let limitUp = 0
    let limitDown = 0
    let name = ''
    if (Array.isArray(qtArr) && qtArr.length >= 49) {
      name = qtArr[1] ?? ''
      yestclose = Number(qtArr[4]) || 0
      open = Number(qtArr[5]) || 0
      limitUp = Number(qtArr[47]) || 0
      limitDown = Number(qtArr[48]) || 0
    }

    // --- Parse minute data ---
    // data.data contains the raw minute string array
    const innerData = stockData.data as Record<string, unknown> | undefined
    if (!innerData) return { points: [], yestclose, open, limitUp, limitDown, name }

    const rawArray = innerData.data as string[] | undefined
    if (!Array.isArray(rawArray) || rawArray.length === 0) {
      return { points: [], yestclose, open, limitUp, limitDown, name }
    }

    const points: MinutePoint[] = []
    let vwapSum = 0    // Σ(amount) — actual turnover (元)
    let vwapShares = 0 // Σ(shares) — cumulative shares (股)
    for (const entry of rawArray) {
      // Format: "HHMM price volume amount"
      //   price  = minute close price (元/股)
      //   volume = trading volume in 手 (lots), 1 lot = 100 shares
      //   amount = actual turnover (元)
      const parts = entry.split(' ')
      if (parts.length < 4) continue
      const rawTime = parts[0].trim()
      const price = Number(parts[1]) || 0
      const volume = Number(parts[2]) || 0  // 手 (lots)
      const amount = Number(parts[3]) || 0  // 元
      if (!rawTime || price <= 0) continue

      // HHMM -> HH:mm
      const time = rawTime.length === 4
        ? `${rawTime.slice(0, 2)}:${rawTime.slice(2)}`
        : rawTime
      vwapSum += amount
      vwapShares += volume * 100  // 手 → 股

      points.push({
        time,
        price,
        volume,
        // VWAP = Σ(amount) / Σ(shares) — uses the actual turnover amount
        // from the API rather than price × volume, matching mainstream
        // Chinese stock software (同花顺, 东方财富, etc.).
        // Note: API volume is in 手 (lots), converted to 股 (shares) ×100.
        avgPrice: vwapShares > 0 ? vwapSum / vwapShares : price,
      })
    }

    return { points, yestclose, open, limitUp, limitDown, name }
  } catch {
    return empty
  }
}

// ── Fallback: Eastmoney minute API ──────────────────────────────────────

function eastmoneySecid(code: string): string {
  const digits = code.slice(2)
  return code.startsWith('sh') ? `1.${digits}` : `0.${digits}`
}

/**
 * Fetch the intraday minute line (1-minute closes) through Eastmoney.
 * Used as fallback when the Tencent API is unavailable.
 */
export async function fetchEastmoneyMinute(code: string, timeoutMs = 8000): Promise<MinutePoint[]> {
  if (!/^(sh|sz)\d{6}$/.test(code)) return []
  const url = new URL(EASTMONEY_KLINE_URL)
  url.searchParams.set('secid', eastmoneySecid(code))
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6')
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58')
  url.searchParams.set('klt', '1')
  url.searchParams.set('fqt', '1')
  url.searchParams.set('beg', '0')
  url.searchParams.set('end', '20500101')
  url.searchParams.set('lmt', '1000000')
  const payload = (await fetchJson(url.toString(), timeoutMs, {
    Referer: 'http://quote.eastmoney.com/',
  })) as { data?: { klines?: string[] } }
  const klines = payload.data?.klines
  if (!Array.isArray(klines)) return []

  const points: MinutePoint[] = []
  let vwapSum = 0
  let vwapShares = 0
  for (const line of klines) {
    // Eastmoney kline format (fields2=f51,f52,f53,f54,f55,f56,f57,f58):
    //   date,open,close,high,low,volume(手),amount(元),...
    const parts = line.split(',')
    if (parts.length < 7) continue
    const time = parts[0].split(' ')[1] ?? ''
    const price = Number(parts[2]) || 0
    const volume = Number(parts[5]) || 0  // 手 (lots)
    const amount = Number(parts[6]) || 0  // 元
    if (!time || price <= 0) continue
    vwapSum += amount
    vwapShares += volume * 100  // 手 → 股
    points.push({
      time,
      price,
      volume,
      // VWAP = Σ(amount) / Σ(shares) — uses actual turnover amount.
      avgPrice: vwapShares > 0 ? vwapSum / vwapShares : price,
    })
  }
  return points
}

// ── Daily K-line (Sina) for MA computation ─────────────────────────────

/** Fetch recent daily closes through Sina (for MA computation). */
export async function fetchDailyKline(code: string, count = 30, timeoutMs = 8000): Promise<DailyClose[]> {
  if (!/^(sh|sz)\d{6}$/.test(code)) return []
  const url = new URL(SINA_DAILY_URL)
  url.searchParams.set('symbol', code)
  url.searchParams.set('scale', '240')
  url.searchParams.set('ma', 'no')
  url.searchParams.set('datalen', String(count))
  const payload = (await fetchJson(url.toString(), timeoutMs, {
    Referer: 'https://finance.sina.com.cn/',
  })) as unknown
  if (!Array.isArray(payload)) return []
  const result: DailyClose[] = []
  for (const item of payload) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const date = String(record.day ?? '')
    const close = Number(record.close) || 0
    if (date && close > 0) result.push({ date, close })
  }
  return result
}

// ── Utility helpers ────────────────────────────────────────────────────

/** Today's date in YYYY-MM-DD (local time). */
function todayString(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * Merge the latest realtime price into the daily closes: when the last daily
 * bar is today, its close is replaced by the live price; otherwise the live
 * price is appended. MA lines are then computed over closes + latest.
 */
export function closesWithLatest(daily: DailyClose[], latest: number): number[] {
  const closes = daily.map((item) => item.close)
  const last = daily.at(-1)
  if (last && last.date === todayString()) {
    closes[closes.length - 1] = latest
  } else {
    closes.push(latest)
  }
  return closes
}

/** Simple moving average over the last `period` closes. */
export function calcMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null
  const window = closes.slice(-period)
  const sum = window.reduce((acc, value) => acc + value, 0)
  return sum / period
}

// ── Main: assemble the full stock detail ───────────────────────────────

/**
 * Assemble the full detail for one stock code.
 *
 * Priority:
 *   1. Tencent minute API — returns points + yestclose + limit prices in
 *      a single HTTP call. Falls back to Eastmoney when empty.
 *   2. Sina daily K-line — for MA5/MA10/MA20.
 *   3. The external `quote` (from Sina live quote) is used *only* as a
 *      fallback for name / yestclose when Tencent provides neither.
 */
export async function fetchStockDetail(
  code: string,
  quote: Quote | undefined,
  timeoutMs = 8000
): Promise<StockDetail> {
  // Fetch primary minute data (Tencent) and daily K-line (Sina) in parallel.
  // If Tencent returns empty, fall back to Eastmoney (sequential).
  const [tencent, extraQuotes] = await Promise.all([
    fetchTencentMinute(code, timeoutMs),
    fetchEastMoneyExtraQuotes(code, timeoutMs),
  ])
  let minute: MinutePoint[]
  let yestclose: number
  let limitUp: number
  let limitDown: number
  let name: string

  if (tencent.points.length > 0) {
    // Tencent has data — use it
    minute = tencent.points
    yestclose = tencent.yestclose
    limitUp = tencent.limitUp
    limitDown = tencent.limitDown
    name = tencent.name
  } else {
    // Tencent failed or returned empty — fall back to Eastmoney
    // and fetch limit prices separately via the old qt.gtimg.cn endpoint.
    const [emMinute, limitPrices] = await Promise.all([
      fetchEastmoneyMinute(code, timeoutMs).catch(() => [] as MinutePoint[]),
      fetchLimitPricesFromQt(code, timeoutMs),
    ])
    minute = emMinute
    yestclose = quote?.yestclose ?? 0
    limitUp = limitPrices.limitUp
    limitDown = limitPrices.limitDown
    name = quote?.name ?? ''
  }

  // Fetch daily K-line (always needed for MA)
  const daily = await fetchDailyKline(code, 30, timeoutMs).catch(() => [] as DailyClose[])

  const prices = minute.map((p) => p.price)
  const latest = prices.at(-1) ?? quote?.price ?? 0
  const closes = closesWithLatest(daily, latest)

  // High/low: prefer Sina quote (reflects day's true range), fall back to
  // minute range.
  const high = quote?.high && quote.high > 0 ? quote.high : (prices.length > 0 ? Math.max(...prices) : 0)
  const low = quote?.low && quote.low > 0 ? quote.low : (prices.length > 0 ? Math.min(...prices) : 0)

  return {
    code,
    name: name || quote?.name || code,
    price: latest,
    open: tencent.open || quote?.open || 0,
    high,
    low,
    yestclose,
    limitUp,
    limitDown,
    time: quote?.time ?? '',
    minute,
    ma: {
      ma5: calcMA(closes, 5),
      ma10: calcMA(closes, 10),
      ma20: calcMA(closes, 20),
    },
    daily,
    circulatingMarketCap: extraQuotes.circulatingMarketCap,
    volumeRatio: extraQuotes.volumeRatio,
  }
}

// ── Legacy limit-price fetcher (fallback only) ─────────────────────────

/**
 * Fetch limit-up / limit-down prices from Tencent realtime quote (fields
 * 48/49). Used only when the primary Tencent minute API failed, as a
 * companion to the Eastmoney fallback.
 */
async function fetchLimitPricesFromQt(code: string, timeoutMs = 8000): Promise<{ limitUp: number; limitDown: number }> {
  const result = { limitUp: 0, limitDown: 0 }
  if (!/^(sh|sz)\d{6}$/.test(code)) return result
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`https://qt.gtimg.cn/q=${code}`, {
        signal: controller.signal,
        headers: {
          Accept: '*/*',
          Referer: 'https://gu.qq.com/',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
        },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = await response.arrayBuffer()
      const text = new TextDecoder('gbk').decode(buffer)
      const prefix = `v_${code}=`
      const idx = text.indexOf(prefix)
      if (idx < 0) return result
      const start = idx + prefix.length
      const openQuote = text.indexOf('"', start)
      if (openQuote < 0) return result
      const closeQuote = text.indexOf('"', openQuote + 1)
      if (closeQuote < 0) return result
      const fields = text.slice(openQuote + 1, closeQuote).split('~')
      result.limitUp = Number(fields[47]) || 0
      result.limitDown = Number(fields[48]) || 0
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // Silently return zeros
  }
  return result
}

// ── Eastmoney extra quotes (circulating market cap, volume ratio) ──────

/**
 * Fetch circulating market cap and volume ratio from Eastmoney.
 */
async function fetchEastMoneyExtraQuotes(code: string, timeoutMs = 8000): Promise<{
  circulatingMarketCap: number
  volumeRatio: number
}> {
  const result = { circulatingMarketCap: 0, volumeRatio: 0 }
  if (!/^(sh|sz)\d{6}$/.test(code)) return result
  try {
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${eastmoneySecid(code)}&fields=f41,f42,f20,f21,f37,f10&invt=2&fltt=2`
    const payload = (await fetchJson(url, timeoutMs, {
      Referer: 'http://quote.eastmoney.com/',
    })) as { data?: { f21?: number; f20?: number; f10?: number } }
    const data = payload.data
    if (!data) return result
    return {
      circulatingMarketCap: data.f21 ?? data.f20 ?? 0,
      volumeRatio: data.f10 ?? 0,
    }
  } catch {
    return result
  }
}
