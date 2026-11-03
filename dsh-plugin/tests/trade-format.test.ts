import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatVolumeHands, formatYuanAmount } from '../src/trade-format.js'

test('formatVolumeHands renders 万手 above 10k and bare hands below', () => {
  // Real-world value: 国际复材 2026-11-02 全天约 124 万手
  assert.equal(formatVolumeHands(1239851), '123.99 万手')
  assert.equal(formatVolumeHands(1e4), '1.00 万手')
  assert.equal(formatVolumeHands(8888), '8,888 手')
  assert.equal(formatVolumeHands(500), '500 手')
})

test('formatVolumeHands returns -- for missing or invalid input', () => {
  assert.equal(formatVolumeHands(0), '--')
  assert.equal(formatVolumeHands(-1), '--')
  assert.equal(formatVolumeHands(NaN), '--')
  assert.equal(formatVolumeHands(Infinity), '--')
})

test('formatYuanAmount renders 亿/万/元 tiers', () => {
  // Real-world value: 国际复材 2026-11-02 成交额 24.4 亿元
  assert.equal(formatYuanAmount(244014e4), '24.40 亿')
  assert.equal(formatYuanAmount(1e8), '1.00 亿')
  assert.equal(formatYuanAmount(3256e4), '3,256.00 万')
  assert.equal(formatYuanAmount(888), '888 元')
})

test('formatYuanAmount returns -- for missing or invalid input', () => {
  assert.equal(formatYuanAmount(0), '--')
  assert.equal(formatYuanAmount(-5), '--')
  assert.equal(formatYuanAmount(NaN), '--')
})
