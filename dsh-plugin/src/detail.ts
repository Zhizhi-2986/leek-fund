/**
 * Stock detail data for the LeekFund tab: intraday minute line (Eastmoney
 * 1-minute klines), daily closes (Sina) and MA5/MA10/MA20. Ported from the
 * VSCode LeekFund implementation (src/shared/stockDetailData.ts /
 * technicalAnalysis.ts).
 */
import type { Quote } from './types.js'

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
  high: number
  low: number
  yestclose: number
  time: string
  minute: MinutePoint[]
  ma: { ma5: number | null; ma10: number | null; ma20: number | null }
  daily: DailyClose[]
}

function eastmoneySecid(code: string): string {
  // sh600519 -> 1.600519, sz000001 -> 0.000001
  const digits = code.slice(2)
  return code.startsWith('sh') ? `1.${digits}` : `0.${digits}`
}

async function fetchJson(url: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<unknown> {
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
    // Sina returns UTF-8 JSON; fall back to GB18030 for safety.
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

/**
 * Fetch the intraday minute line (1-minute closes) through Eastmoney.
 * `avgPrice` is the cumulative amount / cumulative volume (分时均价).
 */
export async function fetchMinuteLine(code: string, timeoutMs = 8000): Promise<MinutePoint[]> {
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
  let cumulativeAmount = 0
  let cumulativeVolume = 0
  for (const line of klines) {
    // "2026-06-29 09:31,open,close,high,low,volume,amount,change"
    const parts = line.split(',')
    if (parts.length < 6) continue
    const time = parts[0].split(' ')[1] ?? ''
    const price = Number(parts[2]) || 0
    const volume = Number(parts[5]) || 0
    const amount = Number(parts[6]) || 0
    if (!time || price <= 0) continue
    cumulativeAmount += amount
    cumulativeVolume += volume
    points.push({
      time,
      price,
      volume,
      // Eastmoney volume is in lots (手); the average price is amount / shares.
      avgPrice: cumulativeVolume > 0 ? cumulativeAmount / (cumulativeVolume * 100) : price,
    })
  }
  return points
}

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

/** Assemble the full detail for one code (quotes used for name/high/low). */
export async function fetchStockDetail(
  code: string,
  quote: Quote | undefined,
  timeoutMs = 8000
): Promise<StockDetail> {
  const [minute, daily] = await Promise.all([
    fetchMinuteLine(code, timeoutMs),
    fetchDailyKline(code, 30, timeoutMs),
  ])
  const prices = minute.map((point) => point.price)
  const latest = quote?.price ?? (prices.at(-1) ?? 0)
  const closes = closesWithLatest(daily, latest)
  const high = prices.length > 0 ? Math.max(...prices) : (quote?.high ?? 0)
  const low = prices.length > 0 ? Math.min(...prices) : (quote?.low ?? 0)
  const yestclose = quote?.yestclose ?? 0
  return {
    code,
    name: quote?.name ?? code,
    price: latest,
    high,
    low,
    yestclose,
    time: quote?.time ?? '',
    minute,
    ma: {
      ma5: calcMA(closes, 5),
      ma10: calcMA(closes, 10),
      ma20: calcMA(closes, 20),
    },
    daily,
  }
}
