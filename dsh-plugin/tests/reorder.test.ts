import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  addStock,
  createGroup,
  normalizeState,
  reorderGroup,
  reorderMark,
  reorderStock,
  setMark,
} from '../src/state.js'

function baseState() {
  return normalizeState({ stocks: ['sh600000', 'sh600001', 'sh600002', 'hk00700'] })
}

describe('reorderStock', () => {
  it('reorders within a group', () => {
    const state = baseState()
    addStock(state, 'sh600000')
    addStock(state, 'sh600001')
    createGroup(state, '银行', 'A')
    const group = state.groups[0]
    group.stockCodes = ['sh600000', 'sh600001']

    const result = reorderStock(state, 'sh600001', group.id, 'sh600000')
    assert.equal(result.ok, true)
    assert.deepEqual(group.stockCodes, ['sh600001', 'sh600000'])
  })

  it('appends when no anchor is given', () => {
    const state = baseState()
    addStock(state, 'sh600000')
    addStock(state, 'sh600001')
    createGroup(state, '银行', 'A')
    const group = state.groups[0]
    group.stockCodes = ['sh600000']

    const result = reorderStock(state, 'sh600000', group.id)
    assert.equal(result.ok, true)
    assert.deepEqual(group.stockCodes, ['sh600000'])
  })

  it('moves a stock across groups', () => {
    const state = baseState()
    addStock(state, 'sh600000')
    createGroup(state, '银行', 'A')
    createGroup(state, '券商', 'A')
    const [bank, broker] = state.groups
    bank.stockCodes = ['sh600000']

    const result = reorderStock(state, 'sh600000', broker.id)
    assert.equal(result.ok, true)
    assert.deepEqual(bank.stockCodes, [])
    assert.deepEqual(broker.stockCodes, ['sh600000'])
  })

  it('reorders within the ungroupped bucket', () => {
    const state = baseState()
    addStock(state, 'sh600000')
    addStock(state, 'sh600001')
    // Watchlist order: ... sh600000, sh600001 (ungroupped)
    const result = reorderStock(state, 'sh600001', undefined, 'sh600000')
    assert.equal(result.ok, true)
    assert.deepEqual(state.stocks.slice(0, 2), ['sh600001', 'sh600000'])
  })

  it('rejects a cross-market target group', () => {
    const state = baseState()
    addStock(state, 'sh600000')
    createGroup(state, '港股组', 'HK')
    const result = reorderStock(state, 'sh600000', state.groups[0].id)
    assert.equal(result.ok, false)
  })

  it('rejects a stock outside the watchlist', () => {
    const state = baseState()
    const result = reorderStock(state, 'sz000001')
    assert.equal(result.ok, false)
  })

  it('rejects an anchor outside the target scope', () => {
    const state = baseState()
    addStock(state, 'sh600000')
    createGroup(state, '银行', 'A')
    const result = reorderStock(state, 'sh600000', state.groups[0].id, 'hk00700')
    assert.equal(result.ok, false)
  })
})

describe('reorderGroup', () => {
  it('reorders sibling groups', () => {
    const state = baseState()
    createGroup(state, '组A', 'A')
    createGroup(state, '组B', 'A')
    createGroup(state, '组C', 'A')
    const [a, b] = state.groups

    const result = reorderGroup(state, b.id, a.id)
    assert.equal(result.ok, true)
    assert.deepEqual(
      state.groups.filter((g) => !g.parentId).map((g) => g.id),
      [b.id, a.id, state.groups.find((g) => g.name === '组C')!.id]
    )
  })

  it('rejects reordering against a different parent level', () => {
    const state = baseState()
    createGroup(state, '父', 'A')
    createGroup(state, '子', 'A', state.groups[0].id)
    const [parent, child] = state.groups
    const result = reorderGroup(state, child.id, parent.id)
    assert.equal(result.ok, false)
  })

  it('rejects an unknown group', () => {
    const state = baseState()
    const result = reorderGroup(state, 'nope')
    assert.equal(result.ok, false)
  })
})

describe('reorderMark', () => {
  it('reorders holding marks independently', () => {
    const state = normalizeState({ stocks: ['sh600000', 'sh600001'] })
    addStock(state, 'sh600000')
    addStock(state, 'sh600001')
    setMark(state, 'sh600000', 'holding', true)
    setMark(state, 'sh600001', 'holding', true)

    const result = reorderMark(state, 'holding', 'sh600001', 'sh600000')
    assert.equal(result.ok, true)
    assert.deepEqual(state.holdingCodes, ['sh600001', 'sh600000'])
  })

  it('reorders watch marks independently', () => {
    const state = normalizeState({ stocks: ['sh600000', 'sh600001'] })
    addStock(state, 'sh600000')
    addStock(state, 'sh600001')

    const result = reorderMark(state, 'watch', 'sh600001', 'sh600000')
    assert.equal(result.ok, true)
    assert.deepEqual(state.watchCodes, ['sh600001', 'sh600000'])
  })

  it('reorders focus marks independently', () => {
    const state = normalizeState({ stocks: ['sh600000', 'sh600001'] })
    addStock(state, 'sh600000')
    addStock(state, 'sh600001')
    setMark(state, 'sh600000', 'focus', true)
    setMark(state, 'sh600001', 'focus', true)

    const result = reorderMark(state, 'focus', 'sh600001', 'sh600000')
    assert.equal(result.ok, true)
    assert.deepEqual(state.focusCodes, ['sh600001', 'sh600000'])
  })

  it('rejects a mark not in the list', () => {
    const state = baseState()
    addStock(state, 'sh600000')
    const result = reorderMark(state, 'holding', 'sh600000', 'sh600001')
    assert.equal(result.ok, false)
  })
})
