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

/** 大盘实时概览 */
export interface MarketOverview {
  upCount: number
  downCount: number
  flatCount: number
  shAmount: number
  szAmount: number
  totalAmount: number
  estimatedCloseAmount: number
  time: string
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
    //  47  limit-up price
    //  48  limit-down price
    const qt = (stockData.qt as Record<string, unknown>) ?? {}
    const qtArr = qt[code] as string[] | undefined
    let yestclose = 0
    let open = 0
    let limitUp = 0
    let limitDown = 0
    let name = ''
    if (Array.isArray(qtArr) && qtArr.length >= 48) {
      name = qtArr[1] ?? ''
      yestclose = Number(qtArr[4]) || 0
      open = Number(qtArr[5]) || 0
      limitUp = Number(qtArr[46]) || 0
      limitDown = Number(qtArr[47]) || 0
    }

    // --- Parse minute data ---
    // data.data contains the raw minute string array
    const innerData = stockData.data as Record<string, unknown> | undefined
    if (!innerData) return { points: [], yestclose, open, limitUp, limitDown, name }

    const rawArray = innerData.data as string[] | undefined
    if (!Array.isArray(rawArray) || rawArray.length === 0) {
      return { points: [], yestclose, limitUp, limitDown, name }
    }

    const points: MinutePoint[] = []
    let vwapSum = 0  // Σ(price × volume)
    let vwapVol = 0  // Σ(volume)
    for (const entry of rawArray) {
      // Format: "HHMM price volume amount"
      const parts = entry.split(' ')
      if (parts.length < 4) continue
      const rawTime = parts[0].trim()
      const price = Number(parts[1]) || 0
      const volume = Number(parts[2]) || 0
      if (!rawTime || price <= 0) continue

      // HHMM -> HH:mm
      const time = rawTime.length === 4
        ? `${rawTime.slice(0, 2)}:${rawTime.slice(2)}`
        : rawTime
      vwapSum += price * volume
      vwapVol += volume

      points.push({
        time,
        price,
        volume,
        // VWAP = Σ(price × volume) / Σ(volume) — unit-agnostic,
        // correct whether volume is in shares or lots.
        avgPrice: vwapVol > 0 ? vwapSum / vwapVol : price,
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
  let vwapVol = 0
  for (const line of klines) {
    const parts = line.split(',')
    if (parts.length < 6) continue
    const time = parts[0].split(' ')[1] ?? ''
    const price = Number(parts[2]) || 0
    const volume = Number(parts[5]) || 0
    if (!time || price <= 0) continue
    vwapSum += price * volume
    vwapVol += volume
    points.push({
      time,
      price,
      volume,
      // VWAP = Σ(price × volume) / Σ(volume) — unit-agnostic.
      avgPrice: vwapVol > 0 ? vwapSum / vwapVol : price,
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
 * 47/48). Used only when the primary Tencent minute API failed, as a
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
      result.limitUp = Number(fields[46]) || 0
      result.limitDown = Number(fields[47]) || 0
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

// ── 大盘实时概览 ─────────────────────────────────────────────────────────

/**
 * 获取大盘实时涨跌家数、量能数据
 */
export async function fetchMarketOverview(timeoutMs = 8000): Promise<MarketOverview> {
  const defaults: MarketOverview = {
    upCount: 0, downCount: 0, flatCount: 0,
    shAmount: 0, szAmount: 0, totalAmount: 0, estimatedCloseAmount: 0,
    time: '',
  }
  try {
    const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f4,f5,f6,f12,f14,f62,f64,f65,f66,f164,f169,f170&secids=1.000001,0.399001'
    const payload = (await fetchJson(url, timeoutMs, {
      Referer: 'http://quote.eastmoney.com/',
    })) as { data?: { diff?: Array<Record<string, unknown>>; list?: Array<Record<string, unknown>> } }
    const list = payload.data?.diff ?? payload.data?.list ?? []
    if (!Array.isArray(list)) return defaults

    let shAmount = 0
    let szAmount = 0
    let totalUp = 0
    let totalDown = 0
    let totalFlat = 0

    for (const item of list) {
      const code = String(item.f12 ?? '').toLowerCase()
      const amount = Number(item.f6) || 0
      if (code === '1.000001') {
        shAmount = amount
        totalUp += Number(item.f170) || 0
        totalDown += Number(item.f169) || 0
        totalFlat += Number(item.f164) || 0
      }
      if (code === '0.399001') {
        szAmount = amount
        totalUp += Number(item.f170) || 0
        totalDown += Number(item.f169) || 0
        totalFlat += Number(item.f164) || 0
      }
    }

    const totalAmount = shAmount + szAmount

    // 计算预计收盘量能
    const now = new Date()
    const tradingMinutes = getElapsedTradingMinutes(now)
    const totalTradingMinutes = 240 // 9:30-11:30 (120min) + 13:00-15:00 (120min)
    const estimatedCloseAmount =
      tradingMinutes > 0
        ? totalAmount * (totalTradingMinutes / tradingMinutes)
        : totalAmount

    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const ss = String(now.getSeconds()).padStart(2, '0')

    return {
      upCount: totalUp,
      downCount: totalDown,
      flatCount: totalFlat,
      shAmount,
      szAmount,
      totalAmount,
      estimatedCloseAmount,
      time: `${hh}:${mm}:${ss}`,
    }
  } catch {
    return defaults
  }
}

/**
 * 计算当日已过去的交易分钟数（A 股：9:30-11:30, 13:00-15:00）
 */
function getElapsedTradingMinutes(now: Date): number {
  const hours = now.getHours()
  const minutes = now.getMinutes()
  const totalMinutes = hours * 60 + minutes
  const open1 = 9 * 60 + 30   // 9:30
  const close1 = 11 * 60 + 30  // 11:30
  const open2 = 13 * 60        // 13:00
  const close2 = 15 * 60       // 15:00

  if (totalMinutes < open1 || totalMinutes >= close2) {
    return totalMinutes < open1 ? 0 : 240
  }
  if (totalMinutes <= close1) {
    return totalMinutes - open1
  }
  if (totalMinutes < open2) {
    return close1 - open1 // 午间休市
  }
  return (close1 - open1) + (totalMinutes - open2)
}
