import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { displayPrice, formatPercent, isEtf, parseSinaBody } from '../src/quote.js'

describe('isEtf', () => {
  it('recognizes ETF by code prefix', () => {
    assert.equal(isEtf('sh512100', '券商ETF'), true)
    assert.equal(isEtf('sh588000', '科创50ETF'), true)
    assert.equal(isEtf('sz159915', '创业板ETF'), true)
    assert.equal(isEtf('sh510300', '沪深300ETF'), true)
  })

  it('recognizes ETF by name', () => {
    assert.equal(isEtf('sz159999', '创新药ETF国泰'), true)
  })

  it('does not misclassify ordinary stocks', () => {
    assert.equal(isEtf('sh600000', '浦发银行'), false)
    assert.equal(isEtf('sz000001', '平安银行'), false)
  })
})

describe('displayPrice', () => {
  it('truncates ETF price to three decimals without rounding', () => {
    assert.equal(displayPrice('sh512100', '券商ETF', 1.1269), '1.126')
    assert.equal(displayPrice('sh512100', '券商ETF', 1.12), '1.120')
    assert.equal(displayPrice('sh588000', '科创50ETF', 0.672), '0.672')
    assert.equal(displayPrice('sz159915', '创业板ETF', 1.107), '1.107')
  })

  it('keeps two decimals for ordinary stocks above 1', () => {
    assert.equal(displayPrice('sh600000', '浦发银行', 10.234), '10.23')
    assert.equal(displayPrice('sh600000', '浦发银行', 1.1269), '1.13')
  })

  it('keeps three decimals for low-priced ordinary stocks', () => {
    assert.equal(displayPrice('sz000001', '平安银行', 0.672), '0.672')
  })
})

describe('formatPercent', () => {
  it('adds an explicit sign', () => {
    assert.equal(formatPercent(1.234), '+1.23%')
    assert.equal(formatPercent(-0.5), '-0.50%')
    assert.equal(formatPercent(0), '+0.00%')
  })
})

describe('parseSinaBody', () => {
  it('parses an A-share line (sh600000)', () => {
    const body = 'var hq_str_sh600000="浦发银行,11.50,11.40,11.60,11.70,11.30,11.59,11.60,123456,789000000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2024-01-02,15:00:00,00";\n'
    const quotes = parseSinaBody(body)
    const quote = quotes.get('sh600000')
    assert.ok(quote)
    assert.equal(quote.name, '浦发银行')
    assert.equal(quote.price, 11.6)
    assert.equal(quote.yestclose, 11.4)
    assert.equal(quote.open, 11.5)
    assert.equal(quote.high, 11.7)
    assert.equal(quote.low, 11.3)
    assert.equal(quote.percent.toFixed(2), '1.75')
    assert.equal(quote.time, '2024-01-02 15:00:00')
  })

  it('falls back to buy1 price when the latest price is zero', () => {
    const body = 'var hq_str_sh600000="浦发银行,11.50,11.40,0.000,11.70,11.30,11.59,11.60,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2024-01-02,15:00:00,00";\n'
    const quote = parseSinaBody(body).get('sh600000')
    assert.ok(quote)
    assert.equal(quote.price, 11.59)
  })

  it('parses a US stock line (usr_aapl)', () => {
    // Field layout used by the parser: 0 name, 1 price, 5 open, 6 high,
    // 7 low, 26 yestclose, 3 time text.
    const body =
      'var hq_str_usr_aapl="苹果,190.50,1.20,0.63%,2024-01-02 16:00:00,191.00,192.00,189.00,' +
      '0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,188.00";\n'
    const quote = parseSinaBody(body).get('usr_aapl')
    assert.ok(quote)
    assert.equal(quote.name, '苹果')
    assert.equal(quote.price, 190.5)
    assert.equal(quote.yestclose, 188)
    assert.equal(quote.open, 191)
    assert.equal(quote.high, 192)
    assert.equal(quote.low, 189)
  })

  it('parses a global index line (b_NKY)', () => {
    const body = 'var hq_str_b_NKY="日经225,39000.00,200.00,2024-01-02,15:00:00,0,0,0,38900.00,0,39050.00,38850.00";\n'
    const quote = parseSinaBody(body).get('b_NKY')
    assert.ok(quote)
    assert.equal(quote.name, '日经225')
    assert.equal(quote.price, 39000)
    assert.equal(quote.yestclose, 38800)
    assert.equal(quote.open, 38900)
    assert.equal(quote.high, 39050)
    assert.equal(quote.low, 38850)
  })

  it('parses an int_ index line', () => {
    const body = 'var hq_str_int_dji="道琼斯,40000.00,100.00,2024-01-02";\n'
    const quote = parseSinaBody(body).get('int_dji')
    assert.ok(quote)
    assert.equal(quote.price, 40000)
    assert.equal(quote.yestclose, 39900)
  })

  it('ignores unavailable stocks and malformed lines', () => {
    const body =
      'var hq_str_sh600000="浦发银行,11.50,11.40,11.60,11.70,11.30,11.59,11.60,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2024-01-02,15:00:00,00";\n' +
      'var hq_str_sh999999="FAILED";\n' +
      'not a valid line\n'
    const quotes = parseSinaBody(body)
    assert.equal(quotes.size, 1)
  })
})
