# dsh-plugin 个股详情：分时图改为 5 分钟蜡烛图

## 1. Spec

### 背景

点击自选股展开行情详情时，目前展示的是「分时图」（SVG 折线 + 均价线，依赖腾讯分时 API）。
用户希望该图表改为**5 分钟 K 线（蜡烛图）**。

### 目标

1. 展开个股详情时，图表区域展示**当日 5 分钟 K 线蜡烛图**（红涨绿跌，含上/下影线），不再展示分时折线图。
2. 数据源与现状保持同级可靠性：主源腾讯 mkline 接口（一次请求同时带回 5 分钟 K 线 + 昨收/涨跌停价/名称），腾讯不可用时回退东方财富 klt=5 接口 + 涨跌停价兜底。
3. 详情数据中移除分时相关字段与能力（分时点、VWAP 均价），界面上的「均价」统计项随之移除，改为「开盘」价。
4. 详情统计区调整为两行（第二轮需求）：
   - 第一行：**涨停 / 跌停 / 昨收 / 开盘 / 最高 / 最低**（原「流通市值 / 量比」不再展示）；
   - 第二行：**MA5 / MA10 / MA20 / MA30 / MA60**（均为按日收盘价计算的均线，MA30/MA60 为新增）。
5. 数据缺失/异常时显示友好提示，不白屏（客户端对 `kline5`/`ma` 缺失做防御取值）。

### 修改范围

- `dsh-plugin/src/detail.ts`：`MinutePoint` 拆分为 `KlineBar`（time/open/close/high/low/volume）；新增 `fetchTencentM5` 与 `fetchEastmoneyM5`；`fetchStockDetail` 组装 `kline5`（仅保留最近一个交易日的 bar），移除分时获取逻辑；日线拉取数量 30 → 70，`ma` 新增 `ma30`/`ma60`。
- `dsh-plugin/src/client/StockDetail.tsx`：`StockDetailData` 的 `minute` 改为 `kline5`；`MinuteChart` 重写为 `KlineChart`（SVG 蜡烛图：动态价格 Y 轴 + 昨收 0 轴参考 + 百分比/价格双刻度 + 涨跌停参考线 + 时间轴），与现有 300×180 版式一致；统计两行改为「涨停 跌停 昨收 开盘 最高 最低」/「MA5 MA10 MA20 MA30 MA60」，移除流通市值/量比与均线提示文字，`kline5`/`ma` 缺失时防御取值不崩溃。
- `dsh-plugin/src/api.ts`：仅更新两处引用旧「minute API」的过时注释，无行为变更。
- `dsh-plugin/tests/detail.test.ts`：为新解析/过滤纯函数补充单测；补充 MA30/60 窗口单测。
- `specs/dsh-plugin-stock-kline5.md`：本文件。

### 非目标范围

- 不改动行情列表、涨速榜、分组、持仓/关注等业务逻辑。
- 不新增成交量副图、不引入图表库依赖（继续手写 SVG）。
- 不修改详情缓存策略；不新增网络请求数量（日线 1 次请求，数量参数 30→70 属同一请求）。
- 不自动 commit/push/merge。

### 验收标准

1. 展开个股详情显示蜡烛图：每根蜡烛含实体与影线，close ≥ open 为红（`#e02e24`）、close < open 为绿（`#2e9e4f`）。
2. 图表只展示最近一个交易日的 5 分钟 bar（≤48 根），时间轴标注 9:30 / 10:30 / 11:30/13:00 / 14:00 / 15:00。
3. Y 轴范围由当日最高/最低（并纳入昨收）动态确定，左侧百分比刻度、右侧价格刻度、昨收 0 轴参考线、涨跌停参考线仍在。
4. 详情统计行不再出现「均价」，出现「开盘」。
5. 腾讯或东财任一数据源可用时图表正常；均不可用时显示友好提示，不抛异常。
6. `cd dsh-plugin && npm test` 全部通过；`npm run bundle` 构建成功（`npm run typecheck` 在本机存在与本次改动无关的既有报错：宿主 peer 依赖 `@deepseek-ai/*` 解析到应用目录的无类型声明版本，基线 HEAD 同样失败）。

---

## 2. Task Card

### 当前任务

把个股详情的分时图替换为 5 分钟蜡烛图（数据源 + 渲染 + 统计行调整）。

### 允许修改

- `dsh-plugin/src/detail.ts`
- `dsh-plugin/src/client/StockDetail.tsx`
- `dsh-plugin/tests/detail.test.ts`
- `specs/dsh-plugin-stock-kline5.md`

### 禁止修改

- `dsh-plugin/src/index.ts`、`dsh-plugin/src/client/index.tsx`（进行中的 Tab 注册位置改动，本任务不触碰）
- 行情列表 / 涨速榜 / 分组 / 标记 / 搜索等其它模块
- `dsh-plugin/package.json`、构建配置、其它插件
- 不自动 commit/push/merge

### 执行步骤

1. `detail.ts`：定义 `KlineBar`；实现腾讯 mkline 解析（复用 qt 元数据提取昨收/涨跌停/名称，时间支持 `YYYYMMDDHHMM` 与 `YYYY-MM-DD HH:MM` 两种形态）。
2. `detail.ts`：实现东财 klt=5 回退源；提取纯函数 `normalizeKlineTime` 与 `barsForLatestDate` 便于单测。
3. `detail.ts`：`fetchStockDetail` 改为并行获取腾讯 m5 + 新浪日 K；腾讯为空时回退东财 m5 + qt.gtimg 涨跌停价；返回 `kline5`（最近交易日 bar 集合）+ `open`；删除分时/VWAP 代码。
4. `StockDetail.tsx`：接口与组件重写为 `KlineChart` 蜡烛图；统计行「均价」→「开盘」。
5. `detail.test.ts`：为新增纯函数补测试。
6. 本地验证 `typecheck` / `test` / `bundle`，人工过一遍 diff 填写 Review Report。

### Review 检查点

- 腾讯与东财两套 parser 的字段序是否与真实接口一致（open, close, high, low, volume）。
- 蜡烛颜色方向是否符合 A 股习惯（红涨绿跌）；Y 轴是否包含昨收 0 轴。
- 时间轴跨日过滤逻辑（`barsForLatestDate`）是否正确。
- 是否残留分时图 / 均价相关死代码。
- 是否超出允许修改范围；`typecheck` / `test` / `bundle` 是否通过。

---

## 3. Review Report

### 验证结果

- `npm test`：79/79 通过（含新增 5 条：`normalizeKlineTime` ×3、`barsForLatestDate` ×2）。
- `npm run bundle`：成功（lib/index.js + lib/client.js）。
- `npm run typecheck`：本机存在与本次改动无关的既有失败（宿主 peer 依赖 `@deepseek-ai/*` 解析到应用目录的无类型版本，基线 HEAD f73f9ee 同样失败）；报错仅出现在 `index.ts(x)`，本次改动的 4 个文件零报错。
- 真机数据验证（当日实时行情 sh600519）：
  - 腾讯 mkline 主源：60 根 bar 完整解析，昨收/开盘/涨跌停/名称从 qt 正确提取；按最近交易日过滤后 44 根（09:35–14:40 进行中），符合预期。
  - 东财 klt=5 回退源：字段序（date,open,close,high,low,volume）解析正确。
  - `fetchStockDetail` 组装正确：price=最后一根收盘 1330.85，open/high/low/yestclose/涨跌停/MA5/10/20 均正确。
  - 图表几何数值校验：46 根蜡烛 + 影线全部落在绘图区（x 52.8–248.9 ⊆ [50,256]；y 22.2–144.2 ⊆ [10,152]），红 25 / 绿 21，无越界、无退化实体，时间轴/刻度文字均在画布内。

### Review 结论：**需人工确认**（仅一项小决策，无缺陷）

| 检查项 | 结果 |
|---|---|
| Spec 目标（蜡烛图替换分时图） | 满足 |
| 验收标准 1–6 | 全部满足（typecheck 例外为环境既有问题，见上） |
| 非目标范围 | 未触碰行情列表/涨速/分组/标记/搜索；未新增依赖；未自动提交 |
| 允许修改范围 | 仅 detail.ts / StockDetail.tsx / api.ts（注释）/ detail.test.ts / 本 spec |
| 无关重构 | 无；删除分时/VWAP 属「清除多余能力」，与本改动直接相关 |
| 死代码残留 | 无（分时相关代码与注释已全部清除） |
| 风险 | 无兼容性风险（详情接口仅在插件内部消费，同一插件两端同步改）；无性能风险（网络调用数与改造前相同：主源 1 次 + 日 K 1 次，回退路径 2 次并行）；无安全风险（无鉴权/输入面变更） |

**需人工确认项**：

1. **统计行「均价」→「开盘」**：均价由已删除的分时/VWAP 数据计算，故随分时图一并移除；为保持统计行信息密度，改用数据已有的「开盘」价。如不需要开盘可改回只保留其余项。
2. **已知既有问题（非本次改动引入）**：`fetchEastMoneyExtraQuotes` 依赖的 `push2.eastmoney.com` 在本机网络环境不可达，导致「流通市值 / 量比」可行为 0 而不展示（UI 已有 `>0` 兜底）；该函数与 URL 未在本任务中改动。如需修复可另立任务。

### 验证命令

```bash
cd dsh-plugin && npm test && npm run bundle
```

### 缺陷修复（2026-10-23 白屏，已修复）

**现场**：点击个股展开详情 → 整个「行情」Tab 白屏。桌面日志 `dsh-2026-10-23.error.log` 14:58 记录：
`slot entry crashed in 'conversation.view': TypeError: Cannot read properties of undefined (reading 'length')`。

**根因**：客户端与服务端版本错位。host 日志显示 leek-fund 服务端（`lib/index.js`）最后加载于 09:17（应用启动时），bundle 重建（14:38）不会热重载正在运行的 host；渲染进程刷新后拿到的是新客户端代码（访问 `detail.kline5`），而运行中的旧服务端返回旧结构（只有 `minute`，无 `kline5`）→ `kline5.length` 对 undefined 取值 → 渲染崩溃 → 整个 slot 白屏。

**修复**（`dsh-plugin/src/client/StockDetail.tsx`）：
1. 防御性取值：`Array.isArray(detail.kline5) ? detail.kline5 : []`，数据缺失时显示「暂无K线数据」提示，不再崩溃。
2. 移除 `useMemo`（原写法在条件 return 之后调用 hook，违反 React Rules of Hooks，是潜在白屏雷），`buildYRange` 计算量极小直接内联。

**恢复步骤**：完全退出并重启 DSH Desktop（让 host 加载新 `lib/index.js`），再打开「行情」Tab 点击个股。

**遗留建议（未实施，避免触碰进行中的 index.tsx 改动）**：给行情 Tab 内容包一层错误边界，任何详情渲染异常都只降级该区域而非整体白屏。

---

### 第二轮：统计行调整 + MA30/60（2026-10-23，已完成）

**需求**：第一行「涨停 跌停 昨收 开盘 最高 最低」；第二行「MA5 MA10 MA20 MA30 MA60（日线均值）」。

**改动**：
- `detail.ts`：`ma` 类型新增 `ma30`/`ma60`；`fetchDailyKline` 数量 30 → 70（MA60 需要 ≥60 根收盘价，70 留余量，仍为同一请求）；`calcMA(closes, 30/60)` 组装。
- `StockDetail.tsx`：统计行改写为指定的两行；移除「流通市值 / 量比」展示与 `fmtAmount`（`detail.circulatingMarketCap`/`volumeRatio` 服务端仍返回，仅不再展示）；MA 行对 `detail.ma` 缺失做防御（`detail.ma ?? {}` + `!= null` 判空）；客户端 `StockDetailData.ma` 同步新增 ma30/ma60。
- `tests/detail.test.ts`：新增 MA30/60 窗口单测（70 根收盘价 → MA30=154.5 / MA60=139.5；59 根时 MA60 为 null）。

**验证结果**：`npm test` 80/80 通过；`npm run bundle` 成功；真机 smoke（sh600519）ma5=1324.01 / ma10=1311.09 / ma20=1280.97 / ma30=1283.39 / ma60=1299.15，kline5=48 根。

**Review 结论：可合并**（本轮改动均按用户明确指定的两行布局执行，无新的待确认决策）。

**关于「暂无K线数据」**：客户端已按防御逻辑显示提示而非白屏；根因是运行中的 host 仍加载旧服务端代码（最后加载 09:17），**需完全退出并重启 DSH Desktop** 使 host 加载新 `lib/index.js`（实时 smoke 已确认腾讯主源在本机可取 48 根 bar，重启后即可正常出图）。

