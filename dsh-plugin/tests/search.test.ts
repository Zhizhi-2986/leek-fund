import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseTencentStockSearch } from '../src/search.js'

describe('parseTencentStockSearch', () => {
  it('keeps only Shanghai/Shenzhen/Beijing A-share candidates', () => {
    const payload = {
      data: {
        stock: [
          ['sh', '600000', '浦发银行', 'SPDBANK'],
          ['sz', '000001', '平安银行', 'PAB'],
          ['bj', '430047', '诺思兰德', 'N'],
          ['hk', '00700', '腾讯控股', 'TENCENT'],
          ['us', 'AAPL', '苹果', 'APPLE'],
        ],
      },
    }
    const results = parseTencentStockSearch(payload)
    assert.deepEqual(results, [
      { code: 'sh600000', name: '浦发银行' },
      { code: 'sz000001', name: '平安银行' },
      { code: 'bj430047', name: '诺思兰德' },
    ])
  })

  it('dedupes repeated codes', () => {
    const payload = {
      data: {
        stock: [
          ['sh', '600000', '浦发银行', 'A'],
          ['sh', '600000', '浦发银行', 'B'],
        ],
      },
    }
    const results = parseTencentStockSearch(payload)
    assert.equal(results.length, 1)
  })

  it('returns empty for a malformed payload', () => {
    assert.deepEqual(parseTencentStockSearch(null), [])
    assert.deepEqual(parseTencentStockSearch({}), [])
    assert.deepEqual(parseTencentStockSearch({ data: { stock: 'nope' } }), [])
    assert.deepEqual(parseTencentStockSearch({ data: { stock: [['sh']] } }), [])
  })
})
