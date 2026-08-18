import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { calcMA, closesWithLatest } from '../src/detail.js'

describe('closesWithLatest', () => {
  it('replaces the last close when the daily bar is today', () => {
    const today = new Date()
    const month = String(today.getMonth() + 1).padStart(2, '0')
    const day = String(today.getDate()).padStart(2, '0')
    const todayStr = `${today.getFullYear()}-${month}-${day}`
    const daily = [
      { date: '2026-08-14', close: 9.1 },
      { date: todayStr, close: 9.2 },
    ]
    const closes = closesWithLatest(daily, 9.04)
    assert.deepEqual(closes, [9.1, 9.04])
  })

  it('appends the latest price when the daily bar is not today', () => {
    const daily = [
      { date: '2026-08-13', close: 9.1 },
      { date: '2026-08-14', close: 9.2 },
    ]
    const closes = closesWithLatest(daily, 9.04)
    assert.deepEqual(closes, [9.1, 9.2, 9.04])
  })

  it('returns closes unchanged for empty input plus the latest', () => {
    assert.deepEqual(closesWithLatest([], 9.04), [9.04])
  })
})

describe('calcMA', () => {
  it('computes the moving average over the last N closes', () => {
    const closes = [10, 11, 12, 13, 14, 15]
    assert.equal(calcMA(closes, 5), 13) // (11+12+13+14+15)/5
    assert.equal(calcMA(closes, 3), 14) // (13+14+15)/3
  })

  it('returns null when there are not enough closes', () => {
    assert.equal(calcMA([1, 2, 3], 5), null)
    assert.equal(calcMA([], 5), null)
  })

  it('uses the latest window', () => {
    const closes = [1, 2, 3, 4, 5, 100]
    assert.equal(calcMA(closes, 5), 22.8) // (2+3+4+5+100)/5
  })
})
