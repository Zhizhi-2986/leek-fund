import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcDayAverage,
  calcIntradayAmplitude,
  calcPercentAboveLow,
  calcPercentFromHigh,
  calcPeriodReturn,
  calcRangePosition,
} from '../src/daily-math.js'

describe('calcDayAverage', () => {
  it('converts yuan and lots to an estimated per-share average', () => {
    const average = calcDayAverage(1_353_000_000, 683_500)
    assert.ok(average !== null)
    assert.ok(Math.abs(average - 19.79517) < 0.0001)
  })

  it('returns null when source values are absent or invalid', () => {
    assert.equal(calcDayAverage(0, 100), null)
    assert.equal(calcDayAverage(100, 0), null)
    assert.equal(calcDayAverage(undefined, 100), null)
    assert.equal(calcDayAverage(100, Number.NaN), null)
    assert.equal(calcDayAverage(Number.POSITIVE_INFINITY, 100), null)
  })
})

describe('calcPeriodReturn', () => {
  it('uses the Nth previous trading close, not a calendar-day offset', () => {
    assert.equal(calcPeriodReturn(15, [10, 11, 12, 13, 14], 5), 50)
    assert.ok(Math.abs((calcPeriodReturn(15, [14], 1) ?? 0) - (15 / 14 - 1) * 100) < 1e-10)
  })

  it('returns null when history, price, or period is invalid', () => {
    assert.equal(calcPeriodReturn(15, [10, 11, 12, 13], 5), null)
    assert.equal(calcPeriodReturn(0, [10, 11, 12, 13, 14], 5), null)
    assert.equal(calcPeriodReturn(15, [10, 11, 12, 13, 14], 0), null)
    assert.equal(calcPeriodReturn(15, [10, 11, 12, 13, Number.NaN], 5), null)
  })
})

describe('calcRangePosition', () => {
  it('calculates the position from the actual price range', () => {
    const position = calcRangePosition(20.06, 18.03, 40.69)
    assert.ok(position !== null)
    assert.ok(Math.abs(position - 8.9585) < 0.001)
  })

  it('preserves out-of-range values and rejects a zero-width range', () => {
    assert.equal(calcRangePosition(9, 10, 20), -10)
    assert.ok(Math.abs((calcRangePosition(21, 10, 20) ?? 0) - 110) < 1e-10)
    assert.equal(calcRangePosition(10, 10, 10), null)
    assert.equal(calcRangePosition(Number.NaN, 10, 20), null)
  })
})

describe('price distance and amplitude helpers', () => {
  it('calculates percentage distance from high and above low', () => {
    assert.equal(calcPercentFromHigh(20, 40), -50)
    assert.equal(calcPercentAboveLow(20, 10), 100)
    assert.equal(calcPercentFromHigh(20, 0), null)
  })

  it('calculates day amplitude relative to previous close', () => {
    assert.equal(calcIntradayAmplitude(20, 18, 19), (2 / 19) * 100)
    assert.equal(calcIntradayAmplitude(20, 18, 0), null)
  })
})
