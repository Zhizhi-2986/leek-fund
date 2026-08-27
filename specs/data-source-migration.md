# 数据源迁移方案：东方财富主 + 新浪备

## 前提

- **不需要港股、美股个股**
- **只需要 A 股（含指数、ETF）+ 少量全球指数**（usr_dji, usr_ixic, usr_inx, b_NKY 等）
- 腾讯源不需要了（港美股去掉后，腾讯接口无用）

---

## 1. 目标数据源矩阵

| 数据类型 | 主源 | 备源 | 说明 |
|----------|------|------|------|
| A 股实时行情 | **东方财富** `push2` | 新浪 `hq.sinajs.cn` | JSON vs GB18030 |
| A 股指数实时 | **东方财富** `push2` | 新浪 `hq.sinajs.cn` | sh000001/sz399xxx 等 |
| ETF 实时行情 | **东方财富** `push2` | 新浪 `hq.sinajs.cn` | 同 A 股 |
| **全球指数**（usr_*/b_*） | **新浪** `hq.sinajs.cn` | — | 唯一可用源，保留不变 |
| A 股日 K 线 | **东方财富** `kline/get` | 新浪 `getKLineData` | 统一日K |
| A 股分时 | ✅ **已在用东方财富** | — | 不动 |
| 股票搜索 | **东方财富** `suggest/get` | 腾讯 `smartbox/search` | 换主源 |
| 节假日 | ✅ timor.tech | — | 不动 |
| Binance | ✅ 独立配置 | — | 不动 |

---

## 2. 东方财富 API 速查

### 2.1 批量实时行情（替代新浪）

```
GET https://push2.eastmoney.com/api/qt/ulist.np/get
  ?fltt=2&invt=2
  &fields=f2,f3,f4,f12,f14,f15,f16,f17,f18,f9,f10,f5,f6
  &secids=1.600519,0.000001,1.000001
```

字段含义：
| 字段 | 含义 | 映射 |
|------|------|------|
| f12 | 代码 | code |
| f14 | 名称 | name |
| f2 | 最新价 | price |
| f3 | 涨跌幅% | percent |
| f4 | 涨跌额 | updown |
| f17 | 今开 | open |
| f18 | 昨收 | yestclose |
| f15 | 最高 | high |
| f16 | 最低 | low |
| f5 | 成交量 | volume |
| f6 | 成交额 | amount |

**secid 规则**（与现有分时一致）：
- `shxxxxxx` → `1.xxxxxx`
- `szxxxxxx` → `0.xxxxxx`
- `bjxxxxxx` → `0.xxxxxx`
- 全球指数（usr_/b_）→ 不支持，走新浪

### 2.2 日 K 线（替代新浪）

```
GET http://push2his.eastmoney.com/api/qt/stock/kline/get
  ?secid=1.600519
  &klt=101          ← 101=日K（已用 klt=1 是分时）
  &fqt=1
  &lmt=100
```

### 2.3 搜索（替代腾讯）

```
GET https://searchadapter.eastmoney.com/api/suggest/get
  ?input=茅台
  &count=10
  &type=14
```

---

## 3. 架构设计

### 3.1 新增 `src/data-source/` 层

```
src/data-source/
├── index.ts              # getQuotes(), getKline(), searchStocks() 统一入口
├── types.ts              # 统一类型
├── eastmoney.ts          # 东方财富全部接口封装
├── sina.ts               # 新浪接口封装（全球指数 + fallback）
```

不拆分子目录，因为每个源一个文件就够了。

### 3.2 统一调用方式

```typescript
// src/data-source/index.ts

/** 获取实时行情：东方财富主 → 新浪备 */
export async function getQuotes(codes: string[]): Promise<Map<string, QuoteResult>> {
  // 分离 A 股/指数 和 全球指数
  const aCodes = codes.filter(c => /^(sh|sz|bj)\d{6}$/.test(c))
  const globalCodes = codes.filter(c => /^(usr_|b_|gb_)/.test(c))

  const results = new Map()

  // ① A股/指数 → 东方财富（主）
  if (aCodes.length > 0) {
    try {
      const em = await eastmoneyFetchQuotes(aCodes)
      em.forEach((v, k) => results.set(k, v))
    } catch {
      // 降级到新浪
      const sina = await sinaFetchQuotes(aCodes)
      sina.forEach((v, k) => results.set(k, v))
    }
  }

  // ② 全球指数 → 新浪
  if (globalCodes.length > 0) {
    const sina = await sinaFetchQuotes(globalCodes)
    sina.forEach((v, k) => results.set(k, v))
  }

  return results
}
```

### 3.3 调用方改动示意

**`stockService.ts`** — 核心改动：
```
getData(codes)
  └─ 调用 getQuotes(codes)  // 一行替换整个新浪+腾讯逻辑
      ├─ 东方财富批量行情 → 成功则返回
      └─ 失败 → 新浪兜底
```

**`statusBar.ts`** — 指数行情：
```
fetchStatusBarIndexData()
  └─ 调用 getQuotes(indexCodes)  // 替换新浪直调
```

**`technicalAnalysis.ts`** — K 线：
```
getKlineData(code, period)
  └─ 东方财富 kline/get（klt=101/102/103） → 失败 → 新浪
```

**`tencentStock.ts`** — 搜索：
```
searchStockList(keyword)
  └─ 东方财富 suggest/get → 失败 → 腾讯备
```
注意：全球指数搜索腾讯可能不支持，东方财富也不一定支持，但保留腾讯做最后兜底。

---

## 4. 改动清单

| 文件 | 改动方式 | 风险 |
|------|----------|------|
| **新增** `src/data-source/eastmoney.ts` | 东方财富批量行情 + K 线 + 搜索 | — |
| **新增** `src/data-source/sina.ts` | 新浪行情封装（从现有抽离） | — |
| **新增** `src/data-source/types.ts` | 统一类型 | — |
| **新增** `src/data-source/index.ts` | 路由 + fallback | — |
| `src/explorer/stockService.ts` | `getData()` 改为调用 `getQuotes()` | **高**：核心逻辑 |
| `src/explorer/stockService.ts` | 删除 `getStockData()`, `getEtfData()`, `getHKStockData()` | 清理旧代码 |
| `src/shared/tencentStock.ts` | **可删除**（港美股+腾讯源都不需要了） | 需确认无其他引用 |
| `src/shared/technicalAnalysis.ts` | `getKlineData()` 加入东方财富分支 | 中 |
| `src/shared/stockDetailData.ts` | `getAStockQuoteDetail()` 改走东方财富（可选） | 低 |
| `src/statusbar/statusBar.ts` | `fetchStatusBarIndexData()` 改走 `getQuotes()` | 低 |
| `dsh-plugin/src/quote.ts` | 同步改造 | 独立 |
| `dsh-plugin/src/detail.ts` | 同步改造 | 独立 |

---

## 5. 为什么选东方财富主 + 新浪备

| 对比项 | 东方财富 | 新浪 | 腾讯 |
|--------|---------|------|------|
| 数据格式 | JSON | GB18030 文本 | GBK + JSONP |
| 批量行情 | ✅ 一次请求 | ✅ 一次请求 | ❌ 需逐个 |
| A 股支持 | ✅ | ✅ | ✅ |
| 全球指数 | ❌ | ✅ | ❌ |
| 接口稳定性 | ✅ 高 | ⚠️ 偶有超时 | ✅ 高 |
| 已有基础 | 分时已用 | 全量在用 | 港股在用 |

去掉港美股后，腾讯的唯一价值就是搜索备源，其他场景完全不需要了。

---

## 6. 实施建议

1. **Phase 1**：新建 `src/data-source/` 层，只写东方财富封装，不删旧代码
2. **Phase 2**：改 `stockService.ts` 调用新接口，旧接口代码保留但不再走
3. **Phase 3**：确认稳定运行后，清理旧代码（`getStockData`, `getEtfData`, `getTencentHKStockData`, `tencentStock.ts`）
4. **Phase 4**：改 K 线、搜索等
5. **Phase 5**：清理无用的 tsconfig exclude 等

需要的话可以从 Phase 1 开始实施。
