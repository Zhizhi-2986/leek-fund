/**
 * Pure geometry / statistics helpers for the 5-minute candlestick chart.
 *
 * Everything here is a pure function of its inputs (no DOM, no React), so it
 * can be unit-tested under `node --test` and reused by both the chart and the
 * data layer. The single `priceToY` mapping below is the ONLY price→pixel
 * mapping used by candles, wicks, MA lines, both price axes, reference lines
 * and extremum labels — see the dsh-leek-fund K-line precision spec §4.
 */
import { isEtf } from './quote.js'

/** Uniform price scale: [min, max] prices mapped linearly onto [top, bottom] pixels. */
export interface PriceScale {
  min: number
  max: number
  top: number
  bottom: number
}

/** Largest / smallest bar extremes of a 5-minute series. */
export interface BarExtremes {
  high: number
  low: number
  /** Index of the first bar whose high equals `high` (stable rule). */
  highIndex: number
  /** Index of the first bar whose low equals `low` (stable rule). */
  lowIndex: number
}

/** One input bar: only the prices are needed for the geometry helpers. */
export interface PriceBar {
  high: number
  low: number
}

/**
 * Map a price to its Y pixel position on the scale.
 * Prices are inverted on screen: higher price → smaller Y.
 */
export function priceToY(price: number, scale: PriceScale): number {
  const height = scale.bottom - scale.top
  return scale.top + ((scale.max - price) / (scale.max - scale.min)) * height
}

/** Inverse mapping (used only for the hover cursor's reference price). */
export function yToPrice(y: number, scale: PriceScale): number {
  const height = scale.bottom - scale.top
  return scale.max - ((y - scale.top) / height) * (scale.max - scale.min)
}

/**
 * Build the price scale covering every visible bar extreme plus at least
 * `padRatio` (default 6%) of headroom on both sides. A flat series
 * (`rawMin === rawMax`, e.g. halts) gets a non-zero range derived from the
 * instrument's tick size instead of dividing by zero.
 */
export function buildPriceScale(
  rawMin: number,
  rawMax: number,
  top: number,
  bottom: number,
  padRatio = 0.06,
  tick = 0.01
): PriceScale {
  const min0 = Number.isFinite(rawMin) ? rawMin : 0
  const max0 = Number.isFinite(rawMax) ? rawMax : 0
  const span = max0 - min0
  const pad = span > 0 ? span * padRatio : Math.max(tick * 2, Math.abs(max0) * 0.02 || tick)
  return { min: min0 - pad, max: max0 + pad, top, bottom }
}

/**
 * First-occurrence extremes of the bar series. Bars with non-positive or
 * non-finite prices are treated as invalid data (never reachable from the
 * real parsers, which already drop them) and skipped. Returns null for an
 * empty / all-invalid input so callers can show an explicit "no data" state.
 */
export function barExtremes(bars: PriceBar[]): BarExtremes | null {
  if (bars.length === 0) return null
  let high = -Infinity
  let low = Infinity
  let highIndex = -1
  let lowIndex = -1
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i]
    if (!Number.isFinite(bar.high) || !Number.isFinite(bar.low) || bar.high <= 0 || bar.low <= 0) {
      continue
    }
    if (bar.high > high) {
      high = bar.high
      highIndex = i
    }
    if (bar.low < low) {
      low = bar.low
      lowIndex = i
    }
  }
  if (highIndex < 0 || lowIndex < 0) return null
  return { high, low, highIndex, lowIndex }
}

/**
 * Simple moving average over the close series, aligned to the input: the
 * first `period - 1` entries are null (insufficient window). This is the
 * 5-minute-close SMA (NOT a daily MA); when warmup history is too short the
 * caller shows `—` / skips the segment instead of faking a value.
 */
export function maSeries(closes: number[], period: number): (number | null)[] {
  if (!Number.isInteger(period) || period <= 0) return closes.map(() => null)
  return closes.map((_, i) => {
    if (i + 1 < period) return null
    let sum = 0
    for (let k = i - period + 1; k <= i; k += 1) {
      const value = closes[k]
      if (!Number.isFinite(value)) return null
      sum += value
    }
    return sum / period
  })
}

/** Display precision in decimal digits for a code (ETF / sub-1 prices: 3). */
export function tickDigitsFor(code: string, name = '', price = 0): number {
  if (isEtf(code, name) || (Number.isFinite(price) && price < 1)) return 3
  return 2
}

/** Smallest price increment for the instrument (1 unit of its display precision). */
export function tickFor(code: string, name = '', price = 0): number {
  return Math.pow(10, -tickDigitsFor(code, name, price))
}

/**
 * Compare bar-aggregated extremes against the quote snapshot's day high/low
 * with a tick-size tolerance. A non-positive quote extreme means the snapshot
 * did not provide that field (fallback path), which should never be reported
 * as a mismatch. The tolerance only detects a difference; it is never used to
 * rewrite bars.
 */
export function extremeMismatch(
  barLow: number,
  barHigh: number,
  quoteLow: number,
  quoteHigh: number,
  tick: number
): { lowMismatch: boolean; highMismatch: boolean } {
  const tolerance = tick / 2
  const within = (a: number, b: number): boolean => Math.abs(a - b) <= tolerance
  const lowMismatch =
    Number.isFinite(quoteLow) && quoteLow > 0 && !within(barLow ?? 0, quoteLow)
  const highMismatch =
    Number.isFinite(quoteHigh) && quoteHigh > 0 && !within(barHigh ?? 0, quoteHigh)
  return { lowMismatch, highMismatch }
}
