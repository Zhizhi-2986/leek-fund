import { it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createStateStore } from '../src/state.js'
import { createAlertStore, checkAlerts } from '../src/alerts.js'
import { handleApiRequest, type ApiDeps } from '../src/api.js'

it('creates, reads, atomically claims and deletes alerts via host API', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'alert-api-'))
  try {
    const alerts = createAlertStore(join(dir, 'alerts.json'))
    const deps: ApiDeps = { store: createStateStore(join(dir, 'state.json')), alerts, timeoutMs: 8000 }
    async function call(route: string, body: unknown) {
      let status = 0
      let response = ''
      const req = { method: 'POST', headers: { host: '127.0.0.1' },
        async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)) } } as unknown as IncomingMessage
      const res = { writeHead(code: number) { status = code }, end(value: string) { response = value } } as unknown as ServerResponse
      await handleApiRequest(deps, req, res, `/leek-fund/api/${route}`)
      return { status, body: JSON.parse(response) as Record<string, any> }
    }
    assert.equal((await call('alertCreate', { code: 'bad', kind: 'price', direction: 'above', threshold: 1 })).status, 400)
    assert.equal((await call('alertCreate', { code: 'sh600000', kind: 'price', direction: 'above', threshold: 11 })).status, 400)
    await call('mutate', { op: 'add', args: { code: 'sh600000' } })
    const created = await call('alertCreate', { code: 'sh600000', kind: 'price', direction: 'above', threshold: 11 })
    assert.equal(created.status, 200)
    const id = created.body.rule.id as string
    assert.equal((await call('alertRules', {})).body.rules.length, 1)
    await checkAlerts(alerts, new Map([['sh600000', { code: 'sh600000', name: '浦发', price: 12, percent: 2,
      yestclose: 11, updown: 1, open: 11, high: 12, low: 11, available: true, time: '2026-10-26 10:35:00' }]]), new Date('2026-10-26T02:35:00Z'))
    assert.equal((await call('alertEvents', {})).body.events.length, 1)
    const [left, right] = await Promise.all([call('alertClaim', { limit: 10 }), call('alertClaim', { limit: 10 })])
    assert.equal(left.body.events.length + right.body.events.length, 1)
    assert.equal((await call('alertDelete', { id })).body.ok, true)
    assert.equal((await call('alertRules', {})).body.rules.length, 0)
    assert.equal((await call('alertEvents', {})).body.events.length, 1)
    await call('alertCreate', { code: 'sh600000', kind: 'percent', direction: 'below', threshold: -2 })
    assert.equal((await call('mutate', { op: 'remove', args: { code: 'sh600000' } })).body.ok, true)
    assert.equal((await call('alertRules', {})).body.rules.length, 0)
    assert.equal((await call('alertEvents', {})).body.events.length, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
