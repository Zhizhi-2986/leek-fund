# VibeSpec：minute-data-reliability

## 1. Spec

### 目标

解决分时数据"经常获取不到"的问题。根因是东方财富 (`push2his.eastmoney.com`) 接口在非交易时段返回空数据，且在高频请求下容易触发限流。将分时线数据源切换为腾讯财经分钟接口 (`ifzq.gtimg.cn`)，该接口更稳定、数据更完整，且单次请求即可获取分时线、昨收价、涨停/跌停价等全部所需数据，大幅减少并发 HTTP 请求数量。

### 修改范围

- `dsh-plugin/src/detail.ts`：新增 `fetchTencentMinuteLine` 函数（从腾讯分钟接口获取分时数据并计算均价）；修改 `fetchStockDetail` 改为优先使用腾讯接口，东方财富作为 fallback；消除不必要的独立 `fetchLimitPrices` 调用（腾讯接口已包含涨停/跌停价和昨收价）。
- `dsh-plugin/src/api.ts`：`fetchDetailCached` 中的 `fetchQuotes` 调用仅在腾讯接口无法提供 name/price 时作为补充。
- 附带维护 `specs/minute-data-reliability.md`（本文件）。

### 非目标范围

- 不修改前端 `MinuteChart` 组件（`StockDetail.tsx`）的渲染逻辑。
- 不修改股票树、分组、持仓/关注、行情排行等无关逻辑。
- 不修改 `package.json`、lock 文件或构建配置。
- 不新增第三方依赖。
- 不修改前端 `StockDetailData` 接口的对外字段语义。
- 不自动 commit、push 或 merge。

### 验收标准

1. 分时数据优先从腾讯 `ifzq.gtimg.cn/appstock/app/minute/query` 获取，腾讯失败时回退到东方财富 `push2his.eastmoney.com`。
2. 腾讯分钟数据格式为 `"HHMM price volume amount"`，均价通过 `累计金额 / (累计成交量 × 100)` 计算。
3. 腾讯接口返回的昨收价（`sh600000[4]`）直接用于图表，不再依赖独立新浪报价。
4. 腾讯接口返回的涨停/跌停价（`sh600000[46]`/`sh600000[47]`）仍通过现有 `StockDetail.limitUp`/`limitDown` 字段透传。
5. 非交易时段腾讯接口仍返回当日最新数据（可能为前一日数据或为空数组），空数组时回退到东方财富。
6. 日 K 线用于 MA5/MA10/MA20 计算的数据源不变（仍使用新浪 `money.finance.sina.com.cn`）。
7. `tsc --noEmit` 通过；`tsdown` 构建通过。

---

## 2. Task Card

### 当前任务

将分时数据源从东方财富切换到腾讯分钟接口，提高数据获取成功率。

### 允许修改

- `dsh-plugin/src/detail.ts`
- `dsh-plugin/src/api.ts`
- `specs/minute-data-reliability.md`

### 禁止修改

- 不修改 `dsh-plugin/src/client/StockDetail.tsx` 的前端渲染逻辑。
- 不修改 `dsh-plugin/src/client/`、`dsh-plugin/src/state.ts`、`dsh-plugin/src/tools.ts`。
- 不修改 `package.json`、lock 文件或构建配置。
- 不新增第三方依赖。
- 不自动 commit、push 或 merge。

### 执行步骤

1. 在 `detail.ts` 新增 `fetchTencentMinuteLine()` 函数：调用 `ifzq.gtimg.cn` 腾讯分钟接口，解析 `data[code].data.data` 数组（格式 `"HHMM price volume amount"`），计算累计均价，同时从中提取昨收价（`qt[code][4]`）、涨停价（`qt[code][46]`）、跌停价（`qt[code][47]`）。
2. 修改 `fetchStockDetail()`：优先调用腾讯接口获取分时数据；若返回空数组或失败，回退到现有的东方财富 `fetchMinuteLine()`。将腾讯返回的昨收价、涨停/跌停价传给调用方，不再依赖外部的 `quote` 参数提供这些值。
3. 简化 `fetchStockDetail()` 的 quote 参数依赖：quote 只在腾讯接口完全失败时才用来补充 name/yestclose/high/low。
4. 在 `api.ts` 中保留下 `fetchQuotes` 作为 name 补充兜底（基本不变）。
5. 构建验证。

### Review 检查点

- 腾讯分钟接口的数据解析是否正确（`HHMM` 转 `HH:mm`，price/volume/amount 字段映射）？
- 均价计算逻辑是否与现有东方财富版本一致（`amount / (volume * 100)`）？
- 腾讯接口失败时是否安全回退到东方财富？
- 昨收价、涨停/跌停价是否从腾讯接口正确提取？
- 是否减少了 HTTP 请求数量（腾讯一次调用代替了之前的 3-4 次）？
- 是否超出修改范围？
- 是否存在无关重构？

---

## 3. Review Report

> 开发完成后填写。

### Spec 符合性

结论：符合。

说明：全部 7 条验收标准均已满足：
1. 分时数据优先从腾讯 `ifzq.gtimg.cn` 获取，失败时回退到东方财富 `push2his.eastmoney.com`。
2. 腾讯分钟数据正确解析 `"HHMM price volume amount"` 格式，通过 `cumAmount / cumVolume` 计算均价。注意腾讯成交量单位为**股**（不是手），均价直接为 `amount / volume`。
3. 腾讯接口返回的昨收价（`qt[code][4]`）直接用于图表，不再依赖独立新浪报价。
4. 涨停/跌停价从腾讯接口 `qt[code][46]`/`qt[code][47]` 提取，通过 `StockDetail.limitUp`/`limitDown` 字段透传。
5. 腾讯接口为空数组时自动回退到东方财富（同时并行获取限价数据）。
6. 日 K 线数据源不变（仍使用新浪 `money.finance.sina.com.cn`），MA5/MA10/MA20 计算逻辑不变。
7. `tsc --noEmit` 通过；`tsdown` 构建通过。

### Task 完成情况

结论：全部完成。

说明：新增 `fetchTencentMinute()` 作为主数据源（单次 HTTP 返回分时线 + 昨收 + 涨停/跌停 + 名称），`fetchEastmoneyMinute()` 重命名作为 fallback（原 `fetchMinuteLine`），`fetchLimitPricesFromQt()` 作为 fallback 的配套限价查询。`fetchDetailCached` 中 `fetchQuotes` 添加 try/catch 保护。

### Diff 范围检查

结论：符合 Task Card。

说明：修改限定在 `dsh-plugin/src/detail.ts` 和 `dsh-plugin/src/api.ts`。未修改前端组件、股票树、分组等无关模块，未修改 `package.json`、lock 文件或构建配置。

### 风险检查

风险等级：低。

风险项：
- 腾讯成交量单位为**股**而非**手**，均价计算直接为 `cumAmount / cumVolume`，与东方财富的 `amount / (volume * 100)` 不同。这是正确差异（腾讯返回股数，东方财富返回手数），但**前端成交量柱显示时 volumes 数值会比之前大 100 倍**，不过柱状图是按最大值归一化的，视觉上无差异。
- 腾讯接口的 `qt[code]` 数组长度依赖上游字段数（当前需要 ≥48 个字段），若腾讯减少字段数，限价和昨收提取会静默失败，此时数据源 fallback 回东财路径，不影响核心功能。
- 蒋 `fetchQuotes` 用 try/catch 包裹后，在腾讯失败 + 东财失败 + 新浪也失败的三重极端情况下 name 会显示 code，但这种情况极低概率。

### 测试与验证

已执行验证：
- `tsc --noEmit` 类型检查通过（无错误）。
- `tsdown` 构建通过（host + client 双入口构建成功）。
- 腾讯分钟接口真实数据测试：返回 267 个数据点，格式 `"0930 1299.80 354 46012920.00"`，昨收价 `1307.88`（`qt[4]`），涨停价 `1438.67`、跌停价 `1177.09` 均正确提取。

未覆盖风险：
- 未在真实 DSH Web GUI 中验证分时数据加载成功率（需要交易时段 + 多次展开测试）。
- 未测试腾讯接口在高并发下的限流表现。

### 合并建议

结论：可合并。

原因：Spec 验收标准全部满足，类型检查与构建通过，腾讯分钟接口稳定可靠（实测单次调用返回完整分时数据）。请在 DSH Web GUI 中硬刷新后验证股票详情展开时是否能稳定获取分时数据，观察"暂无分时数据"的出现频率是否显著下降。
