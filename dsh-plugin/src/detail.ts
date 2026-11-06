/**
 * Stock detail data for the LeekFund tab: daily metrics, 5-minute candles,
 * 5-minute-close SMAs (K-line view) and daily MA5–MA60 over front-adjusted
 * daily closes (daily panel).
 *
 * Data sources (priority order):
 *   1. Tencent 5-min K-line API (ifzq.gtimg.cn/appstock/app/kline/mkline) —
 *      primary intraday data, includes yestclose / limit-up / limit-down in
 *      one call; a 160-bar window also provides the MA warmup history.
 *   2. Eastmoney (push2his.eastmoney.com, klt=5) — fallback when Tencent is
 *      unavailable or returns empty data.
 */
import { calcPeriodReturn } from './daily-math.js'
import type { Quote } from './types.js'

const TENCENT_MKLINE_URL = 'https://ifzq.gtimg.cn/appstock/app/kline/mkline'
const TENCENT_DAILY_KLINE_URL = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'
const EASTMONEY_KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get'

/**
 * How many 5-minute bars to request. A trading day has 48 bars, so 160 covers
 * the current day plus ≈2.3 preceding days — enough context (≥60 closes) for
 * the MA60 5-minute SMA without faking a shorter window.
 */
const M5_BAR_COUNT = 160

/**
 * How many daily bars to request for the 60-day range and 5/20-session returns.
 * `lmt=60` on the daily endpoints returns exactly the latest 60 trading days
 * (non-trading days are not part of the series).
 */
const DAILY_BAR_COUNT = 60

/** One 5-minute candlestick bar. */
export interface KlineBar {
  /** YYYY-MM-DD */
  date: string
  /** HH:mm (bar end time, e.g. 09:35 for the 09:30–09:35 bar). */
  time: string
  open: number
  close: number
  high: number
  low: number
  /** Volume in 手 (lots). */
  volume: number
  /** Whether the 5-minute bucket has closed (the last bar of the day may still be forming). */
  completed: boolean
}

/** One daily K-line bar (front-adjusted close and high/low references). */
export interface DailyBar {
  /** YYYY-MM-DD */
  date: string
  /** 前复权收盘价 */
  close: number
  /** 当日最高 */
  high: number
  /** 当日最低 */
  low: number
}

export interface StockDetail {
  code: string
  name: string
  price: number
  open: number
  high: number
  low: number
  /** Snapshot-provided extremes (0 when unavailable), retained for honest K-line reconciliation. */
  snapshotHigh: number
  snapshotLow: number
  yestclose: number
  limitUp: number
  limitDown: number
  time: string
  /** 5-minute candlestick bars of the latest trading day (≤ 48). */
  kline5: KlineBar[]
  /**
   * 5-minute close prices of the days BEFORE the latest trading day
   * (ascending). Used as MA warmup so MA5–MA60 are computed over real
   * 5-minute closes, never faked from daily bars.
   */
  klineWarmup: number[]
  ma: {
    ma5: number | null
    ma10: number | null
    ma20: number | null
    ma30: number | null
    ma60: number | null
  }
  /**
   * Daily-line MAs (5/10/20/30/60) over front-adjusted daily closes. Uses the
   * same window as return5/return20: during a live same-day quote session the
   * current price stands in for today's close; otherwise the series ends at
   * the latest settled daily close. Null when the series is too short.
   */
  dailyMA: {
    ma5: number | null
    ma10: number | null
    ma20: number | null
    ma30: number | null
    ma60: number | null
  }
  /** 流通市值（元） */
  circulatingMarketCap: number
  /** 量比 */
  volumeRatio: number
  /** 今日成交量（手，含当前未收盘桶） */
  volume: number
  /** 成交量是否回退为 K 线桶合计（与快照成交额不可保证同时点）。 */
  volumeFromBars: boolean
  /** 今日成交额（元） */
  amount: number
  /** 今日换手率（%） */
  turnoverRate: number
  /** 上一交易日最高价（0 = 无数据） */
  yestHigh: number
  /** 上一交易日最低价（0 = 无数据） */
  yestLow: number
  /** 近 60 个交易日最高价（含当前交易日，0 = 无数据） */
  high60: number
  /** 近 60 个交易日最低价（含当前交易日，0 = 无数据） */
  low60: number
  /** 近 5 个有效交易日收益率（百分比）；历史不足或不可比时为 null。 */
  return5: number | null
  /** 近 20 个有效交易日收益率（百分比）；历史不足或不可比时为 null。 */
  return20: number | null
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

// ── Primary: Tencent 5-min K-line API ───────────────────────────────────

/**
 * Fetch the 5-minute K-line from Tencent.
 * `bars` holds the K-line; the `qt` metadata inside the same response also
 * carries the daily trading data (volume / amount / turnover / market cap /
 * volume ratio / limits / preclose), so all of them come from one request.
 * When data is unavailable (e.g. non-trading day with no K-line data)
 * `bars` is an empty array.
 */
export interface TencentM5Result {
  bars: KlineBar[]
  yestclose: number
  open: number
  limitUp: number
  limitDown: number
  name: string
  /** 今日成交量（手） */
  volume: number
  /** 今日成交额（元） */
  amount: number
  /** 今日换手率（%） */
  turnoverRate: number
  /** 流通市值（元） */
  circulatingMarketCap: number
  /** 量比 */
  volumeRatio: number
}

export async function fetchTencentM5(code: string, count = M5_BAR_COUNT, timeoutMs = 8000): Promise<TencentM5Result> {
  const empty: TencentM5Result = {
    bars: [],
    yestclose: 0,
    open: 0,
    limitUp: 0,
    limitDown: 0,
    name: '',
    volume: 0,
    amount: 0,
    turnoverRate: 0,
    circulatingMarketCap: 0,
    volumeRatio: 0,
  }
  if (!/^(sh|sz)\d{6}$/.test(code)) return empty

  try {
    const payload = (await fetchJson(
      `${TENCENT_MKLINE_URL}?param=${code},m5,,${count}`,
      timeoutMs,
      { Referer: 'https://gu.qq.com/' }
    )) as Record<string, unknown>

    if ((payload as { code?: number }).code !== 0) return empty
    const stockData = ((payload as { data?: Record<string, unknown> }).data ?? {})[code] as
      | Record<string, unknown>
      | undefined
    if (!stockData) return empty

    // --- Extract metadata from the qt array ---
    // qt[code] is an array like ["1","贵州茅台","600519","1291.50","1307.88",...]
    // Zero-based indices (verified against live 2026-11-02 payloads):
    //   1  name               36  volume (手)
    //   4  yestclose          37  amount (万元)
    //   5  open               38  turnover rate (%)
    //   33 high               44  circulating market cap (亿元)
    //   34 low                47  limit-up price
    //  30  time               48  limit-down price
    //                          49  volume ratio
    const qt = (stockData.qt as Record<string, unknown>) ?? {}
    const qtArr = qt[code] as string[] | undefined
    let yestclose = 0
    let open = 0
    let limitUp = 0
    let limitDown = 0
    let name = ''
    let volume = 0
    let amount = 0
    let turnoverRate = 0
    let circulatingMarketCap = 0
    let volumeRatio = 0
    if (Array.isArray(qtArr) && qtArr.length >= 50) {
      name = qtArr[1] ?? ''
      yestclose = Number(qtArr[4]) || 0
      open = Number(qtArr[5]) || 0
      limitUp = Number(qtArr[47]) || 0
      limitDown = Number(qtArr[48]) || 0
      volume = Number(qtArr[36]) || 0
      amount = (Number(qtArr[37]) || 0) * 1e4 // 万元 → 元
      turnoverRate = Number(qtArr[38]) || 0
      circulatingMarketCap = (Number(qtArr[44]) || 0) * 1e8 // 亿元 → 元
      volumeRatio = Number(qtArr[49]) || 0
    }

    // --- Parse m5 bars ---
    // Each row: [time, open, close, high, low, volume(手), ...]
    //   time is "YYYYMMDDHHMM" (Tencent) or "YYYY-MM-DD HH:MM" (Eastmoney).
    const rawBars = stockData.m5 as unknown[] | undefined
    const bars: KlineBar[] = []
    if (Array.isArray(rawBars)) {
      for (const raw of rawBars) {
        if (!Array.isArray(raw) || raw.length < 6) continue
        const parsed = normalizeKlineTime(String(raw[0] ?? ''))
        const openValue = Number(raw[1]) || 0
        const closeValue = Number(raw[2]) || 0
        const highValue = Number(raw[3]) || 0
        const lowValue = Number(raw[4]) || 0
        if (!parsed || openValue <= 0 || closeValue <= 0 || highValue <= 0 || lowValue <= 0) continue
        bars.push({
          date: parsed.date,
          time: parsed.time,
          open: openValue,
          close: closeValue,
          high: highValue,
          low: lowValue,
          volume: Number(raw[5]) || 0,
          // Placeholder: `withCompletion` re-derives this against the exchange clock.
          completed: true,
        })
      }
    }

    return { bars, yestclose, open, limitUp, limitDown, name, volume, amount, turnoverRate, circulatingMarketCap, volumeRatio }
  } catch {
    return empty
  }
}

// ── Daily K-line (reference prices: yesterday + 60-trading-day range) ────

/**
 * Fetch the daily K-line for the last `count` trading days (ascending).
 *
 * Primary: Tencent `fqkline` with `qfq` (前复权) — adjusted, so the 60-day
 * high/low stays comparable across dividends. Fallback: Eastmoney `klt=101`
 * with `fqt=1` (also 前复权) when Tencent is unavailable or empty.
 *
 * The newest row may be today's still-forming session during trading hours;
 * `referencePrices` treats that row as "today" and steps back one for 昨日.
 */
export async function fetchDailyKline(code: string, count = DAILY_BAR_COUNT, timeoutMs = 8000): Promise<DailyBar[]> {
  if (!/^(sh|sz)\d{6}$/.test(code)) return []
  try {
    const payload = (await fetchJson(
      `${TENCENT_DAILY_KLINE_URL}?param=${code},day,,,${count},qfq`,
      timeoutMs,
      { Referer: 'https://gu.qq.com/' }
    )) as Record<string, unknown>
    if ((payload as { code?: number }).code !== 0) return []
    const stockData = ((payload as { data?: Record<string, unknown> }).data ?? {})[code] as
      | Record<string, unknown>
      | undefined
    if (!stockData) return []
    // 前复权列名 qfqday；部分标的无复权数据时退回原始 day 列。
    const rows = Array.isArray(stockData.qfqday)
      ? stockData.qfqday
      : Array.isArray(stockData.day)
        ? stockData.day
        : []
    const bars = parseTencentDailyRows(rows)
    if (bars.length > 0) return bars
  } catch {
    // Fall through to the Eastmoney fallback.
  }
  return fetchEastmoneyDaily(code, count, timeoutMs)
}

// ── Fallback: Eastmoney 5-min K-line API ────────────────────────────────

function eastmoneySecid(code: string): string {
  const digits = code.slice(2)
  return code.startsWith('sh') ? `1.${digits}` : `0.${digits}`
}

/**
 * Fetch the 5-minute K-line through Eastmoney (klt=5).
 * Used as fallback when the Tencent API is unavailable.
 */
export async function fetchEastmoneyM5(code: string, count = M5_BAR_COUNT, timeoutMs = 8000): Promise<KlineBar[]> {
  if (!/^(sh|sz)\d{6}$/.test(code)) return []
  const url = new URL(EASTMONEY_KLINE_URL)
  url.searchParams.set('secid', eastmoneySecid(code))
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6')
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58')
  url.searchParams.set('klt', '5')
  url.searchParams.set('fqt', '1')
  url.searchParams.set('beg', '0')
  url.searchParams.set('end', '20500101')
  url.searchParams.set('lmt', String(count))
  const payload = (await fetchJson(url.toString(), timeoutMs, {
    Referer: 'http://quote.eastmoney.com/',
  })) as { data?: { klines?: string[] } }
  const klines = payload.data?.klines
  if (!Array.isArray(klines)) return []

  const bars: KlineBar[] = []
  for (const line of klines) {
    // Eastmoney kline format (fields2=f51,f52,f53,f54,f55,f56,f57,f58):
    //   date,open,close,high,low,volume(手),amount(元),...
    const parts = line.split(',')
    if (parts.length < 7) continue
    const parsed = normalizeKlineTime(parts[0])
    const open = Number(parts[1]) || 0
    const close = Number(parts[2]) || 0
    const high = Number(parts[3]) || 0
    const low = Number(parts[4]) || 0
    if (!parsed || open <= 0 || close <= 0 || high <= 0 || low <= 0) continue
    bars.push({
      date: parsed.date,
      time: parsed.time,
      open,
      close,
      high,
      low,
      volume: Number(parts[5]) || 0,
      // Placeholder: `withCompletion` re-derives this against the exchange clock.
      completed: true,
    })
  }
  return bars
}

/**
 * Fetch the daily K-line through Eastmoney (klt=101, 前复权 fqt=1).
 * Fallback used when the Tencent fqkline endpoint is unavailable.
 */
async function fetchEastmoneyDaily(code: string, count: number, timeoutMs: number): Promise<DailyBar[]> {
  const url = new URL(EASTMONEY_KLINE_URL)
  url.searchParams.set('secid', eastmoneySecid(code))
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6')
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58')
  url.searchParams.set('klt', '101')
  url.searchParams.set('fqt', '1')
  url.searchParams.set('beg', '0')
  url.searchParams.set('end', '20500101')
  url.searchParams.set('lmt', String(count))
  const payload = (await fetchJson(url.toString(), timeoutMs, {
    Referer: 'http://quote.eastmoney.com/',
  })) as { data?: { klines?: string[] } }
  const klines = payload.data?.klines
  if (!Array.isArray(klines)) return []
  return parseEastmoneyDailyLines(klines)
}

// ── Utility helpers ────────────────────────────────────────────────────

/**
 * Normalize a K-line timestamp to `{ date, time }`.
 * Accepts both the compact Tencent form ("202610231335") and the dashed
 * Eastmoney form ("2026-10-23 13:35"). Returns null for anything else.
 */
export function normalizeKlineTime(raw: string): { date: string; time: string } | null {
  const digits = raw.replace(/\D/g, '')
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(digits)
  if (!match) return null
  return { date: `${match[1]}-${match[2]}-${match[3]}`, time: `${match[4]}:${match[5]}` }
}

/**
 * Filter an ascending bar series down to the latest trading day's bars.
 * The 5-minute chart is an intraday view, so only the most recent date's
 * bars (up to 48) are charted.
 */
export function barsForLatestDate(bars: KlineBar[]): KlineBar[] {
  const lastDate = bars.at(-1)?.date
  if (!lastDate) return []
  return bars.filter((bar) => bar.date === lastDate)
}

/**
 * Parse Tencent fqkline rows into daily bars.
 * Each row: [date, open, close, high, low, volume(手), ...] (ascending).
 */
export function parseTencentDailyRows(rows: unknown[]): DailyBar[] {
  const bars: DailyBar[] = []
  for (const raw of rows) {
    if (!Array.isArray(raw) || raw.length < 5) continue
    const date = String(raw[0] ?? '')
    const close = Number(raw[2]) || 0
    const high = Number(raw[3]) || 0
    const low = Number(raw[4]) || 0
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || !Number.isFinite(high) ||
      !Number.isFinite(low) || close <= 0 || high <= 0 || low <= 0) continue
    bars.push({ date, close, high, low })
  }
  return bars
}

/**
 * Parse Eastmoney daily K-line lines into daily bars.
 * Each line: date,open,close,high,low,volume(手),amount(元),... (ascending).
 */
export function parseEastmoneyDailyLines(lines: string[]): DailyBar[] {
  const bars: DailyBar[] = []
  for (const line of lines) {
    const parts = line.split(',')
    if (parts.length < 5) continue
    const date = parts[0]
    const close = Number(parts[2]) || 0
    const high = Number(parts[3]) || 0
    const low = Number(parts[4]) || 0
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || !Number.isFinite(high) ||
      !Number.isFinite(low) || close <= 0 || high <= 0 || low <= 0) continue
    bars.push({ date, close, high, low })
  }
  return bars
}

/** Today's calendar date in Asia/Shanghai as YYYY-MM-DD. */
export function chinaDateString(now = Date.now()): string {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10)
}

/**
 * Derive yesterday's high/low and the 60-trading-day high/low from an
 * ascending daily K-line series.
 *
 * 昨日 rule: when the newest daily bar belongs to *today's* calendar date
 * (a live session — the bar may still be forming), the previous trading day
 * is the second-to-last bar; otherwise (weekend / holiday / pre-open, where
 * no bar exists for today) the latest bar IS the previous trading day.
 *
 * The 60-trading-day window includes the latest bar (today when trading),
 * so "创 60 日新高/新低" checks behave live. All values are 0 when missing
 * (e.g. a single-bar new listing has no 昨日).
 */
export function referencePrices(
  daily: DailyBar[],
  today: string
): { yestHigh: number; yestLow: number; high60: number; low60: number } {
  const empty = { yestHigh: 0, yestLow: 0, high60: 0, low60: 0 }
  if (daily.length === 0) return empty

  const prevIndex = daily[daily.length - 1].date === today ? daily.length - 2 : daily.length - 1
  let yestHigh = 0
  let yestLow = 0
  if (prevIndex >= 0) {
    yestHigh = daily[prevIndex].high
    yestLow = daily[prevIndex].low
  }

  let high60 = -Infinity
  let low60 = Infinity
  for (const bar of daily) {
    high60 = Math.max(high60, bar.high)
    low60 = Math.min(low60, bar.low)
  }
  return { yestHigh, yestLow, high60, low60 }
}

/** Parse a "YYYY-MM-DD HH:mm[:ss]" exchange time as Asia/Shanghai epoch ms. */
export function parseChinaDateTime(text: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim())
  if (!match) return undefined
  const [, year, month, day, hour, minute, second] = match
  const utc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    second === undefined ? 0 : Number(second)
  )
  const check = new Date(utc)
  if (
    check.getUTCFullYear() !== Number(year) ||
    check.getUTCMonth() + 1 !== Number(month) ||
    check.getUTCDate() !== Number(day) ||
    check.getUTCHours() !== Number(hour) ||
    check.getUTCMinutes() !== Number(minute)
  ) {
    return undefined
  }
  return utc - 8 * 60 * 60_000
}

/**
 * Mark each bar with its completed state: a 5-minute bucket is closed once
 * the exchange clock (from the quote snapshot time) reaches the bucket's end
 * time. Historical days are therefore always completed; during a live session
 * only the bars up to the current bucket are. Without a parseable quote time
 * no bar is claimed to be "in progress" (`completed: true` for all).
 */
export function withCompletion(bars: KlineBar[], quoteTime: string): KlineBar[] {
  const quoteAt = parseChinaDateTime(quoteTime)
  if (quoteAt === undefined) return bars.map((bar) => ({ ...bar, completed: true }))
  return bars.map((bar) => {
    const barEnd = parseChinaDateTime(`${bar.date} ${bar.time}`)
    return { ...bar, completed: barEnd === undefined || quoteAt >= barEnd }
  })
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
 *   1. Tencent 5-min K-line API — returns bars + daily trading data
 *      (volume / amount / turnover / market cap / volume ratio / limits /
 *      preclose) in a single HTTP call. Falls back to Eastmoney bars + the
 *      old qt.gtimg.cn realtime quote when empty.
 *   2. The external `quote` (from Sina live quote) is used *only* as a
 *      fallback for name / yestclose / high / low when Tencent provides
 *      neither.
 */
export async function fetchStockDetail(
  code: string,
  quote: Quote | undefined,
  timeoutMs = 8000
): Promise<StockDetail> {
  // Daily K-line is an independent supplement (reference prices); never block
  // the main 5-min path on it — a failure degrades to zero values.
  const [tencent, daily] = await Promise.all([
    fetchTencentM5(code, M5_BAR_COUNT, timeoutMs),
    fetchDailyKline(code, DAILY_BAR_COUNT, timeoutMs).catch(() => [] as DailyBar[]),
  ])
  let bars: KlineBar[]
  let yestclose: number
  let limitUp: number
  let limitDown: number
  let name: string
  let extras: TradingExtras

  if (tencent.bars.length > 0) {
    // Tencent has data — use it (its qt metadata carries the trading data).
    bars = tencent.bars
    yestclose = tencent.yestclose
    limitUp = tencent.limitUp
    limitDown = tencent.limitDown
    name = tencent.name
    extras = {
      volume: tencent.volume,
      amount: tencent.amount,
      turnoverRate: tencent.turnoverRate,
      circulatingMarketCap: tencent.circulatingMarketCap,
      volumeRatio: tencent.volumeRatio,
    }
  } else {
    // Tencent failed or returned empty — fall back to Eastmoney bars and
    // fetch the realtime quote (limits + trading data) via qt.gtimg.cn.
    const [emBars, qtQuote] = await Promise.all([
      fetchEastmoneyM5(code, M5_BAR_COUNT, timeoutMs).catch(() => [] as KlineBar[]),
      fetchQtRealtime(code, timeoutMs),
    ])
    bars = emBars
    yestclose = quote?.yestclose ?? 0
    limitUp = qtQuote.limitUp
    limitDown = qtQuote.limitDown
    name = quote?.name ?? ''
    extras = qtQuote.extras
  }

  // The intraday chart only shows the latest trading day's 5-min bars; the
  // days before it are the MA warmup (5-minute closes, ascending).
  const kline5 = withCompletion(barsForLatestDate(bars), quote?.time ?? '')
  const warmupCloses = bars
    .filter((bar) => bar.date !== kline5.at(-1)?.date)
    .map((bar) => bar.close)
  const latest = kline5.at(-1)?.close ?? quote?.price ?? 0
  const currentQuotePrice = quote && quote.available && Number.isFinite(quote.price) && quote.price > 0
    ? quote.price
    : latest
  const closes = [...warmupCloses, ...kline5.map((bar) => bar.close)]

  // For a quote timestamped today, compare its live price with closes before
  // today's daily bar. Outside today's quote session, use the latest daily
  // close as P_t and exclude that bar from the prior-close window.
  const currentDate = chinaDateString()
  const quoteDate = quote?.time.slice(0, 10) ?? ''
  const hasCurrentQuote = currentQuotePrice > 0 && quoteDate === currentDate
  const latestDaily = daily.at(-1)
  const periodPrice = hasCurrentQuote ? currentQuotePrice : latestDaily?.close ?? currentQuotePrice
  const previousDailyBars = hasCurrentQuote
    ? latestDaily?.date === currentDate ? daily.slice(0, -1) : daily
    : latestDaily ? daily.slice(0, -1) : []
  const previousCloses = previousDailyBars.map((bar) => bar.close)
  const return5 = calcPeriodReturn(periodPrice, previousCloses, 5)
  const return20 = calcPeriodReturn(periodPrice, previousCloses, 20)

  // Daily-line MAs share the return/20 window: the closing series ends at the
  // current price during a live session (industry convention for intraday MA),
  // or at the latest settled daily close otherwise — reusing `periodPrice`.
  const dailyCloses = [...previousDailyBars.map((bar) => bar.close), periodPrice]
  const dailyMA = {
    ma5: calcMA(dailyCloses, 5),
    ma10: calcMA(dailyCloses, 10),
    ma20: calcMA(dailyCloses, 20),
    ma30: calcMA(dailyCloses, 30),
    ma60: calcMA(dailyCloses, 60),
  }

  // High/low: prefer Sina quote (reflects day's true range), fall back to
  // the 5-min K-line range.
  const highs = kline5.map((bar) => bar.high)
  const lows = kline5.map((bar) => bar.low)
  const snapshotHigh = quote?.available && Number.isFinite(quote.high) && quote.high > 0 ? quote.high : 0
  const snapshotLow = quote?.available && Number.isFinite(quote.low) && quote.low > 0 ? quote.low : 0
  const high = snapshotHigh || (highs.length > 0 ? Math.max(...highs) : 0)
  const low = snapshotLow || (lows.length > 0 ? Math.min(...lows) : 0)

  // 成交量: prefer the realtime snapshot figure (includes auction prints);
  // fall back to the sum of today's 5-minute bars when the snapshot lacks it.
  const hasSnapshotVolume = Number.isFinite(extras.volume) && extras.volume > 0
  const volumeFromBars = !hasSnapshotVolume
  const volume = hasSnapshotVolume ? extras.volume : kline5.reduce((sum, bar) => sum + bar.volume, 0)

  const refs = referencePrices(daily, chinaDateString())

  return {
    code,
    name: name || quote?.name || code,
    price: currentQuotePrice,
    open: tencent.open || quote?.open || 0,
    high,
    low,
    snapshotHigh,
    snapshotLow,
    yestclose,
    limitUp,
    limitDown,
    time: quote?.time ?? '',
    kline5,
    klineWarmup: warmupCloses,
    ma: {
      ma5: calcMA(closes, 5),
      ma10: calcMA(closes, 10),
      ma20: calcMA(closes, 20),
      ma30: calcMA(closes, 30),
      ma60: calcMA(closes, 60),
    },
    dailyMA,
    circulatingMarketCap: extras.circulatingMarketCap,
    volumeRatio: extras.volumeRatio,
    volume,
    volumeFromBars,
    amount: extras.amount,
    turnoverRate: extras.turnoverRate,
    yestHigh: refs.yestHigh,
    yestLow: refs.yestLow,
    high60: refs.high60,
    low60: refs.low60,
    return5,
    return20,
  }
}

// ── Legacy limit-price fetcher (fallback only) ─────────────────────────

/**
 * Daily trading-data extras shared by every source path.
 * All values are 0 when the source does not provide them.
 */
export interface TradingExtras {
  /** 成交量（手） */
  volume: number
  /** 成交额（元） */
  amount: number
  /** 换手率（%） */
  turnoverRate: number
  /** 流通市值（元） */
  circulatingMarketCap: number
  /** 量比 */
  volumeRatio: number
}

const emptyTradingExtras: TradingExtras = {
  volume: 0,
  amount: 0,
  turnoverRate: 0,
  circulatingMarketCap: 0,
  volumeRatio: 0,
}

/**
 * Fetch the Tencent realtime quote via the old qt.gtimg.cn endpoint
 * (limits + daily trading data). Used only when the primary Tencent
 * 5-min K-line API failed, as a companion to the Eastmoney fallback.
 * Field indices match the quote line format shared with the mkline `qt`
 * array (verified against live payloads).
 */
async function fetchQtRealtime(code: string, timeoutMs = 8000): Promise<{
  limitUp: number
  limitDown: number
  extras: TradingExtras
}> {
  const result = { limitUp: 0, limitDown: 0, extras: { ...emptyTradingExtras } }
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
      result.extras = {
        volume: Number(fields[36]) || 0,
        amount: (Number(fields[37]) || 0) * 1e4, // 万元 → 元
        turnoverRate: Number(fields[38]) || 0,
        circulatingMarketCap: (Number(fields[44]) || 0) * 1e8, // 亿元 → 元
        volumeRatio: Number(fields[49]) || 0,
      }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // Silently return zeros
  }
  return result
}
