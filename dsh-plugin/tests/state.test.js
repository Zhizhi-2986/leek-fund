"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = require("node:assert/strict");
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const state_js_1 = require("../src/state.js");
(0, node_test_1.describe)('normalizeCode', () => {
    (0, node_test_1.it)('lowercases and canonicalizes', () => {
        strict_1.default.equal((0, state_js_1.normalizeCode)('SH600000'), 'sh600000');
        strict_1.default.equal((0, state_js_1.normalizeCode)('sh600000'), 'sh600000');
        strict_1.default.equal((0, state_js_1.normalizeCode)(' HK00700 '), 'hk00700');
        strict_1.default.equal((0, state_js_1.normalizeCode)('USR_AAPL'), 'usr_aapl');
    });
    (0, node_test_1.it)('rejects invalid codes', () => {
        strict_1.default.equal((0, state_js_1.normalizeCode)(''), '');
        strict_1.default.equal((0, state_js_1.normalizeCode)('abc'), '');
        strict_1.default.equal((0, state_js_1.normalizeCode)('sh60000'), '');
        strict_1.default.equal((0, state_js_1.normalizeCode)('hk1234'), '');
    });
});
(0, node_test_1.describe)('categoryOf', () => {
    (0, node_test_1.it)('maps markets', () => {
        strict_1.default.equal((0, state_js_1.categoryOf)('sh600000'), 'A');
        strict_1.default.equal((0, state_js_1.categoryOf)('sz000001'), 'A');
        strict_1.default.equal((0, state_js_1.categoryOf)('bj430047'), 'A');
        strict_1.default.equal((0, state_js_1.categoryOf)('hk00700'), 'HK');
        strict_1.default.equal((0, state_js_1.categoryOf)('usr_aapl'), 'US');
        strict_1.default.equal((0, state_js_1.categoryOf)('gb_aapl'), 'US');
        strict_1.default.equal((0, state_js_1.categoryOf)('xxx'), undefined);
    });
});
(0, node_test_1.describe)('normalizeState', () => {
    (0, node_test_1.it)('dedupes stocks and drops invalid codes', () => {
        const state = (0, state_js_1.normalizeState)({
            stocks: ['sh600000', 'SH600000', 'bad', 'hk00700'],
            holding_codes: ['sh600000', 'not-a-stock'],
        });
        strict_1.default.deepEqual(state.stocks, ['sh600000', 'hk00700']);
        strict_1.default.deepEqual(state.holdingCodes, ['sh600000']);
    });
    (0, node_test_1.it)('surfaces ungroupped A-share orphans into the watch list', () => {
        const state = (0, state_js_1.normalizeState)({ stocks: ['sh600000', 'hk00700', 'usr_aapl'] });
        strict_1.default.deepEqual(state.watchCodes, ['sh600000']);
    });
    (0, node_test_1.it)('round-trips the camelCase in-memory shape', () => {
        const state = (0, state_js_1.normalizeState)({
            stocks: ['sh600000'],
            groups: [{ id: 'g1', name: '银行', category: 'A', stockCodes: ['sh600000'] }],
            holdingCodes: ['sh600000'],
        });
        strict_1.default.deepEqual(state.groups[0].stockCodes, ['sh600000']);
        strict_1.default.deepEqual(state.holdingCodes, ['sh600000']);
    });
    (0, node_test_1.it)('drops group codes that are not in the watchlist or mismatch the market', () => {
        const state = (0, state_js_1.normalizeState)({
            stocks: ['sh600000'],
            groups: [
                { id: 'g1', name: '银行', category: 'A', stock_codes: ['sh600000', 'hk00700'] },
                { id: 'g2', name: '非法', category: 'A', stock_codes: ['usr_aapl'] },
            ],
        });
        strict_1.default.equal(state.groups.length, 2);
        strict_1.default.deepEqual(state.groups[0].stockCodes, ['sh600000']);
        strict_1.default.deepEqual(state.groups[1].stockCodes, []);
    });
});
(0, node_test_1.describe)('group mutations', () => {
    (0, node_test_1.it)('creates a top-level group', () => {
        const state = (0, state_js_1.normalizeState)({ stocks: ["sh600000", "hk00700", "usr_aapl"] });
        const result = (0, state_js_1.createGroup)(state, ' 光通信 ', 'A');
        strict_1.default.equal(result.ok, true);
        strict_1.default.equal(state.groups[0].name, '光通信');
        strict_1.default.equal(state.groups[0].category, 'A');
    });
    (0, node_test_1.it)('creates a second-level group under a top-level parent', () => {
        const state = (0, state_js_1.normalizeState)({ stocks: ["sh600000", "hk00700", "usr_aapl"] });
        (0, state_js_1.createGroup)(state, '光通信', 'A');
        const parent = state.groups[0];
        const result = (0, state_js_1.createGroup)(state, 'CPO', 'A', parent.id);
        strict_1.default.equal(result.ok, true);
        strict_1.default.equal(state.groups[1].parentId, parent.id);
    });
    (0, node_test_1.it)('rejects a third level and cross-market children', () => {
        const state = (0, state_js_1.normalizeState)({ stocks: ["sh600000", "hk00700", "usr_aapl"] });
        (0, state_js_1.createGroup)(state, '光通信', 'A');
        (0, state_js_1.createGroup)(state, 'CPO', 'A', state.groups[0].id);
        const nested = (0, state_js_1.createGroup)(state, '子子', 'A', state.groups[1].id);
        strict_1.default.equal(nested.ok, false);
        const state2 = (0, state_js_1.normalizeState)({ stocks: ["sh600000", "hk00700", "usr_aapl"] });
        (0, state_js_1.createGroup)(state2, '港股组', 'HK');
        const cross = (0, state_js_1.createGroup)(state2, 'A股子组', 'A', state2.groups[0].id);
        strict_1.default.equal(cross.ok, false);
    });
    (0, node_test_1.it)('rejects duplicate sibling names', () => {
        const state = (0, state_js_1.normalizeState)({ stocks: ["sh600000", "hk00700", "usr_aapl"] });
        (0, state_js_1.createGroup)(state, '同名', 'A');
        const dup = (0, state_js_1.createGroup)(state, '同名', 'A');
        strict_1.default.equal(dup.ok, false);
    });
    (0, node_test_1.it)('renames a group', () => {
        const state = (0, state_js_1.normalizeState)({ stocks: ["sh600000", "hk00700", "usr_aapl"] });
        (0, state_js_1.createGroup)(state, '旧名', 'A');
        const result = (0, state_js_1.renameGroup)(state, state.groups[0].id, '新名');
        strict_1.default.equal(result.ok, true);
        strict_1.default.equal(state.groups[0].name, '新名');
    });
    (0, node_test_1.it)('deletes a group and its children but keeps stocks', () => {
        const state = (0, state_js_1.normalizeState)({ stocks: ["sh600000", "hk00700", "usr_aapl"] });
        (0, state_js_1.createGroup)(state, '父', 'A');
        const parent = state.groups[0];
        (0, state_js_1.createGroup)(state, '子', 'A', parent.id);
        (0, state_js_1.addStock)(state, 'sh600000', parent.id);
        const result = (0, state_js_1.deleteGroup)(state, parent.id);
        strict_1.default.equal(result.ok, true);
        strict_1.default.equal(state.groups.length, 0);
        strict_1.default.ok(state.stocks.includes('sh600000'));
    });
    (0, node_test_1.it)('moves a stock between groups and back to ungroupped', () => {
        const state = (0, state_js_1.normalizeState)({ stocks: ["sh600000", "hk00700", "usr_aapl"] });
        (0, state_js_1.addStock)(state, 'sh600000');
        (0, state_js_1.createGroup)(state, '银行', 'A');
        const group = state.groups[0];
        const moved = (0, state_js_1.moveStockToGroup)(state, 'sh600000', group.id);
        strict_1.default.equal(moved.ok, true);
        strict_1.default.deepEqual(group.stockCodes, ['sh600000']);
        const ungroupped = (0, state_js_1.moveStockToGroup)(state, 'sh600000');
        strict_1.default.equal(ungroupped.ok, true);
        strict_1.default.deepEqual(group.stockCodes, []);
    });
    (0, node_test_1.it)('rejects moving a stock into a different-market group', () => {
        const state = (0, state_js_1.normalizeState)({ stocks: ["sh600000", "hk00700", "usr_aapl"] });
        (0, state_js_1.addStock)(state, 'hk00700');
        (0, state_js_1.createGroup)(state, 'A股组', 'A');
        const result = (0, state_js_1.moveStockToGroup)(state, 'hk00700', state.groups[0].id);
        strict_1.default.equal(result.ok, false);
    });
});
(0, node_test_1.describe)('marks and watchlist mutations', () => {
    (0, node_test_1.it)('sets and clears holding/watch/focus marks', () => {
        const state = (0, state_js_1.normalizeState)({ stocks: ["sh600000", "hk00700", "usr_aapl"] });
        (0, state_js_1.addStock)(state, 'sh600000');
        (0, state_js_1.setMark)(state, 'sh600000', 'holding', true);
        strict_1.default.deepEqual(state.holdingCodes, ['sh600000']);
        (0, state_js_1.setMark)(state, 'sh600000', 'holding', false);
        strict_1.default.deepEqual(state.holdingCodes, []);
        (0, state_js_1.setMark)(state, 'sh600000', 'watch', true);
        strict_1.default.deepEqual(state.watchCodes, ['sh600000']);
        (0, state_js_1.setMark)(state, 'sh600000', 'focus', true);
        strict_1.default.deepEqual(state.focusCodes, ['sh600000']);
        (0, state_js_1.setMark)(state, 'sh600000', 'focus', false);
        strict_1.default.deepEqual(state.focusCodes, []);
    });
    (0, node_test_1.it)('rejects marking a stock outside the watchlist', () => {
        const state = (0, state_js_1.normalizeState)({ stocks: ["sh600000", "hk00700", "usr_aapl"] });
        const result = (0, state_js_1.setMark)(state, 'sz000001', 'holding', true);
        strict_1.default.equal(result.ok, false);
    });
    (0, node_test_1.it)('adds a stock to the watchlist (idempotent)', () => {
        const state = (0, state_js_1.normalizeState)({ stocks: ["sh600000", "hk00700", "usr_aapl"] });
        (0, state_js_1.addStock)(state, 'sh600000');
        const again = (0, state_js_1.addStock)(state, 'sh600000');
        strict_1.default.equal(again.ok, true);
        strict_1.default.equal(state.stocks.filter((code) => code === 'sh600000').length, 1);
    });
    (0, node_test_1.it)('removes a stock from watchlist, groups and marks', () => {
        const state = (0, state_js_1.normalizeState)({ stocks: ["sh600000", "hk00700", "usr_aapl"] });
        (0, state_js_1.addStock)(state, 'sh600000');
        (0, state_js_1.createGroup)(state, '银行', 'A');
        (0, state_js_1.moveStockToGroup)(state, 'sh600000', state.groups[0].id);
        (0, state_js_1.setMark)(state, 'sh600000', 'watch', true);
        (0, state_js_1.setMark)(state, 'sh600000', 'focus', true);
        const result = (0, state_js_1.removeStock)(state, 'sh600000');
        strict_1.default.equal(result.ok, true);
        strict_1.default.ok(!state.stocks.includes('sh600000'));
        strict_1.default.deepEqual(state.groups[0].stockCodes, []);
        strict_1.default.deepEqual(state.watchCodes, []);
        strict_1.default.deepEqual(state.focusCodes, []);
    });
});
(0, node_test_1.describe)('state store persistence', () => {
    (0, node_test_1.it)('saves and reloads state atomically', () => __awaiter(void 0, void 0, void 0, function* () {
        const dir = yield (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), 'leek-fund-test-'));
        try {
            const path = (0, node_path_1.join)(dir, 'state.json');
            const store = (0, state_js_1.createStateStore)(path);
            const saved = yield store.mutate((state) => (0, state_js_1.addStock)(state, 'sh600000'));
            strict_1.default.ok(saved.stocks.includes('sh600000'));
            strict_1.default.equal(store.path, path);
            const loaded = yield store.load();
            strict_1.default.ok(loaded.stocks.includes('sh600000'));
            strict_1.default.equal(loaded.schemaVersion, 2);
            // No leftover temp files after an atomic write.
            const entries = yield (0, promises_1.readFile)(path, 'utf8');
            strict_1.default.ok(entries.includes('sh600000'));
        }
        finally {
            yield (0, promises_1.rm)(dir, { recursive: true, force: true });
        }
    }));
    (0, node_test_1.it)('falls back to defaults for a missing file', () => __awaiter(void 0, void 0, void 0, function* () {
        const dir = yield (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), 'leek-fund-test-'));
        try {
            const store = (0, state_js_1.createStateStore)((0, node_path_1.join)(dir, 'nope', 'state.json'));
            const state = yield store.load();
            strict_1.default.deepEqual(state.stocks, (0, state_js_1.defaultState)().stocks);
        }
        finally {
            yield (0, promises_1.rm)(dir, { recursive: true, force: true });
        }
    }));
});
