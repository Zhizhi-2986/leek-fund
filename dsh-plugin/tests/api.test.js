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
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = require("node:assert/strict");
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const state_js_1 = require("../src/state.js");
const api_js_1 = require("../src/api.js");
function mockReq(body, method = 'POST') {
    const payload = JSON.stringify(body);
    let sent = false;
    return {
        method,
        url: '/leek-fund/api/x',
        headers: { host: '127.0.0.1:3080' },
        [Symbol.asyncIterator]: function () {
            return __asyncGenerator(this, arguments, function* () {
                if (!sent) {
                    sent = true;
                    yield yield __await(Buffer.from(payload));
                }
            });
        },
    };
}
function mockRes() {
    const captured = { status: 0, body: '' };
    return {
        res: {
            writeHead(status) {
                captured.status = status;
            },
            end(body) {
                captured.body = String(body !== null && body !== void 0 ? body : '');
            },
        },
        status: () => captured.status,
        json: () => JSON.parse(captured.body),
    };
}
function withStore(fn) {
    return __awaiter(this, void 0, void 0, function* () {
        const dir = yield (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), 'leek-api-'));
        try {
            const store = (0, state_js_1.createStateStore)((0, node_path_1.join)(dir, 'state.json'));
            return yield fn({ store, timeoutMs: 8000 });
        }
        finally {
            yield (0, promises_1.rm)(dir, { recursive: true, force: true });
        }
    });
}
(0, node_test_1.describe)('isTrustedApiRequest', () => {
    (0, node_test_1.it)('accepts loopback hosts', () => {
        const req = { headers: { host: '127.0.0.1:3080' } };
        strict_1.default.equal((0, api_js_1.isTrustedApiRequest)(req), true);
        const local = { headers: { host: 'localhost' } };
        strict_1.default.equal((0, api_js_1.isTrustedApiRequest)(local), true);
    });
    (0, node_test_1.it)('rejects foreign hosts', () => {
        const req = { headers: { host: 'evil.example.com' } };
        strict_1.default.equal((0, api_js_1.isTrustedApiRequest)(req), false);
    });
});
(0, node_test_1.describe)('mutate endpoint', () => {
    (0, node_test_1.it)('adds a stock and returns ok', () => withStore((deps) => __awaiter(void 0, void 0, void 0, function* () {
        const { res, status, json } = mockRes();
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'add', args: { code: 'sh600000' } }), res, '/leek-fund/api/mutate');
        strict_1.default.equal(status(), 200);
        strict_1.default.deepEqual(json(), { ok: true });
        const state = yield deps.store.load();
        strict_1.default.ok(state.stocks.includes('sh600000'));
    })));
    (0, node_test_1.it)('returns ok:false with a message on failure', () => withStore((deps) => __awaiter(void 0, void 0, void 0, function* () {
        const { res, status, json } = mockRes();
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'add', args: { code: 'bogus' } }), res, '/leek-fund/api/mutate');
        strict_1.default.equal(status(), 200);
        const body = json();
        strict_1.default.equal(body.ok, false);
        strict_1.default.ok(typeof body.error === 'string' && body.error.length > 0);
    })));
    (0, node_test_1.it)('rejects an unknown op', () => withStore((deps) => __awaiter(void 0, void 0, void 0, function* () {
        const { res, status, json } = mockRes();
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'nope', args: {} }), res, '/leek-fund/api/mutate');
        strict_1.default.equal(status(), 200);
        strict_1.default.equal(json().ok, false);
    })));
    (0, node_test_1.it)('groupCreate returns the new group id', () => withStore((deps) => __awaiter(void 0, void 0, void 0, function* () {
        const { res, json } = mockRes();
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'groupCreate', args: { name: '光通信', category: 'A' } }), res, '/leek-fund/api/mutate');
        const body = json();
        strict_1.default.equal(body.ok, true);
        strict_1.default.ok(typeof body.data.id === 'string');
        const group = (yield deps.store.load()).groups[0];
        strict_1.default.equal(body.data.id, group.id);
    })));
    (0, node_test_1.it)('creates, renames, moves and deletes a group', () => withStore((deps) => __awaiter(void 0, void 0, void 0, function* () {
        const add = mockRes();
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'add', args: { code: 'sh600000' } }), add.res, '/leek-fund/api/mutate');
        const create = mockRes();
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'groupCreate', args: { name: '银行', category: 'A' } }), create.res, '/leek-fund/api/mutate');
        strict_1.default.equal(create.json().ok, true);
        const group = (yield deps.store.load()).groups[0];
        const move = mockRes();
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'groupMove', args: { code: 'sh600000', groupId: group.id } }), move.res, '/leek-fund/api/mutate');
        strict_1.default.equal(move.json().ok, true);
        strict_1.default.deepEqual((yield deps.store.load()).groups[0].stockCodes, ['sh600000']);
        const rename = mockRes();
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'groupRename', args: { id: group.id, name: '银行新' } }), rename.res, '/leek-fund/api/mutate');
        strict_1.default.equal(rename.json().ok, true);
        strict_1.default.equal((yield deps.store.load()).groups[0].name, '银行新');
        const del = mockRes();
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'groupDelete', args: { id: group.id } }), del.res, '/leek-fund/api/mutate');
        strict_1.default.equal(del.json().ok, true);
        strict_1.default.equal((yield deps.store.load()).groups.length, 0);
        strict_1.default.ok((yield deps.store.load()).stocks.includes('sh600000'));
    })));
    (0, node_test_1.it)('toggles holding mark and status bar', () => withStore((deps) => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'add', args: { code: 'sh600000' } }), mockRes().res, '/leek-fund/api/mutate');
        const mark = mockRes();
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'mark', args: { code: 'sh600000', mark: 'holding', value: true } }), mark.res, '/leek-fund/api/mutate');
        strict_1.default.equal(mark.json().ok, true);
        strict_1.default.deepEqual((yield deps.store.load()).holdingCodes, ['sh600000']);
        const focus = mockRes();
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'mark', args: { code: 'sh600000', mark: 'focus', value: true } }), focus.res, '/leek-fund/api/mutate');
        strict_1.default.equal(focus.json().ok, true);
        strict_1.default.deepEqual((yield deps.store.load()).focusCodes, ['sh600000']);
        const ticker = mockRes();
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'statusBar', args: { code: 'sh600000', value: true } }), ticker.res, '/leek-fund/api/mutate');
        strict_1.default.equal(ticker.json().ok, true);
        strict_1.default.deepEqual((yield deps.store.load()).statusBarStockCodes, ['sh600000']);
    })));
});
(0, node_test_1.describe)('reorder endpoint', () => {
    (0, node_test_1.it)('reorders a stock within a group', () => withStore((deps) => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'add', args: { code: 'sh600000' } }), mockRes().res, '/leek-fund/api/mutate');
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'add', args: { code: 'sh600001' } }), mockRes().res, '/leek-fund/api/mutate');
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'groupCreate', args: { name: '银行' } }), mockRes().res, '/leek-fund/api/mutate');
        const group = (yield deps.store.load()).groups[0];
        for (const code of ['sh600000', 'sh600001']) {
            yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'groupMove', args: { code, groupId: group.id } }), mockRes().res, '/leek-fund/api/mutate');
        }
        const { res, json } = mockRes();
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ kind: 'stock', args: { code: 'sh600001', targetGroupId: group.id, beforeCode: 'sh600000' } }), res, '/leek-fund/api/reorder');
        strict_1.default.equal(json().ok, true);
        strict_1.default.deepEqual((yield deps.store.load()).groups[0].stockCodes, ['sh600001', 'sh600000']);
    })));
    (0, node_test_1.it)('rejects a cross-market stock reorder', () => withStore((deps) => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'add', args: { code: 'hk00700' } }), mockRes().res, '/leek-fund/api/mutate');
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ op: 'groupCreate', args: { name: 'A股组' } }), mockRes().res, '/leek-fund/api/mutate');
        const group = (yield deps.store.load()).groups[0];
        const { res, json } = mockRes();
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({ kind: 'stock', args: { code: 'hk00700', targetGroupId: group.id } }), res, '/leek-fund/api/reorder');
        strict_1.default.equal(json().ok, false);
    })));
});
(0, node_test_1.describe)('route validation', () => {
    (0, node_test_1.it)('405 for non-POST', () => withStore((deps) => __awaiter(void 0, void 0, void 0, function* () {
        const { res, status } = mockRes();
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({}, 'GET'), res, '/leek-fund/api/mutate');
        strict_1.default.equal(status(), 405);
    })));
    (0, node_test_1.it)('404 for unknown method', () => withStore((deps) => __awaiter(void 0, void 0, void 0, function* () {
        const { res, status } = mockRes();
        yield (0, api_js_1.handleApiRequest)(deps, mockReq({}), res, '/leek-fund/api/nope');
        strict_1.default.equal(status(), 404);
    })));
    (0, node_test_1.it)('400 for invalid JSON', () => withStore((deps) => __awaiter(void 0, void 0, void 0, function* () {
        let sent = false;
        const req = {
            method: 'POST',
            url: '/leek-fund/api/mutate',
            headers: { host: '127.0.0.1' },
            [Symbol.asyncIterator]: function () {
                return __asyncGenerator(this, arguments, function* () {
                    if (!sent) {
                        sent = true;
                        yield yield __await(Buffer.from('not json'));
                    }
                });
            },
        };
        const { res, status } = mockRes();
        yield (0, api_js_1.handleApiRequest)(deps, req, res, '/leek-fund/api/mutate');
        strict_1.default.equal(status(), 400);
    })));
});
