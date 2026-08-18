import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addStock,
  categoryOf,
  createGroup,
  createStateStore,
  defaultState,
  deleteGroup,
  moveStockToGroup,
  normalizeCode,
  normalizeState,
  removeStock,
  renameGroup,
  setMark,
} from '../src/state.js'

describe('normalizeCode', () => {
  it('lowercases and canonicalizes', () => {
    assert.equal(normalizeCode('SH600000'), 'sh600000')
    assert.equal(normalizeCode('sh600000'), 'sh600000')
    assert.equal(normalizeCode(' HK00700 '), 'hk00700')
    assert.equal(normalizeCode('USR_AAPL'), 'usr_aapl')
  })

  it('rejects invalid codes', () => {
    assert.equal(normalizeCode(''), '')
    assert.equal(normalizeCode('abc'), '')
    assert.equal(normalizeCode('sh60000'), '')
    assert.equal(normalizeCode('hk1234'), '')
  })
})

describe('categoryOf', () => {
  it('maps markets', () => {
    assert.equal(categoryOf('sh600000'), 'A')
    assert.equal(categoryOf('sz000001'), 'A')
    assert.equal(categoryOf('bj430047'), 'A')
    assert.equal(categoryOf('hk00700'), 'HK')
    assert.equal(categoryOf('usr_aapl'), 'US')
    assert.equal(categoryOf('gb_aapl'), 'US')
    assert.equal(categoryOf('xxx'), undefined)
  })
})

describe('normalizeState', () => {
  it('dedupes stocks and drops invalid codes', () => {
    const state = normalizeState({
      stocks: ['sh600000', 'SH600000', 'bad', 'hk00700'],
      holding_codes: ['sh600000', 'not-a-stock'],
    })
    assert.deepEqual(state.stocks, ['sh600000', 'hk00700'])
    assert.deepEqual(state.holdingCodes, ['sh600000'])
  })

  it('surfaces ungroupped A-share orphans into the watch list', () => {
    const state = normalizeState({ stocks: ['sh600000', 'hk00700', 'usr_aapl'] })
    assert.deepEqual(state.watchCodes, ['sh600000'])
  })

  it('round-trips the camelCase in-memory shape', () => {
    const state = normalizeState({
      stocks: ['sh600000'],
      groups: [{ id: 'g1', name: '银行', category: 'A', stockCodes: ['sh600000'] }],
      holdingCodes: ['sh600000'],
    })
    assert.deepEqual(state.groups[0].stockCodes, ['sh600000'])
    assert.deepEqual(state.holdingCodes, ['sh600000'])
  })

  it('drops group codes that are not in the watchlist or mismatch the market', () => {
    const state = normalizeState({
      stocks: ['sh600000'],
      groups: [
        { id: 'g1', name: '银行', category: 'A', stock_codes: ['sh600000', 'hk00700'] },
        { id: 'g2', name: '非法', category: 'A', stock_codes: ['usr_aapl'] },
      ],
    })
    assert.equal(state.groups.length, 2)
    assert.deepEqual(state.groups[0].stockCodes, ['sh600000'])
    assert.deepEqual(state.groups[1].stockCodes, [])
  })
})

describe('group mutations', () => {
  it('creates a top-level group', () => {
    const state = normalizeState({ stocks: ["sh600000", "hk00700", "usr_aapl"] })
    const result = createGroup(state, ' 光通信 ', 'A')
    assert.equal(result.ok, true)
    assert.equal(state.groups[0].name, '光通信')
    assert.equal(state.groups[0].category, 'A')
  })

  it('creates a second-level group under a top-level parent', () => {
    const state = normalizeState({ stocks: ["sh600000", "hk00700", "usr_aapl"] })
    createGroup(state, '光通信', 'A')
    const parent = state.groups[0]
    const result = createGroup(state, 'CPO', 'A', parent.id)
    assert.equal(result.ok, true)
    assert.equal(state.groups[1].parentId, parent.id)
  })

  it('rejects a third level and cross-market children', () => {
    const state = normalizeState({ stocks: ["sh600000", "hk00700", "usr_aapl"] })
    createGroup(state, '光通信', 'A')
    createGroup(state, 'CPO', 'A', state.groups[0].id)
    const nested = createGroup(state, '子子', 'A', state.groups[1].id)
    assert.equal(nested.ok, false)

    const state2 = normalizeState({ stocks: ["sh600000", "hk00700", "usr_aapl"] })
    createGroup(state2, '港股组', 'HK')
    const cross = createGroup(state2, 'A股子组', 'A', state2.groups[0].id)
    assert.equal(cross.ok, false)
  })

  it('rejects duplicate sibling names', () => {
    const state = normalizeState({ stocks: ["sh600000", "hk00700", "usr_aapl"] })
    createGroup(state, '同名', 'A')
    const dup = createGroup(state, '同名', 'A')
    assert.equal(dup.ok, false)
  })

  it('renames a group', () => {
    const state = normalizeState({ stocks: ["sh600000", "hk00700", "usr_aapl"] })
    createGroup(state, '旧名', 'A')
    const result = renameGroup(state, state.groups[0].id, '新名')
    assert.equal(result.ok, true)
    assert.equal(state.groups[0].name, '新名')
  })

  it('deletes a group and its children but keeps stocks', () => {
    const state = normalizeState({ stocks: ["sh600000", "hk00700", "usr_aapl"] })
    createGroup(state, '父', 'A')
    const parent = state.groups[0]
    createGroup(state, '子', 'A', parent.id)
    addStock(state, 'sh600000', parent.id)
    const result = deleteGroup(state, parent.id)
    assert.equal(result.ok, true)
    assert.equal(state.groups.length, 0)
    assert.ok(state.stocks.includes('sh600000'))
  })

  it('moves a stock between groups and back to ungroupped', () => {
    const state = normalizeState({ stocks: ["sh600000", "hk00700", "usr_aapl"] })
    addStock(state, 'sh600000')
    createGroup(state, '银行', 'A')
    const group = state.groups[0]

    const moved = moveStockToGroup(state, 'sh600000', group.id)
    assert.equal(moved.ok, true)
    assert.deepEqual(group.stockCodes, ['sh600000'])

    const ungroupped = moveStockToGroup(state, 'sh600000')
    assert.equal(ungroupped.ok, true)
    assert.deepEqual(group.stockCodes, [])
  })

  it('rejects moving a stock into a different-market group', () => {
    const state = normalizeState({ stocks: ["sh600000", "hk00700", "usr_aapl"] })
    addStock(state, 'hk00700')
    createGroup(state, 'A股组', 'A')
    const result = moveStockToGroup(state, 'hk00700', state.groups[0].id)
    assert.equal(result.ok, false)
  })
})

describe('marks and watchlist mutations', () => {
  it('sets and clears holding/watch/focus marks', () => {
    const state = normalizeState({ stocks: ["sh600000", "hk00700", "usr_aapl"] })
    addStock(state, 'sh600000')
    setMark(state, 'sh600000', 'holding', true)
    assert.deepEqual(state.holdingCodes, ['sh600000'])
    setMark(state, 'sh600000', 'holding', false)
    assert.deepEqual(state.holdingCodes, [])
    setMark(state, 'sh600000', 'watch', true)
    assert.deepEqual(state.watchCodes, ['sh600000'])
    setMark(state, 'sh600000', 'focus', true)
    assert.deepEqual(state.focusCodes, ['sh600000'])
    setMark(state, 'sh600000', 'focus', false)
    assert.deepEqual(state.focusCodes, [])
  })

  it('rejects marking a stock outside the watchlist', () => {
    const state = normalizeState({ stocks: ["sh600000", "hk00700", "usr_aapl"] })
    const result = setMark(state, 'sz000001', 'holding', true)
    assert.equal(result.ok, false)
  })

  it('adds a stock to the watchlist (idempotent)', () => {
    const state = normalizeState({ stocks: ["sh600000", "hk00700", "usr_aapl"] })
    addStock(state, 'sh600000')
    const again = addStock(state, 'sh600000')
    assert.equal(again.ok, true)
    assert.equal(state.stocks.filter((code) => code === 'sh600000').length, 1)
  })

  it('removes a stock from watchlist, groups and marks', () => {
    const state = normalizeState({ stocks: ["sh600000", "hk00700", "usr_aapl"] })
    addStock(state, 'sh600000')
    createGroup(state, '银行', 'A')
    moveStockToGroup(state, 'sh600000', state.groups[0].id)
    setMark(state, 'sh600000', 'watch', true)
    setMark(state, 'sh600000', 'focus', true)
    const result = removeStock(state, 'sh600000')
    assert.equal(result.ok, true)
    assert.ok(!state.stocks.includes('sh600000'))
    assert.deepEqual(state.groups[0].stockCodes, [])
    assert.deepEqual(state.watchCodes, [])
    assert.deepEqual(state.focusCodes, [])
  })
})

describe('state store persistence', () => {
  it('saves and reloads state atomically', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'leek-fund-test-'))
    try {
      const path = join(dir, 'state.json')
      const store = createStateStore(path)
      const saved = await store.mutate((state) => addStock(state, 'sh600000'))
      assert.ok(saved.stocks.includes('sh600000'))
      assert.equal(store.path, path)

      const loaded = await store.load()
      assert.ok(loaded.stocks.includes('sh600000'))
      assert.equal(loaded.schemaVersion, 2)

      // No leftover temp files after an atomic write.
      const entries = await readFile(path, 'utf8')
      assert.ok(entries.includes('sh600000'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to defaults for a missing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'leek-fund-test-'))
    try {
      const store = createStateStore(join(dir, 'nope', 'state.json'))
      const state = await store.load()
      assert.deepEqual(state.stocks, defaultState().stocks)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
