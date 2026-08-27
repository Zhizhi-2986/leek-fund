/**
 * Strategy stock-picking engine for dsh-leek-fund.
 *
 * Evaluates A-share stocks against the user's core trading strategy using
 * 120-minute K-line data from Sina Finance.
 *
 * Strategy rules (all three must pass):
 *   Trend: 120Min close > EMA20 AND EMA20 is upward sloping
 *   Momentum: 120Min MACD bar turned from negative to positive AND
 *             2 consecutive bars growing
 *   Volume: latest bar volume > 20-period average × 1.2
 *
 * Prohibition:
 *   120Min RSI(14) > 75 → skip (cannot open)
 */
// ── Types ────────────────────────────────────────────────────────────────

export interface KlineBar {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
}

export interface StrategyResult {
  /** Stock codes that passed all strategy conditions. */
  matched: string[]
  /** Stock codes that were evaluated but failed. */
  failed: string[]
  /** Stock codes that had insufficient data. */
  skipped: string[]
  /** ISO timestamp of evaluation. */
  evaluatedAt: string
}

// ── Constants ────────────────────────────────────────────────────────────

const SINA_KLINE_URL =
  'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData'

/** The "策略选股" group name used to identify the auto-populated group. */
export const STRATEGY_GROUP_NAME = '策略选股'

/** EMA period for trend condition. */
const EMA_PERIOD = 20
/** MACD parameters. */
const MACD_FAST = 12
const MACD_SLOW = 26
const MACD_SIGNAL = 9
/** RSI period. */
const RSI_PERIOD = 14
/** RSI upper bound: stocks above this are skipped. */
const RSI_MAX = 75
/** Minimum consecutive MACD bar growth. */
const MIN_BAR_GROWTH = 2
/** Volume multiplier for the volume condition. */
const VOLUME_MULTIPLIER = 1.2
/** Minimum number of bars needed for all indicators. */
const MIN_BARS = 30
/** Number of bars to fetch from the API. */
const FETCH_COUNT = 60
/** Maximum concurrent API requests. */
const MAX_CONCURRENCY = 5

// ── HTTP fetch helper ────────────────────────────────────────────────────

async function fetchText(url: string, timeoutMs: number, headers: Record<string, string>): Promise<string> {
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
    return new TextDecoder('utf-8').decode(buffer)
  } finally {
    clearTimeout(timer)
  }
}

// ── Market data fetching ─────────────────────────────────────────────────

/**
 * Fetch 120-minute K-line data from Sina Finance.
 * Returns an array of bars sorted by date (oldest first).
 */
export async function fetchKline120Min(code: string, timeoutMs = 10_000): Promise<KlineBar[]> {
  if (!/^(sh|sz)\d{6}$/.test(code)) return []

  const url = new URL(SINA_KLINE_URL)
  url.searchParams.set('symbol', code)
  url.searchParams.set('scale', '120') // 120-minute bars
  url.searchParams.set('ma', 'no')
  url.searchParams.set('datalen', String(FETCH_COUNT))

  try {
    const text = await fetchText(url.toString(), timeoutMs, {
      Referer: 'https://finance.sina.com.cn/',
    })
    const data: unknown = JSON.parse(text)
    if (!Array.isArray(data)) return []

    return data.map((item: unknown) => {
      const raw = item as Record<string, unknown>
      return {
        date: String(raw.day ?? ''),
        open: Number(raw.open) || 0,
        close: Number(raw.close) || 0,
        high: Number(raw.high) || 0,
        low: Number(raw.low) || 0,
        volume: Number(raw.volume) || 0,
      }
    }).filter((bar) => bar.close > 0)
  } catch {
    return []
  }
}

// ── Technical indicator calculations ─────────────────────────────────────

/**
 * Calculate Exponential Moving Average.
 * Returns an array aligned with input (first `period-1` values may be null).
 */
export function calcEMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  const multiplier = 2 / (period + 1)

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null)
    } else if (i === period - 1) {
      // First EMA is SMA of first `period` values
      let sum = 0
      for (let j = 0; j < period; j++) sum += closes[j]
      result.push(+(sum / period).toFixed(3))
    } else {
      const ema = (closes[i] - result[i - 1]!) * multiplier + result[i - 1]!
      result.push(+ema.toFixed(3))
    }
  }
  return result
}

export interface MACDResult {
  dif: (number | null)[]
  dea: (number | null)[]
  bar: (number | null)[]
}

/**
 * Calculate MACD indicator.
 */
export function calcMACD(
  closes: number[],
  fast = MACD_FAST,
  slow = MACD_SLOW,
  signal = MACD_SIGNAL,
): MACDResult {
  const emaFast = calcEMA(closes, fast)
  const emaSlow = calcEMA(closes, slow)

  const dif: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (emaFast[i] === null || emaSlow[i] === null) {
      dif.push(null)
    } else {
      dif.push(+(emaFast[i]! - emaSlow[i]!).toFixed(3))
    }
  }

  const difValues = dif.map((v) => v ?? 0)
  const dea = calcEMA(difValues, signal)

  const bar: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (dif[i] === null || dea[i] === null) {
      bar.push(null)
    } else {
      bar.push(+((dif[i]! - dea[i]!) * 2).toFixed(3))
    }
  }

  return { dif, dea, bar }
}

/**
 * Calculate RSI.
 */
export function calcRSI(closes: number[], period = RSI_PERIOD): (number | null)[] {
  const result: (number | null)[] = []

  if (closes.length < period + 1) {
    return closes.map(() => null)
  }

  // Daily changes
  const changes: number[] = []
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1])
  }

  // First `period` values are null
  for (let i = 0; i < period; i++) result.push(null)

  // First RSI
  let avgGain = 0
  let avgLoss = 0
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i]
    else avgLoss += Math.abs(changes[i])
  }
  avgGain /= period
  avgLoss /= period

  if (avgLoss === 0) {
    result.push(100)
  } else {
    const rs = avgGain / avgLoss
    result.push(+(100 - 100 / (1 + rs)).toFixed(2))
  }

  // Smooth subsequent RSIs
  for (let i = period; i < changes.length; i++) {
    const change = changes[i]
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period

    if (avgLoss === 0) {
      result.push(100)
    } else {
      const rs = avgGain / avgLoss
      result.push(+(100 - 100 / (1 + rs)).toFixed(2))
    }
  }

  return result
}

/**
 * Calculate Simple Moving Average (used for volume MA).
 */
export function calcSMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(null)
    } else {
      let sum = 0
      for (let j = 0; j < period; j++) sum += values[i - j]
      result.push(+(sum / period).toFixed(3))
    }
  }
  return result
}

// ── Strategy evaluation ──────────────────────────────────────────────────

export interface EvaluationDetail {
  code: string
  name?: string
  pass: boolean
  reasons: string[]
}

/**
 * Evaluate one stock against the full strategy.
 * Returns the evaluation detail with pass/fail and reasons.
 */
export async function evaluateStock(
  code: string,
  name?: string,
  timeoutMs = 10_000,
): Promise<EvaluationDetail> {
  const reasons: string[] = []

  const bars = await fetchKline120Min(code, timeoutMs)
  if (bars.length < MIN_BARS) {
    return {
      code,
      name,
      pass: false,
      reasons: [`数据不足: 仅 ${bars.length} 根 120Min K 线，需要至少 ${MIN_BARS} 根`],
    }
  }

  const closes = bars.map((b) => b.close)
  const volumes = bars.map((b) => b.volume)
  const latest = bars[bars.length - 1]
  const prev = bars[bars.length - 2]

  // ── 1. Trend: EMA20 ──────────────────────────────────────────────────
  const ema20 = calcEMA(closes, EMA_PERIOD)
  const latestEMA = ema20[ema20.length - 1]
  const prevEMA = ema20[ema20.length - 2]

  if (latestEMA === null || prevEMA === null) {
    return { code, name, pass: false, reasons: ['EMA20 数据不足'] }
  }

  const priceAboveEMA = latest.close > latestEMA
  const emaUpward = latestEMA > prevEMA

  if (!priceAboveEMA) {
    reasons.push(`价格 ${latest.close} ≤ EMA20 ${latestEMA}`)
  } else {
    reasons.push(`价格 ${latest.close} > EMA20 ${latestEMA}`)
  }
  if (!emaUpward) {
    reasons.push(`EMA20 未向上倾斜 (${prevEMA} → ${latestEMA})`)
  } else {
    reasons.push(`EMA20 向上倾斜 (${prevEMA} → ${latestEMA})`)
  }

  // ── 2. Momentum: MACD ────────────────────────────────────────────────
  const macd = calcMACD(closes)
  const latestBar = macd.bar[macd.bar.length - 1]
  const prev1Bar = macd.bar[macd.bar.length - 2]
  const prev2Bar = macd.bar[macd.bar.length - 3]

  if (latestBar === null || prev1Bar === null || prev2Bar === null) {
    return { code, name, pass: false, reasons: ['MACD 数据不足'] }
  }

  // Bar turned from negative to positive: prev1Bar < 0 and latestBar > 0
  // OR both are positive and growing
  const turnedPositive = prev1Bar < 0 && latestBar > 0
  const barsGrowing = latestBar > prev1Bar && prev1Bar > prev2Bar

  if (!turnedPositive && !barsGrowing) {
    if (latestBar <= 0) {
      reasons.push(`MACD 柱未翻红 (${prev1Bar} → ${latestBar})`)
    } else {
      reasons.push(`MACD 柱未连续放大 (${prev2Bar} → ${prev1Bar} → ${latestBar})`)
    }
  } else {
    reasons.push(`MACD 柱${turnedPositive ? '翻红' : ''}${barsGrowing ? '连续放大' : ''} (${prev2Bar} → ${prev1Bar} → ${latestBar})`)
  }

  // ── 3. Volume ────────────────────────────────────────────────────────
  const volSMA = calcSMA(volumes, EMA_PERIOD)
  const latestVolSMA = volSMA[volSMA.length - 2] // SMA shifts by 1 due to calc; use prev bar's MA as reference
  const volMA20 = latestVolSMA ?? volumes.slice(-(EMA_PERIOD + 1), -1).reduce((a, b) => a + b, 0) / EMA_PERIOD

  const volumeCondition = latest.volume > volMA20 * VOLUME_MULTIPLIER

  if (!volumeCondition) {
    reasons.push(`成交量 ${latest.volume} ≤ 均量 ${volMA20.toFixed(0)} × ${VOLUME_MULTIPLIER}`)
  } else {
    reasons.push(`成交量 ${latest.volume} > 均量 ${volMA20.toFixed(0)} × ${VOLUME_MULTIPLIER}`)
  }

  // ── 4. RSI check (prohibition) ───────────────────────────────────────
  const rsiValues = calcRSI(closes, RSI_PERIOD)
  const latestRSI = rsiValues[rsiValues.length - 1]

  if (latestRSI !== null && latestRSI > RSI_MAX) {
    reasons.push(`RSI(14) ${latestRSI} > ${RSI_MAX}，禁止开仓`)
  } else if (latestRSI !== null) {
    reasons.push(`RSI(14) ${latestRSI} ≤ ${RSI_MAX}，通过`)
  }

  // ── Final decision ───────────────────────────────────────────────────
  // All three primary conditions must pass + RSI ≤ 75
  const trendPass = priceAboveEMA && emaUpward
  const momentumPass = turnedPositive || barsGrowing
  const volumePass = volumeCondition
  const rsiPass = latestRSI === null || latestRSI <= RSI_MAX

  const pass = trendPass && momentumPass && volumePass && rsiPass

  return { code, name, pass, reasons }
}

// ── Batch evaluation ─────────────────────────────────────────────────────

/**
 * Evaluate multiple stock codes against the strategy with concurrency control.
 */
export async function evaluateBatch(
  codes: string[],
  nameMap?: Map<string, string>,
  timeoutMs = 10_000,
): Promise<StrategyResult> {
  const matched: string[] = []
  const failed: string[] = []
  const skipped: string[] = []

  // Process in batches to limit concurrency
  for (let i = 0; i < codes.length; i += MAX_CONCURRENCY) {
    const batch = codes.slice(i, i + MAX_CONCURRENCY)
    const results = await Promise.all(
      batch.map((code) =>
        evaluateStock(code, nameMap?.get(code), timeoutMs).catch(
          (): EvaluationDetail => ({ code, pass: false, reasons: ['评估异常'] }),
        ),
      ),
    )

    for (const result of results) {
      if (result.reasons.some((r) => r.startsWith('数据不足') || r.startsWith('EMA20 数据不足') || r.startsWith('MACD 数据不足'))) {
        skipped.push(result.code)
      } else if (result.pass) {
        matched.push(result.code)
      } else {
        failed.push(result.code)
      }
    }
  }

  return {
    matched,
    failed,
    skipped,
    evaluatedAt: new Date().toISOString(),
  }
}

// ── Trading hours check ──────────────────────────────────────────────────

/**
 * Check whether the current time falls within A-share trading hours
 * (weekdays 9:30 – 11:30 / 13:00 – 15:00).
 * Returns true if we should attempt evaluation.
 */
export function isInTradingHours(): boolean {
  const now = new Date()
  const day = now.getDay()
  // Weekend
  if (day === 0 || day === 6) return false

  // Convert to Asia/Shanghai manually (UTC+8)
  const utcHour = now.getUTCHours()
  const utcMin = now.getUTCMinutes()
  // Beijing time = UTC+8
  let hour = utcHour + 8
  let min = utcMin
  if (hour >= 24) { hour -= 24 }

  const totalMin = hour * 60 + min

  // Morning: 9:30 (570) – 11:30 (690)
  // Afternoon: 13:00 (780) – 15:00 (900)
  return (totalMin >= 570 && totalMin < 690) || (totalMin >= 780 && totalMin < 900)
}

/**
 * Check if current time is close to an evaluation time (within ±5 min of
 * the 30-min tick boundary). This prevents unnecessary API calls when the
 * scheduler fires slightly off the intended mark.
 */
export function isNearEvaluationTick(): boolean {
  const now = new Date()
  const utcHour = now.getUTCHours()
  const utcMin = now.getUTCMinutes()
  let hour = utcHour + 8
  let min = utcMin
  if (hour >= 24) { hour -= 24 }

  const totalMin = hour * 60 + min

  // We evaluate at 0 and 30 minutes past each hour during trading hours.
  // Accept a ±5 minute window around the tick.
  const tick = totalMin % 30
  return tick <= 5 || tick >= 25
}
