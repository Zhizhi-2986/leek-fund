import assert from 'node:assert/strict'
import test from 'node:test'
import { createNotificationMonitor } from '../src/client/notification.js'
import type { AlertEvent } from '../src/client/api.js'

const EVENT_TIME = Date.parse('2026-10-26T02:02:00.000Z')
const event: AlertEvent = {
  id: 'e1', ruleId: 'r1', code: 'sh600000', price: 12.5,
  percent: 2.1, kind: 'price', direction: 'above', threshold: 12,
  quoteTime: '2026-10-26 10:01:00', triggeredAt: '2026-10-26T02:01:00.000Z',
}

test('does not claim pending alerts without explicit notification permission', async () => {
  let permission: NotificationPermission = 'default'
  let claims = 0
  let requests = 0
  const monitor = createNotificationMonitor({
    permission: () => permission,
    requestPermission: async () => { requests++; permission = 'granted'; return permission },
    now: () => EVENT_TIME,
    claim: async () => { claims++; return [event] },
    notify: () => {},
  })
  await monitor.poll()
  assert.equal(claims, 0)
  assert.equal(requests, 0)
  await monitor.enable()
  await monitor.poll()
  assert.equal(requests, 1)
  assert.equal(claims, 2) // enable immediately checks, then the next scheduled poll checks again
})

test('denied and unsupported permissions preserve pending alerts', async () => {
  let claims = 0
  const denied = createNotificationMonitor({
    permission: () => 'denied', requestPermission: async () => 'denied',
    now: () => EVENT_TIME,
    claim: async () => { claims++; return [] }, notify: () => {},
  })
  await denied.enable()
  await denied.poll()
  const unsupported = createNotificationMonitor({
    permission: () => 'unsupported', requestPermission: async () => 'unsupported',
    now: () => EVENT_TIME,
    claim: async () => { claims++; return [] }, notify: () => {},
  })
  await unsupported.poll()
  assert.equal(claims, 0)
  assert.match(denied.getStatus().message ?? '', /拒绝/)
  assert.match(unsupported.getStatus().message ?? '', /不支持/)
})

test('shows a visible failure after a claimed event cannot be displayed', async () => {
  const monitor = createNotificationMonitor({
    permission: () => 'granted', requestPermission: async () => 'granted',
    now: () => EVENT_TIME,
    claim: async () => [event], notify: () => { throw new Error('system blocked') },
  })
  await monitor.poll()
  assert.match(monitor.getStatus().message ?? '', /桌面通知发送失败/)
  assert.match(monitor.getStatus().message ?? '', /sh600000/)
})

test('continues sending the rest of a claimed batch after native notification fails', async () => {
  const sent: string[] = []
  const monitor = createNotificationMonitor({
    permission: () => 'granted', requestPermission: async () => 'granted',
    now: () => EVENT_TIME,
    claim: async () => [event, { ...event, id: 'e2', code: 'sz000001' }],
    notify: (item) => { sent.push(item.code); if (item.id === 'e1') throw new Error('blocked') },
  })
  await monitor.poll()
  assert.deepEqual(sent, ['sh600000', 'sz000001'])
  assert.match(monitor.getStatus().message ?? '', /sh600000/)
})

test('claims old and malformed events without spamming notifications after reopening', async () => {
  const sent: string[] = []
  const monitor = createNotificationMonitor({
    permission: () => 'granted', requestPermission: async () => 'granted',
    now: () => EVENT_TIME,
    claim: async () => [
      { ...event, id: 'old', triggeredAt: '2026-10-25T02:01:00.000Z' },
      { ...event, id: 'bad', triggeredAt: 'not a timestamp' },
      { ...event, id: 'future', triggeredAt: '2026-10-26T03:01:00.000Z' },
      event,
    ],
    notify: (item) => { sent.push(item.id) },
  })
  await monitor.poll()
  assert.deepEqual(sent, ['e1'])
})

test('starts once, polls outside the tab, and stops on plugin disposal', async () => {
  let tick: (() => void) | undefined
  const handle = {} as ReturnType<typeof setInterval>
  let claims = 0
  let clears = 0
  const monitor = createNotificationMonitor({
    permission: () => 'granted', requestPermission: async () => 'granted',
    now: () => EVENT_TIME,
    claim: async () => { claims++; return [] }, notify: () => {},
    setInterval: (callback) => { tick = callback; return handle },
    clearInterval: () => { clears++ },
  })
  const dispose = monitor.start()
  monitor.start()
  await monitor.poll()
  tick?.()
  await monitor.poll()
  assert.equal(claims, 2)
  dispose()
  assert.equal(clears, 1)
})
