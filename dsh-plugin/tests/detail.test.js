"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = require("node:assert/strict");
const detail_js_1 = require("../src/detail.js");
(0, node_test_1.describe)('closesWithLatest', () => {
    (0, node_test_1.it)('replaces the last close when the daily bar is today', () => {
        const today = new Date();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const todayStr = `${today.getFullYear()}-${month}-${day}`;
        const daily = [
            { date: '2026-08-14', close: 9.1 },
            { date: todayStr, close: 9.2 },
        ];
        const closes = (0, detail_js_1.closesWithLatest)(daily, 9.04);
        strict_1.default.deepEqual(closes, [9.1, 9.04]);
    });
    (0, node_test_1.it)('appends the latest price when the daily bar is not today', () => {
        const daily = [
            { date: '2026-08-13', close: 9.1 },
            { date: '2026-08-14', close: 9.2 },
        ];
        const closes = (0, detail_js_1.closesWithLatest)(daily, 9.04);
        strict_1.default.deepEqual(closes, [9.1, 9.2, 9.04]);
    });
    (0, node_test_1.it)('returns closes unchanged for empty input plus the latest', () => {
        strict_1.default.deepEqual((0, detail_js_1.closesWithLatest)([], 9.04), [9.04]);
    });
});
(0, node_test_1.describe)('calcMA', () => {
    (0, node_test_1.it)('computes the moving average over the last N closes', () => {
        const closes = [10, 11, 12, 13, 14, 15];
        strict_1.default.equal((0, detail_js_1.calcMA)(closes, 5), 13); // (11+12+13+14+15)/5
        strict_1.default.equal((0, detail_js_1.calcMA)(closes, 3), 14); // (13+14+15)/3
    });
    (0, node_test_1.it)('returns null when there are not enough closes', () => {
        strict_1.default.equal((0, detail_js_1.calcMA)([1, 2, 3], 5), null);
        strict_1.default.equal((0, detail_js_1.calcMA)([], 5), null);
    });
    (0, node_test_1.it)('uses the latest window', () => {
        const closes = [1, 2, 3, 4, 5, 100];
        strict_1.default.equal((0, detail_js_1.calcMA)(closes, 5), 22.8); // (2+3+4+5+100)/5
    });
});
