"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = require("node:assert/strict");
const quote_js_1 = require("../src/quote.js");
(0, node_test_1.describe)('isEtf', () => {
    (0, node_test_1.it)('recognizes ETF by code prefix', () => {
        strict_1.default.equal((0, quote_js_1.isEtf)('sh512100', '券商ETF'), true);
        strict_1.default.equal((0, quote_js_1.isEtf)('sh588000', '科创50ETF'), true);
        strict_1.default.equal((0, quote_js_1.isEtf)('sz159915', '创业板ETF'), true);
        strict_1.default.equal((0, quote_js_1.isEtf)('sh510300', '沪深300ETF'), true);
    });
    (0, node_test_1.it)('recognizes ETF by name', () => {
        strict_1.default.equal((0, quote_js_1.isEtf)('sz159999', '创新药ETF国泰'), true);
    });
    (0, node_test_1.it)('does not misclassify ordinary stocks', () => {
        strict_1.default.equal((0, quote_js_1.isEtf)('sh600000', '浦发银行'), false);
        strict_1.default.equal((0, quote_js_1.isEtf)('sz000001', '平安银行'), false);
    });
});
(0, node_test_1.describe)('displayPrice', () => {
    (0, node_test_1.it)('truncates ETF price to three decimals without rounding', () => {
        strict_1.default.equal((0, quote_js_1.displayPrice)('sh512100', '券商ETF', 1.1269), '1.126');
        strict_1.default.equal((0, quote_js_1.displayPrice)('sh512100', '券商ETF', 1.12), '1.120');
        strict_1.default.equal((0, quote_js_1.displayPrice)('sh588000', '科创50ETF', 0.672), '0.672');
        strict_1.default.equal((0, quote_js_1.displayPrice)('sz159915', '创业板ETF', 1.107), '1.107');
    });
    (0, node_test_1.it)('keeps two decimals for ordinary stocks above 1', () => {
        strict_1.default.equal((0, quote_js_1.displayPrice)('sh600000', '浦发银行', 10.234), '10.23');
        strict_1.default.equal((0, quote_js_1.displayPrice)('sh600000', '浦发银行', 1.1269), '1.13');
    });
    (0, node_test_1.it)('keeps three decimals for low-priced ordinary stocks', () => {
        strict_1.default.equal((0, quote_js_1.displayPrice)('sz000001', '平安银行', 0.672), '0.672');
    });
});
(0, node_test_1.describe)('formatPercent', () => {
    (0, node_test_1.it)('adds an explicit sign', () => {
        strict_1.default.equal((0, quote_js_1.formatPercent)(1.234), '+1.23%');
        strict_1.default.equal((0, quote_js_1.formatPercent)(-0.5), '-0.50%');
        strict_1.default.equal((0, quote_js_1.formatPercent)(0), '+0.00%');
    });
});
(0, node_test_1.describe)('parseSinaBody', () => {
    (0, node_test_1.it)('parses an A-share line (sh600000)', () => {
        const body = 'var hq_str_sh600000="浦发银行,11.50,11.40,11.60,11.70,11.30,11.59,11.60,123456,789000000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2024-01-02,15:00:00,00";\n';
        const quotes = (0, quote_js_1.parseSinaBody)(body);
        const quote = quotes.get('sh600000');
        strict_1.default.ok(quote);
        strict_1.default.equal(quote.name, '浦发银行');
        strict_1.default.equal(quote.price, 11.6);
        strict_1.default.equal(quote.yestclose, 11.4);
        strict_1.default.equal(quote.open, 11.5);
        strict_1.default.equal(quote.high, 11.7);
        strict_1.default.equal(quote.low, 11.3);
        strict_1.default.equal(quote.percent.toFixed(2), '1.75');
        strict_1.default.equal(quote.time, '2024-01-02 15:00:00');
    });
    (0, node_test_1.it)('falls back to buy1 price when the latest price is zero', () => {
        const body = 'var hq_str_sh600000="浦发银行,11.50,11.40,0.000,11.70,11.30,11.59,11.60,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2024-01-02,15:00:00,00";\n';
        const quote = (0, quote_js_1.parseSinaBody)(body).get('sh600000');
        strict_1.default.ok(quote);
        strict_1.default.equal(quote.price, 11.59);
    });
    (0, node_test_1.it)('parses a US stock line (usr_aapl)', () => {
        // Field layout used by the parser: 0 name, 1 price, 5 open, 6 high,
        // 7 low, 26 yestclose, 3 time text.
        const body = 'var hq_str_usr_aapl="苹果,190.50,1.20,0.63%,2024-01-02 16:00:00,191.00,192.00,189.00,' +
            '0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,188.00";\n';
        const quote = (0, quote_js_1.parseSinaBody)(body).get('usr_aapl');
        strict_1.default.ok(quote);
        strict_1.default.equal(quote.name, '苹果');
        strict_1.default.equal(quote.price, 190.5);
        strict_1.default.equal(quote.yestclose, 188);
        strict_1.default.equal(quote.open, 191);
        strict_1.default.equal(quote.high, 192);
        strict_1.default.equal(quote.low, 189);
    });
    (0, node_test_1.it)('parses a global index line (b_NKY)', () => {
        const body = 'var hq_str_b_NKY="日经225,39000.00,200.00,2024-01-02,15:00:00,0,0,0,38900.00,0,39050.00,38850.00";\n';
        const quote = (0, quote_js_1.parseSinaBody)(body).get('b_NKY');
        strict_1.default.ok(quote);
        strict_1.default.equal(quote.name, '日经225');
        strict_1.default.equal(quote.price, 39000);
        strict_1.default.equal(quote.yestclose, 38800);
        strict_1.default.equal(quote.open, 38900);
        strict_1.default.equal(quote.high, 39050);
        strict_1.default.equal(quote.low, 38850);
    });
    (0, node_test_1.it)('parses an int_ index line', () => {
        const body = 'var hq_str_int_dji="道琼斯,40000.00,100.00,2024-01-02";\n';
        const quote = (0, quote_js_1.parseSinaBody)(body).get('int_dji');
        strict_1.default.ok(quote);
        strict_1.default.equal(quote.price, 40000);
        strict_1.default.equal(quote.yestclose, 39900);
    });
    (0, node_test_1.it)('ignores unavailable stocks and malformed lines', () => {
        const body = 'var hq_str_sh600000="浦发银行,11.50,11.40,11.60,11.70,11.30,11.59,11.60,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2024-01-02,15:00:00,00";\n' +
            'var hq_str_sh999999="FAILED";\n' +
            'not a valid line\n';
        const quotes = (0, quote_js_1.parseSinaBody)(body);
        strict_1.default.equal(quotes.size, 1);
    });
});
