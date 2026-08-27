"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = require("node:assert/strict");
const search_js_1 = require("../src/search.js");
(0, node_test_1.describe)('parseTencentStockSearch', () => {
    (0, node_test_1.it)('keeps only Shanghai/Shenzhen/Beijing A-share candidates', () => {
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
        };
        const results = (0, search_js_1.parseTencentStockSearch)(payload);
        strict_1.default.deepEqual(results, [
            { code: 'sh600000', name: '浦发银行' },
            { code: 'sz000001', name: '平安银行' },
            { code: 'bj430047', name: '诺思兰德' },
        ]);
    });
    (0, node_test_1.it)('dedupes repeated codes', () => {
        const payload = {
            data: {
                stock: [
                    ['sh', '600000', '浦发银行', 'A'],
                    ['sh', '600000', '浦发银行', 'B'],
                ],
            },
        };
        const results = (0, search_js_1.parseTencentStockSearch)(payload);
        strict_1.default.equal(results.length, 1);
    });
    (0, node_test_1.it)('returns empty for a malformed payload', () => {
        strict_1.default.deepEqual((0, search_js_1.parseTencentStockSearch)(null), []);
        strict_1.default.deepEqual((0, search_js_1.parseTencentStockSearch)({}), []);
        strict_1.default.deepEqual((0, search_js_1.parseTencentStockSearch)({ data: { stock: 'nope' } }), []);
        strict_1.default.deepEqual((0, search_js_1.parseTencentStockSearch)({ data: { stock: [['sh']] } }), []);
    });
});
