import assert from 'node:assert/strict'
import test from 'node:test'
import { marketStatus } from '../src/market-status.js'

test('only fresh A-share trading-session timestamps can trigger alerts', () => {
  const now = new Date('2026-10-26T02:00:00Z') // Monday 10:00 Asia/Shanghai
  assert.deepEqual(marketStatus('2026-10-26 09:58:00', now), {
    phase: 'trading', fresh: true, label: '交易中', quoteTime: '2026-10-26 09:58:00',
  })
  assert.equal(marketStatus('2026-10-26 09:54:00', now).fresh, false)
  assert.equal(marketStatus('2026-10-25 14:59:00', now).fresh, false)
  assert.equal(marketStatus('2026-10-26 10:01:00', now).fresh, false)
  assert.equal(marketStatus('', now).phase, 'unknown')
  assert.equal(marketStatus('2026-02-31 10:00:00', now).phase, 'unknown')
  assert.equal(marketStatus('2026-10-26 10:00:01', now).phase, 'stale')
  assert.equal(marketStatus('2026-10-26 09:55:00', now).fresh, true) // inclusive five-minute boundary
})

test('lunch, closing and weekends explicitly stop alerts even with a recent quote', () => {
  assert.equal(marketStatus('2026-10-26 11:30:00', new Date('2026-10-26T03:31:00Z')).phase, 'lunch')
  assert.equal(marketStatus('2026-10-26 15:00:00', new Date('2026-10-26T07:01:00Z')).phase, 'closed')
  assert.equal(marketStatus('2026-10-24 10:00:00', new Date('2026-10-24T02:01:00Z')).phase, 'closed')
})
