import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  barExtremes,
  buildPriceScale,
  extremeMismatch,
  maSeries,
  priceToY,
  tickFor,
  tickDigitsFor,
  yToPrice,
} from '../src/kline-math.js'

const bars = () => [
  { high: 20.26, low: 18.55 },
  { high: 20.1, low: 18.54 },
  { high: 20.05, low: 18.6 },
  { high: 20.2, low: 18.7 },
]

describe('buildPriceScale', () => {
  it('produces an invertible pixel→price mapping with padding', () => {
    const scale = buildPriceScale(18, 21, 20, 400, 0.06, 0.01)
    assert.ok(scale.min < 18)
    assert.ok(scale.max > 21)
    const y = priceToY(19.2, scale)
    assert.ok(y > 20 && y < 400)
    const price = yToPrice(y, scale)
    assert.ok(Math.abs(price - 19.2) < 0.001)
  })

  it('maps the top pixel to max and the bottom pixel to min area', () => {
    const scale = buildPriceScale(18, 21, 20, 400, 0.06, 0.01)
    assert.ok(priceToY(scale.max, scale) < 24)
    assert.ok(priceToY(scale.min, scale) > 396)
  })

  it('spreads a flat series instead of dividing by zero', () => {
    const scale = buildPriceScale(10, 10, 20, 400, 0.06, 0.01)
    assert.ok(scale.max > scale.min)
    const mid = priceToY(10, scale)
    assert.ok(mid > 20 && mid < 400)
  })
})

describe('barExtremes', () => {
  it('finds the high/low with their first-occurrence bar index', () => {
    const result = barExtremes(bars())
    assert.deepEqual(result, { high: 20.26, low: 18.54, highIndex: 0, lowIndex: 1 })
  })

  it('uses the first bar when several share the extreme price', () => {
    const result = barExtremes([
      { high: 20.1, low: 18.6 },
      { high: 21, low: 18.6 },
      { high: 21, low: 18.6 },
    ])
    assert.equal(result!.highIndex, 1)
    assert.equal(result!.lowIndex, 0)
  })

  it('returns null for empty or invalid input', () => {
    assert.equal(barExtremes([]), null)
    assert.equal(barExtremes([{ high: 0, low: 0 }]), null)
    assert.equal(barExtremes([{ high: NaN, low: 1 }]), null)
    assert.equal(barExtremes([{ high: -1, low: 2 }]), null)
  })
})

describe('maSeries', () => {
  it('computes a running window SMA and pads the head with null', () => {
    const closes = [1, 2, 3, 4, 5, 6]
    const result = maSeries(closes, 3)
    assert.deepEqual(result, [null, null, 2, 3, 4, 5])
  })

  it('yields null when the window cannot be filled', () => {
    assert.deepEqual(maSeries([1, 2], 5), [null, null])
    assert.deepEqual(maSeries([], 5), [])
  })

  it('recomputes each window instead of leaking an average', () => {
    // [1,2,3,4,5] → avg 3; appending 100 must shift the window, not
    // accumulate the previous mean.
    const result = maSeries([1, 2, 3, 4, 5, 100], 5)
    assert.deepEqual(result, [null, null, null, null, 3, 22.8])
  })
})

describe('extremeMismatch', () => {
  it('reports a quote extreme that no 5-minute bar holds', () => {
    const result = extremeMismatch(18.54, 20.26, 18.52, 20.27, 0.01)
    assert.equal(result.lowMismatch, true)
    assert.equal(result.highMismatch, true)
  })

  it('tolerates differences within half a tick (rounding)', () => {
    const result = extremeMismatch(18.54, 20.26, 18.544, 20.26, 0.01)
    assert.equal(result.lowMismatch, false)
    assert.equal(result.highMismatch, false)
    // A full tick difference is still a mismatch.
    const full = extremeMismatch(18.54, 20.26, 18.53, 20.26, 0.01)
    assert.equal(full.lowMismatch, true)
  })

  it('accepts a quote snapshot equal to the bar extremes', () => {
    const result = extremeMismatch(18.54, 20.26, 18.54, 20.26, 0.01)
    assert.equal(result.lowMismatch, false)
    assert.equal(result.highMismatch, false)
  })

  it('avoids false alarms for missing quote extremes (0)', () => {
    const result = extremeMismatch(18.54, 20.26, 0, 0, 0.01)
    assert.equal(result.lowMismatch, false)
    assert.equal(result.highMismatch, false)
  })
})

describe('tick helpers', () => {
  it('uses three decimals for ETFs and sub-1 prices', () => {
    assert.equal(tickDigitsFor('sh510300', '沪深300ETF', 3.8), 3)
    assert.equal(tickDigitsFor('sz000001', '平安银行', 0.9), 3)
    assert.equal(tickDigitsFor('sz000001', '平安银行', 10.2), 2)
  })

  it('derives the tick from digits', () => {
    assert.equal(tickFor('sh510300', '沪深300ETF', 3.8), 0.001)
    assert.equal(tickFor('sz000001', '平安银行', 10.2), 0.01)
  })
})
