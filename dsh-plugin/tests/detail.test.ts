import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  barsForLatestDate,
  calcMA,
  chinaDateString,
  fetchDailyKline,
  fetchStockDetail,
  normalizeKlineTime,
  parseEastmoneyDailyLines,
  parseTencentDailyRows,
  referencePrices,
  withCompletion,
} from '../src/detail.js'

describe('withCompletion', () => {
  const bar = (time: string, completed = true) => ({
    date: '2026-11-02',
    time,
    open: 1,
    close: 2,
    high: 3,
    low: 1,
    volume: 100,
    completed,
  })

  it('closes every bar whose 5-minute bucket already ended at snapshot time', () => {
    const result = withCompletion([bar('09:35'), bar('10:00'), bar('11:30')], '2026-11-02 10:00:00')
    assert.deepEqual(
      result.map((b) => b.completed),
      [true, true, false]
    )
  })

  it('keeps the whole day completed once the exchange clock passes 15:00', () => {
    const result = withCompletion([bar('14:55'), bar('15:00')], '2026-11-02 15:00:00')
    assert.deepEqual(
      result.map((b) => b.completed),
      [true, true]
    )
  })

  it('marks no bar as in progress when the quote time is not parseable', () => {
    const result = withCompletion([bar('09:35'), bar('09:40')], '')
    assert.deepEqual(
      result.map((b) => b.completed),
      [true, true]
    )
  })

  it('returns an empty array for empty input', () => {
    assert.deepEqual(withCompletion([], '2026-11-02 10:00:00'), [])
  })
})

describe('calcMA', () => {
  it('computes the moving average over the last N closes', () => {
    const closes = [10, 11, 12, 13, 14, 15]
    assert.equal(calcMA(closes, 5), 13) // (11+12+13+14+15)/5
    assert.equal(calcMA(closes, 3), 14) // (13+14+15)/3
  })

  it('returns null when there are not enough closes', () => {
    assert.equal(calcMA([1, 2, 3], 5), null)
    assert.equal(calcMA([], 5), null)
  })

  it('uses the latest window', () => {
    const closes = [1, 2, 3, 4, 5, 100]
    assert.equal(calcMA(closes, 5), 22.8) // (2+3+4+5+100)/5
  })

  it('supports 30/60-day windows used by MA30/MA60', () => {
    const closes = Array.from({ length: 70 }, (_, i) => 100 + i)
    assert.equal(calcMA(closes, 30), 154.5) // last 30: 140..169
    assert.equal(calcMA(closes, 60), 139.5) // last 60: 110..169
    assert.equal(calcMA(closes.slice(0, 59), 60), null) // 59 closes < 60
  })
})

describe('normalizeKlineTime', () => {
  it('parses the compact Tencent form', () => {
    assert.deepEqual(normalizeKlineTime('202610231335'), { date: '2026-10-23', time: '13:35' })
  })

  it('parses the dashed Eastmoney form', () => {
    assert.deepEqual(normalizeKlineTime('2026-09-02 09:35'), { date: '2026-09-02', time: '09:35' })
  })

  it('returns null for unparseable input', () => {
    assert.equal(normalizeKlineTime(''), null)
    assert.equal(normalizeKlineTime('not-a-time'), null)
    assert.equal(normalizeKlineTime('20261023'), null)
  })
})

describe('barsForLatestDate', () => {
  const bar = (date: string, time: string) => ({
    date,
    time,
    open: 1,
    close: 2,
    high: 3,
    low: 1,
    volume: 100,
    completed: true,
  })

  it('keeps only the latest date bars (intraday view)', () => {
    const bars = [bar('2026-10-22', '15:00'), bar('2026-10-23', '09:35'), bar('2026-10-23', '09:40')]
    const result = barsForLatestDate(bars)
    assert.equal(result.length, 2)
    assert.deepEqual(result.map((b) => b.time), ['09:35', '09:40'])
  })

  it('returns an empty array for empty input', () => {
    assert.deepEqual(barsForLatestDate([]), [])
  })
})

// ── Daily K-line reference prices ───────────────────────────────────────

describe('parseTencentDailyRows', () => {
  it('parses qfqday rows into daily bars', () => {
    const rows = [
      ['2026-08-01', '10.00', '10.20', '10.30', '9.90', '12345'],
      ['2026-08-02', '10.20', '10.10', '10.25', '9.95', '67890'],
    ]
    assert.deepEqual(parseTencentDailyRows(rows), [
      { date: '2026-08-01', high: 10.3, low: 9.9 },
      { date: '2026-08-02', high: 10.25, low: 9.95 },
    ])
  })

  it('skips malformed rows', () => {
    const rows = [
      ['bad-date', '1', '2', '3', '4', '5'],
      ['2026-08-02', '1', '2', '0', '4', '5'], // high = 0
      'not-an-array',
      ['2026-08-02'], // too short
    ]
    assert.deepEqual(parseTencentDailyRows(rows), [])
  })
})

describe('parseEastmoneyDailyLines', () => {
  it('parses klt=101 lines into daily bars', () => {
    const lines = [
      '2026-08-01,10.00,10.20,10.30,9.90,12345,123456789.00',
      '2026-08-02,10.20,10.10,10.25,9.95,67890,678901234.00',
    ]
    assert.deepEqual(parseEastmoneyDailyLines(lines), [
      { date: '2026-08-01', high: 10.3, low: 9.9 },
      { date: '2026-08-02', high: 10.25, low: 9.95 },
    ])
  })

  it('skips malformed lines', () => {
    assert.deepEqual(parseEastmoneyDailyLines(['2026-08-02,1,2', 'garbage']), [])
  })
})

describe('chinaDateString', () => {
  it('formats the epoch as Shanghai midnight', () => {
    assert.equal(chinaDateString(0), '1970-01-01')
  })

  it('never flips the date before 16:00 UTC (= midnight Shanghai)', () => {
    assert.equal(chinaDateString(Date.UTC(2026, 10, 2, 8)), '2026-11-02')
    assert.equal(chinaDateString(Date.UTC(2026, 10, 2, 15)), '2026-11-02')
    assert.equal(chinaDateString(Date.UTC(2026, 10, 2, 16)), '2026-11-03')
  })
})

describe('referencePrices', () => {
  const daily = (dates: string[]) =>
    dates.map((date, index) => ({ date, high: 10 + index, low: 8 + index }))

  it('uses the latest bar as 昨日 when today has no bar (weekend/holiday)', () => {
    const bars = daily(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'])
    assert.deepEqual(referencePrices(bars, '2026-10-31'), {
      yestHigh: 13,
      yestLow: 11,
      high60: 13,
      low60: 8,
    })
  })

  it('steps back one bar for 昨日 during a live session (today bar present)', () => {
    const bars = daily(['2026-10-29', '2026-10-30', '2026-11-02'])
    const refs = referencePrices(bars, '2026-11-02')
    assert.equal(refs.yestHigh, 11) // 2026-10-30
    assert.equal(refs.yestLow, 9)
    assert.equal(refs.high60, 12) // includes today's still-forming bar
    assert.equal(refs.low60, 8)
  })

  it('returns zero 昨日 for a single-bar (new listing) but keeps the 60-day range', () => {
    assert.deepEqual(referencePrices(daily(['2026-11-02']), '2026-11-02'), {
      yestHigh: 0,
      yestLow: 0,
      high60: 10,
      low60: 8,
    })
  })

  it('returns zeros for empty input', () => {
    assert.deepEqual(referencePrices([], '2026-11-02'), {
      yestHigh: 0,
      yestLow: 0,
      high60: 0,
      low60: 0,
    })
  })
})

describe('fetchDailyKline (network mocked)', () => {
  function jsonResponse(data: unknown): Response {
    return {
      ok: true,
      arrayBuffer: async () => {
        const bytes = new TextEncoder().encode(JSON.stringify(data))
        return bytes.buffer as ArrayBuffer
      },
    } as unknown as Response
  }

  function stubFetch(handler: (url: string) => unknown | undefined): () => void {
    const original = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const data = handler(url)
      if (data !== undefined) return jsonResponse(data)
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    return () => {
      globalThis.fetch = original
    }
  }

  it('falls back to Eastmoney klt=101 when Tencent returns no daily rows', async () => {
    const restore = stubFetch((url) => {
      if (url.includes('fqkline')) return { code: 0, data: { sh600000: {} } }
      if (url.includes('eastmoney')) {
        return {
          data: { klines: ['2026-08-01,10.00,10.20,10.30,9.90,12345,0', '2026-08-02,10.20,10.10,10.25,9.95,1,0'] },
        }
      }
      return undefined
    })
    try {
      const bars = await fetchDailyKline('sh600000', 60, 500)
      assert.equal(bars.length, 2)
      assert.deepEqual(bars[0], { date: '2026-08-01', high: 10.3, low: 9.9 })
    } finally {
      restore()
    }
  })

  it('returns an empty array for an invalid code without any network call', async () => {
    const restore = stubFetch(() => undefined)
    try {
      assert.deepEqual(await fetchDailyKline('bogus', 60, 500), [])
    } finally {
      restore()
    }
  })
})

describe('fetchStockDetail (network mocked)', () => {
  function shanghaiDate(offsetDays: number): string {
    return chinaDateString(Date.now() - offsetDays * 86_400_000)
  }

  it('includes yesterday and 60-trading-day high/low reference prices', async () => {
    const today = shanghaiDate(0)
    const day1 = shanghaiDate(1)
    const day2 = shanghaiDate(2)
    const original = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      let data: unknown
      if (url.includes('mkline')) {
        // Tencent 5-min payload: qt metadata + m5 bars for two days.
        const qt = new Array(50).fill('0') as string[]
        qt[1] = '浦发银行'
        data = {
          code: 0,
          data: {
            sh600000: {
              qt: { sh600000: qt },
              m5: [
                [`${day2.replaceAll('-', '')}0935`, '9.90', '9.95', '10.00', '9.88', '100'],
                [`${day2.replaceAll('-', '')}0940`, '9.95', '10.10', '10.15', '9.94', '200'],
                [`${today.replaceAll('-', '')}0935`, '10.05', '10.20', '10.25', '10.00', '300'],
                [`${today.replaceAll('-', '')}0940`, '10.20', '10.30', '10.35', '10.15', '400'],
              ],
            },
          },
        }
      } else if (url.includes('fqkline')) {
        data = {
          code: 0,
          data: {
            sh600000: {
              qfqday: [
                [day2, '10.00', '10.00', '10.20', '9.90', '1'],
                [day1, '10.00', '10.00', '10.15', '9.95', '1'],
                [today, '10.00', '10.30', '10.35', '10.00', '1'],
              ],
            },
          },
        }
      }
      if (data === undefined) throw new Error(`unexpected fetch: ${url}`)
      const bytes = new TextEncoder().encode(JSON.stringify(data))
      return {
        ok: true,
        arrayBuffer: async () => bytes.buffer as ArrayBuffer,
      } as unknown as Response
    }) as typeof fetch
    try {
      const detail = await fetchStockDetail('sh600000', undefined, 500)
      assert.equal(detail.yestHigh, 10.15) // day1
      assert.equal(detail.yestLow, 9.95)
      assert.equal(detail.high60, 10.35) // today's partial bar included
      assert.equal(detail.low60, 9.9)
      assert.equal(detail.code, 'sh600000')
    } finally {
      globalThis.fetch = original
    }
  })
})
