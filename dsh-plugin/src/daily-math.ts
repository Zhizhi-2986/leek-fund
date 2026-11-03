/** Pure daily price / range calculations shared by the host and detail panel. */

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/** Estimate yuan/share from total amount in yuan and volume in A-share lots. */
export function calcDayAverage(amountYuan: number | null | undefined, volumeHands: number | null | undefined): number | null {
  if (amountYuan == null || volumeHands == null || !isPositiveFinite(amountYuan) || !isPositiveFinite(volumeHands)) {
    return null
  }
  const shares = volumeHands * 100
  const average = amountYuan / shares
  return isPositiveFinite(average) ? average : null
}

/** Return percentage against the Nth prior effective trading close. */
export function calcPeriodReturn(
  currentPrice: number | null | undefined,
  previousCloses: number[],
  period: number
): number | null {
  if (!isPositiveFinite(currentPrice ?? Number.NaN) || !Number.isInteger(period) || period <= 0 || previousCloses.length < period) {
    return null
  }
  const window = previousCloses.slice(-period)
  if (!window.every(isPositiveFinite)) return null
  const referenceClose = window[0]
  const result = ((currentPrice as number) / referenceClose - 1) * 100
  return Number.isFinite(result) ? result : null
}

/** Position within a price range in percent; deliberately not clamped. */
export function calcRangePosition(
  price: number | null | undefined,
  low: number | null | undefined,
  high: number | null | undefined
): number | null {
  if (!isPositiveFinite(price ?? Number.NaN) || !isPositiveFinite(low ?? Number.NaN) ||
    !isPositiveFinite(high ?? Number.NaN) || (high as number) <= (low as number)) {
    return null
  }
  const result = (((price as number) - (low as number)) / ((high as number) - (low as number))) * 100
  return Number.isFinite(result) ? result : null
}

/** Percentage distance from a positive high price. */
export function calcPercentFromHigh(price: number, high: number): number | null {
  if (!isPositiveFinite(price) || !isPositiveFinite(high)) return null
  const result = (price / high - 1) * 100
  return Number.isFinite(result) ? result : null
}

/** Percentage change from a positive low price. */
export function calcPercentAboveLow(price: number, low: number): number | null {
  if (!isPositiveFinite(price) || !isPositiveFinite(low)) return null
  const result = (price / low - 1) * 100
  return Number.isFinite(result) ? result : null
}

/** Intraday amplitude relative to the previous close. */
export function calcIntradayAmplitude(high: number, low: number, previousClose: number): number | null {
  if (!isPositiveFinite(high) || !isPositiveFinite(low) || high < low || !isPositiveFinite(previousClose)) return null
  const result = ((high - low) / previousClose) * 100
  return Number.isFinite(result) ? result : null
}
