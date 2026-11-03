import { it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAlertStore } from '../src/alerts.js'
import { createStateStore } from '../src/state.js'
import { defineTools } from '../src/tools.js'

it('model focus mark and explicit alert CRUD tools update durable host state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'alert-tools-'))
  try {
    const store = createStateStore(join(dir, 'state.json'))
    const alerts = createAlertStore(join(dir, 'alerts.json'))
    const tools = defineTools({ store, alerts, timeoutMs: 8000 })
    const tool = (name: string) => {
      const found = tools.find((entry) => entry.name === name)
      assert.ok(found, `missing tool ${name}`)
      return found as unknown as { execute: (args: Record<string, unknown>) => Promise<Record<string, any>> }
    }
    const focus = await tool('stock_mark').execute({ code: 'sh000001', mark: 'focus', value: true })
    assert.equal(focus.ok, true)
    assert.deepEqual((await store.load()).focusCodes, ['sh000001'])
    const rejected = await tool('stock_alert_create').execute({ code: 'sh600000', kind: 'price', direction: 'above', threshold: 12 })
    assert.equal(rejected.ok, false)
    const created = await tool('stock_alert_create').execute({ code: 'sh000001', kind: 'price', direction: 'above', threshold: 4000 })
    assert.equal(created.ok, true)
    assert.equal((await tool('stock_alert_list').execute({})).rules.length, 1)
    assert.equal((await tool('stock_alert_delete').execute({ id: created.rule.id })).ok, true)
    assert.equal((await alerts.listRules()).length, 0)
    await tool('stock_alert_create').execute({ code: 'sh000001', kind: 'price', direction: 'below', threshold: 3000 })
    assert.equal((await tool('stock_remove').execute({ code: 'sh000001' })).ok, true)
    assert.equal((await alerts.listRules()).length, 0)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
