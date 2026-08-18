import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createStateStore } from '../src/state.js'
import {
  handleApiRequest,
  isTrustedApiRequest,
  type ApiDeps,
} from '../src/api.js'

function mockReq(body: unknown, method = 'POST'): IncomingMessage {
  const payload = JSON.stringify(body)
  let sent = false
  return {
    method,
    url: '/leek-fund/api/x',
    headers: { host: '127.0.0.1:3080' },
    [Symbol.asyncIterator]: async function* () {
      if (!sent) {
        sent = true
        yield Buffer.from(payload)
      }
    },
  } as unknown as IncomingMessage
}

function mockRes(): { res: ServerResponse; status: () => number; json: () => Record<string, unknown> } {
  const captured = { status: 0, body: '' }
  return {
    res: {
      writeHead(status: number) {
        captured.status = status
      },
      end(body?: string | Uint8Array) {
        captured.body = String(body ?? '')
      },
    } as unknown as ServerResponse,
    status: () => captured.status,
    json: () => JSON.parse(captured.body) as Record<string, unknown>,
  }
}

async function withStore<T>(fn: (deps: ApiDeps) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'leek-api-'))
  try {
    const store = createStateStore(join(dir, 'state.json'))
    return await fn({ store, timeoutMs: 8000 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('isTrustedApiRequest', () => {
  it('accepts loopback hosts', () => {
    const req = { headers: { host: '127.0.0.1:3080' } } as IncomingMessage
    assert.equal(isTrustedApiRequest(req), true)
    const local = { headers: { host: 'localhost' } } as IncomingMessage
    assert.equal(isTrustedApiRequest(local), true)
  })

  it('rejects foreign hosts', () => {
    const req = { headers: { host: 'evil.example.com' } } as IncomingMessage
    assert.equal(isTrustedApiRequest(req), false)
  })
})

describe('mutate endpoint', () => {
  it('adds a stock and returns ok', () =>
    withStore(async (deps) => {
      const { res, status, json } = mockRes()
      await handleApiRequest(deps, mockReq({ op: 'add', args: { code: 'sh600000' } }), res, '/leek-fund/api/mutate')
      assert.equal(status(), 200)
      assert.deepEqual(json(), { ok: true })
      const state = await deps.store.load()
      assert.ok(state.stocks.includes('sh600000'))
    }))

  it('returns ok:false with a message on failure', () =>
    withStore(async (deps) => {
      const { res, status, json } = mockRes()
      await handleApiRequest(deps, mockReq({ op: 'add', args: { code: 'bogus' } }), res, '/leek-fund/api/mutate')
      assert.equal(status(), 200)
      const body = json()
      assert.equal(body.ok, false)
      assert.ok(typeof body.error === 'string' && body.error.length > 0)
    }))

  it('rejects an unknown op', () =>
    withStore(async (deps) => {
      const { res, status, json } = mockRes()
      await handleApiRequest(deps, mockReq({ op: 'nope', args: {} }), res, '/leek-fund/api/mutate')
      assert.equal(status(), 200)
      assert.equal(json().ok, false)
    }))

  it('groupCreate returns the new group id', () =>
    withStore(async (deps) => {
      const { res, json } = mockRes()
      await handleApiRequest(deps, mockReq({ op: 'groupCreate', args: { name: '光通信', category: 'A' } }), res, '/leek-fund/api/mutate')
      const body = json()
      assert.equal(body.ok, true)
      assert.ok(typeof (body.data as { id?: string }).id === 'string')
      const group = (await deps.store.load()).groups[0]
      assert.equal((body.data as { id: string }).id, group.id)
    }))

  it('creates, renames, moves and deletes a group', () =>
    withStore(async (deps) => {
      const add = mockRes()
      await handleApiRequest(deps, mockReq({ op: 'add', args: { code: 'sh600000' } }), add.res, '/leek-fund/api/mutate')

      const create = mockRes()
      await handleApiRequest(deps, mockReq({ op: 'groupCreate', args: { name: '银行', category: 'A' } }), create.res, '/leek-fund/api/mutate')
      assert.equal(create.json().ok, true)
      const group = (await deps.store.load()).groups[0]

      const move = mockRes()
      await handleApiRequest(deps, mockReq({ op: 'groupMove', args: { code: 'sh600000', groupId: group.id } }), move.res, '/leek-fund/api/mutate')
      assert.equal(move.json().ok, true)
      assert.deepEqual((await deps.store.load()).groups[0].stockCodes, ['sh600000'])

      const rename = mockRes()
      await handleApiRequest(deps, mockReq({ op: 'groupRename', args: { id: group.id, name: '银行新' } }), rename.res, '/leek-fund/api/mutate')
      assert.equal(rename.json().ok, true)
      assert.equal((await deps.store.load()).groups[0].name, '银行新')

      const del = mockRes()
      await handleApiRequest(deps, mockReq({ op: 'groupDelete', args: { id: group.id } }), del.res, '/leek-fund/api/mutate')
      assert.equal(del.json().ok, true)
      assert.equal((await deps.store.load()).groups.length, 0)
      assert.ok((await deps.store.load()).stocks.includes('sh600000'))
    }))

  it('toggles holding mark and status bar', () =>
    withStore(async (deps) => {
      await handleApiRequest(deps, mockReq({ op: 'add', args: { code: 'sh600000' } }), mockRes().res, '/leek-fund/api/mutate')
      const mark = mockRes()
      await handleApiRequest(deps, mockReq({ op: 'mark', args: { code: 'sh600000', mark: 'holding', value: true } }), mark.res, '/leek-fund/api/mutate')
      assert.equal(mark.json().ok, true)
      assert.deepEqual((await deps.store.load()).holdingCodes, ['sh600000'])

      const focus = mockRes()
      await handleApiRequest(deps, mockReq({ op: 'mark', args: { code: 'sh600000', mark: 'focus', value: true } }), focus.res, '/leek-fund/api/mutate')
      assert.equal(focus.json().ok, true)
      assert.deepEqual((await deps.store.load()).focusCodes, ['sh600000'])

      const ticker = mockRes()
      await handleApiRequest(deps, mockReq({ op: 'statusBar', args: { code: 'sh600000', value: true } }), ticker.res, '/leek-fund/api/mutate')
      assert.equal(ticker.json().ok, true)
      assert.deepEqual((await deps.store.load()).statusBarStockCodes, ['sh600000'])
    }))
})

describe('reorder endpoint', () => {
  it('reorders a stock within a group', () =>
    withStore(async (deps) => {
      await handleApiRequest(deps, mockReq({ op: 'add', args: { code: 'sh600000' } }), mockRes().res, '/leek-fund/api/mutate')
      await handleApiRequest(deps, mockReq({ op: 'add', args: { code: 'sh600001' } }), mockRes().res, '/leek-fund/api/mutate')
      await handleApiRequest(deps, mockReq({ op: 'groupCreate', args: { name: '银行' } }), mockRes().res, '/leek-fund/api/mutate')
      const group = (await deps.store.load()).groups[0]
      for (const code of ['sh600000', 'sh600001']) {
        await handleApiRequest(deps, mockReq({ op: 'groupMove', args: { code, groupId: group.id } }), mockRes().res, '/leek-fund/api/mutate')
      }
      const { res, json } = mockRes()
      await handleApiRequest(
        deps,
        mockReq({ kind: 'stock', args: { code: 'sh600001', targetGroupId: group.id, beforeCode: 'sh600000' } }),
        res,
        '/leek-fund/api/reorder'
      )
      assert.equal(json().ok, true)
      assert.deepEqual((await deps.store.load()).groups[0].stockCodes, ['sh600001', 'sh600000'])
    }))

  it('rejects a cross-market stock reorder', () =>
    withStore(async (deps) => {
      await handleApiRequest(deps, mockReq({ op: 'add', args: { code: 'hk00700' } }), mockRes().res, '/leek-fund/api/mutate')
      await handleApiRequest(deps, mockReq({ op: 'groupCreate', args: { name: 'A股组' } }), mockRes().res, '/leek-fund/api/mutate')
      const group = (await deps.store.load()).groups[0]
      const { res, json } = mockRes()
      await handleApiRequest(
        deps,
        mockReq({ kind: 'stock', args: { code: 'hk00700', targetGroupId: group.id } }),
        res,
        '/leek-fund/api/reorder'
      )
      assert.equal(json().ok, false)
    }))
})

describe('route validation', () => {
  it('405 for non-POST', () =>
    withStore(async (deps) => {
      const { res, status } = mockRes()
      await handleApiRequest(deps, mockReq({}, 'GET'), res, '/leek-fund/api/mutate')
      assert.equal(status(), 405)
    }))

  it('404 for unknown method', () =>
    withStore(async (deps) => {
      const { res, status } = mockRes()
      await handleApiRequest(deps, mockReq({}), res, '/leek-fund/api/nope')
      assert.equal(status(), 404)
    }))

  it('400 for invalid JSON', () =>
    withStore(async (deps) => {
      let sent = false
      const req = {
        method: 'POST',
        url: '/leek-fund/api/mutate',
        headers: { host: '127.0.0.1' },
        [Symbol.asyncIterator]: async function* () {
          if (!sent) {
            sent = true
            yield Buffer.from('not json')
          }
        },
      } as unknown as IncomingMessage
      const { res, status } = mockRes()
      await handleApiRequest(deps, req, res, '/leek-fund/api/mutate')
      assert.equal(status(), 400)
    }))
})
