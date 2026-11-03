import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAlertStore, eligibleQuote, checkAlerts, startAlertMonitor, type AlertStore } from '../src/alerts.js'
import type { Quote } from '../src/types.js'

const now = new Date('2026-10-26T02:35:00Z') // Monday 10:35 China time
const quote = (time: string, price = 12, percent = 2): Quote => ({
  code: 'sh600000', name: '浦发银行', price, percent, time, available: true,
  yestclose: 11, open: 11, high: 12, low: 11, updown: 1,
})

async function withAlerts(fn: (store: AlertStore, path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'leek-alerts-'))
  try {
    const path = join(dir, 'alerts.json')
    await fn(createAlertStore(path), path)
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}

describe('quote eligibility', () => {
  it('accepts a valid weekday China-time quote at the five-minute boundary', () => {
    assert.equal(eligibleQuote(quote('2026-10-26 10:30:00'), now), true)
  })
  it('rejects no time, stale, future, invalid and unavailable quotes', () => {
    for (const time of ['', '2026-10-26 10:29:59', '2026-10-26 10:35:01', '2026-02-30 10:35:00']) {
      assert.equal(eligibleQuote(quote(time), now), false, time)
    }
    assert.equal(eligibleQuote({ ...quote('2026-10-26 10:35:00'), available: false }, now), false)
  })
  it('rejects weekends, midday, and outside regular morning/afternoon sessions', () => {
    for (const time of ['2026-10-24 10:35:00', '2026-10-26 11:30:01', '2026-10-26 12:59:59', '2026-10-26 15:00:01', '2026-10-26 09:29:59']) {
      const instant = new Date(`${time.replace(' ', 'T')}+08:00`)
      assert.equal(eligibleQuote(quote(time), instant), false, time)
    }
    assert.equal(eligibleQuote(quote('2026-10-26 11:30:00'), new Date('2026-10-26T03:30:00Z')), true)
    assert.equal(eligibleQuote(quote('2026-10-26 13:00:00'), new Date('2026-10-26T05:00:00Z')), true)
    assert.equal(eligibleQuote(quote('2026-10-26 11:29:00'), new Date('2026-10-26T04:00:00Z')), false)
  })
})

describe('durable alert rules and events', () => {
  it('validates rules and preserves events after restart/deleting rule', () => withAlerts(async (store, path) => {
    await assert.rejects(store.createRule({ code: 'bad', kind: 'price', direction: 'above', threshold: 12 }))
    await assert.rejects(store.createRule({ code: 'sh600000', kind: 'price', direction: 'above', threshold: 0 }))
    await assert.rejects(store.createRule({ code: 'sh600000', kind: 'percent', direction: 'above', threshold: 101 }))
    const rule = await store.createRule({ code: 'sh600000', kind: 'price', direction: 'above', threshold: 12 })
    assert.equal(rule.enabled, true)
    assert.equal((await createAlertStore(path).listRules()).length, 1)
    const events = await checkAlerts(store, new Map([['sh600000', quote('2026-10-26 10:35:00')]]), now)
    assert.equal(events.length, 1)
    assert.equal(events[0].ruleId, rule.id)
    assert.equal(events[0].quoteTime, '2026-10-26 10:35:00')
    assert.equal(events[0].kind, 'price')
    assert.equal(events[0].direction, 'above')
    assert.equal(events[0].threshold, 12)
    assert.equal(await store.deleteRule(rule.id), true)
    assert.equal((await createAlertStore(path).listEvents()).length, 1)
    assert.equal(await store.deleteRule(rule.id), false)
  }))
  it('does not trigger stale quotes or repeat a rule on its China trading date after restart', () => withAlerts(async (store, path) => {
    await store.createRule({ code: 'sh600000', kind: 'percent', direction: 'below', threshold: -2 })
    const valid = quote('2026-10-26 10:35:00', 9, -3)
    assert.equal((await checkAlerts(store, new Map([['sh600000', quote('2026-10-26 10:29:59', 9, -3)]]), now)).length, 0)
    assert.equal((await checkAlerts(store, new Map([['sh600000', valid]]), now)).length, 1)
    assert.equal((await checkAlerts(createAlertStore(path), new Map([['sh600000', valid]]), now)).length, 0)
    assert.equal((await createAlertStore(path).listEvents()).length, 1)
  }))
  it('uses one host poll without a client and stops cleanly', () => withAlerts(async (store) => {
    await store.createRule({ code: 'sh600000', kind: 'price', direction: 'above', threshold: 11 })
    let fetches = 0
    const failures: unknown[] = []
    let resolve!: () => void
    const seen = new Promise<void>((done) => { resolve = done })
    const stop = startAlertMonitor(store, 8000, (error) => failures.push(error), 30,
      async (codes) => {
        assert.deepEqual(codes, ['sh600000'])
        fetches++
        resolve()
        return new Map([['sh600000', quote('2026-10-26 10:35:00')]])
      }, () => now)
    try {
      await seen
      await new Promise((done) => setTimeout(done, 80))
      assert.equal((await store.listEvents()).length, 1)
      assert.deepEqual(failures, [])
    } finally { stop() }
    const before = fetches
    await new Promise((done) => setTimeout(done, 80))
    assert.equal(fetches, before)
  }))
  it('atomically gives events to only one competing window, including across store instances', () => withAlerts(async (store, path) => {
    await store.createRule({ code: 'sh600000', kind: 'price', direction: 'above', threshold: 11 })
    await checkAlerts(store, new Map([['sh600000', quote('2026-10-26 10:35:00')]]), now)
    const claimed = await Promise.all([store.claimEvents(10), createAlertStore(path).claimEvents(10)])
    assert.equal(claimed.flat().length, 1)
    assert.deepEqual(await createAlertStore(path).claimEvents(10), [])
    assert.equal((await store.listEvents()).length, 1)
  }))
})
