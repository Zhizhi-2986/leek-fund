"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = require("node:assert/strict");
const state_js_1 = require("../src/state.js");
function baseState() {
    return (0, state_js_1.normalizeState)({ stocks: ['sh600000', 'sh600001', 'sh600002', 'hk00700'] });
}
(0, node_test_1.describe)('reorderStock', () => {
    (0, node_test_1.it)('reorders within a group', () => {
        const state = baseState();
        (0, state_js_1.addStock)(state, 'sh600000');
        (0, state_js_1.addStock)(state, 'sh600001');
        (0, state_js_1.createGroup)(state, '银行', 'A');
        const group = state.groups[0];
        group.stockCodes = ['sh600000', 'sh600001'];
        const result = (0, state_js_1.reorderStock)(state, 'sh600001', group.id, 'sh600000');
        strict_1.default.equal(result.ok, true);
        strict_1.default.deepEqual(group.stockCodes, ['sh600001', 'sh600000']);
    });
    (0, node_test_1.it)('appends when no anchor is given', () => {
        const state = baseState();
        (0, state_js_1.addStock)(state, 'sh600000');
        (0, state_js_1.addStock)(state, 'sh600001');
        (0, state_js_1.createGroup)(state, '银行', 'A');
        const group = state.groups[0];
        group.stockCodes = ['sh600000'];
        const result = (0, state_js_1.reorderStock)(state, 'sh600000', group.id);
        strict_1.default.equal(result.ok, true);
        strict_1.default.deepEqual(group.stockCodes, ['sh600000']);
    });
    (0, node_test_1.it)('moves a stock across groups', () => {
        const state = baseState();
        (0, state_js_1.addStock)(state, 'sh600000');
        (0, state_js_1.createGroup)(state, '银行', 'A');
        (0, state_js_1.createGroup)(state, '券商', 'A');
        const [bank, broker] = state.groups;
        bank.stockCodes = ['sh600000'];
        const result = (0, state_js_1.reorderStock)(state, 'sh600000', broker.id);
        strict_1.default.equal(result.ok, true);
        strict_1.default.deepEqual(bank.stockCodes, []);
        strict_1.default.deepEqual(broker.stockCodes, ['sh600000']);
    });
    (0, node_test_1.it)('reorders within the ungroupped bucket', () => {
        const state = baseState();
        (0, state_js_1.addStock)(state, 'sh600000');
        (0, state_js_1.addStock)(state, 'sh600001');
        // Watchlist order: ... sh600000, sh600001 (ungroupped)
        const result = (0, state_js_1.reorderStock)(state, 'sh600001', undefined, 'sh600000');
        strict_1.default.equal(result.ok, true);
        strict_1.default.deepEqual(state.stocks.slice(0, 2), ['sh600001', 'sh600000']);
    });
    (0, node_test_1.it)('rejects a cross-market target group', () => {
        const state = baseState();
        (0, state_js_1.addStock)(state, 'sh600000');
        (0, state_js_1.createGroup)(state, '港股组', 'HK');
        const result = (0, state_js_1.reorderStock)(state, 'sh600000', state.groups[0].id);
        strict_1.default.equal(result.ok, false);
    });
    (0, node_test_1.it)('rejects a stock outside the watchlist', () => {
        const state = baseState();
        const result = (0, state_js_1.reorderStock)(state, 'sz000001');
        strict_1.default.equal(result.ok, false);
    });
    (0, node_test_1.it)('rejects an anchor outside the target scope', () => {
        const state = baseState();
        (0, state_js_1.addStock)(state, 'sh600000');
        (0, state_js_1.createGroup)(state, '银行', 'A');
        const result = (0, state_js_1.reorderStock)(state, 'sh600000', state.groups[0].id, 'hk00700');
        strict_1.default.equal(result.ok, false);
    });
});
(0, node_test_1.describe)('reorderGroup', () => {
    (0, node_test_1.it)('reorders sibling groups', () => {
        const state = baseState();
        (0, state_js_1.createGroup)(state, '组A', 'A');
        (0, state_js_1.createGroup)(state, '组B', 'A');
        (0, state_js_1.createGroup)(state, '组C', 'A');
        const [a, b] = state.groups;
        const result = (0, state_js_1.reorderGroup)(state, b.id, a.id);
        strict_1.default.equal(result.ok, true);
        strict_1.default.deepEqual(state.groups.filter((g) => !g.parentId).map((g) => g.id), [b.id, a.id, state.groups.find((g) => g.name === '组C').id]);
    });
    (0, node_test_1.it)('rejects reordering against a different parent level', () => {
        const state = baseState();
        (0, state_js_1.createGroup)(state, '父', 'A');
        (0, state_js_1.createGroup)(state, '子', 'A', state.groups[0].id);
        const [parent, child] = state.groups;
        const result = (0, state_js_1.reorderGroup)(state, child.id, parent.id);
        strict_1.default.equal(result.ok, false);
    });
    (0, node_test_1.it)('rejects an unknown group', () => {
        const state = baseState();
        const result = (0, state_js_1.reorderGroup)(state, 'nope');
        strict_1.default.equal(result.ok, false);
    });
});
(0, node_test_1.describe)('reorderMark', () => {
    (0, node_test_1.it)('reorders holding marks independently', () => {
        const state = (0, state_js_1.normalizeState)({ stocks: ['sh600000', 'sh600001'] });
        (0, state_js_1.addStock)(state, 'sh600000');
        (0, state_js_1.addStock)(state, 'sh600001');
        (0, state_js_1.setMark)(state, 'sh600000', 'holding', true);
        (0, state_js_1.setMark)(state, 'sh600001', 'holding', true);
        const result = (0, state_js_1.reorderMark)(state, 'holding', 'sh600001', 'sh600000');
        strict_1.default.equal(result.ok, true);
        strict_1.default.deepEqual(state.holdingCodes, ['sh600001', 'sh600000']);
    });
    (0, node_test_1.it)('reorders watch marks independently', () => {
        const state = (0, state_js_1.normalizeState)({ stocks: ['sh600000', 'sh600001'] });
        (0, state_js_1.addStock)(state, 'sh600000');
        (0, state_js_1.addStock)(state, 'sh600001');
        const result = (0, state_js_1.reorderMark)(state, 'watch', 'sh600001', 'sh600000');
        strict_1.default.equal(result.ok, true);
        strict_1.default.deepEqual(state.watchCodes, ['sh600001', 'sh600000']);
    });
    (0, node_test_1.it)('reorders focus marks independently', () => {
        const state = (0, state_js_1.normalizeState)({ stocks: ['sh600000', 'sh600001'] });
        (0, state_js_1.addStock)(state, 'sh600000');
        (0, state_js_1.addStock)(state, 'sh600001');
        (0, state_js_1.setMark)(state, 'sh600000', 'focus', true);
        (0, state_js_1.setMark)(state, 'sh600001', 'focus', true);
        const result = (0, state_js_1.reorderMark)(state, 'focus', 'sh600001', 'sh600000');
        strict_1.default.equal(result.ok, true);
        strict_1.default.deepEqual(state.focusCodes, ['sh600001', 'sh600000']);
    });
    (0, node_test_1.it)('rejects a mark not in the list', () => {
        const state = baseState();
        (0, state_js_1.addStock)(state, 'sh600000');
        const result = (0, state_js_1.reorderMark)(state, 'holding', 'sh600000', 'sh600001');
        strict_1.default.equal(result.ok, false);
    });
});
