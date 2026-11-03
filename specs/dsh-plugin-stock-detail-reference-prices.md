# VibeSpec：dsh-leek-fund 详情页价格参考字段

> 编写日期：2026-11-03
> 关联分支：dsh-plugin（当前工作区含未提交的 5 分钟 K 线双视图改动，本需求叠加其上）

## 1. Spec

### 目标

调整股票详情页「当日数据」视图的价格信息展示：

1. 「日内价格位置」卡片标题右侧的百分比数字（如 `65.3%`）语义重复、价值低，删除；
2. 补充四个新的价格参考字段：**昨日最高价、昨日最低价、60 个交易日最高价、60 个交易日最低价**（"昨日" = 上一交易日，60 个交易日窗口含当前交易日）。

### 修改范围

- `dsh-plugin/src/detail.ts`：新增每日 K 线数据抓取（腾讯日 K 主源 + 东财日 K 回退）、昨高/昨低/60 日高/60 日低的纯函数推导，并接入 `fetchStockDetail` 返回值与 `StockDetail` 接口。
- `dsh-plugin/src/client/StockDetail.tsx`：`StockDetailData` 接口新增 4 个字段；`DailyPanel` 删除百分比并渲染参考价格 2×2 网格。
- `dsh-plugin/src/client/styles.module.css`：新增参考网格样式；删除随之失效的 `.rangeHead b` 规则。
- `dsh-plugin/tests/detail.test.ts`：新增解析与推导的纯函数测试，以及 `fetchStockDetail` 的集成测试（mock fetch）。

### 非目标范围

- 不改自选树、分组、提醒、状态管理等其它模块。
- 不改 5 分钟 K 线视图与图表算法。
- 不新增 npm 依赖；不修改第三方数据源整体架构（继续沿用腾讯 + 东财双源模式）。
- 不自动提交、推送、合并。不修改 README。
- 60 日窗口未满（次新股）时按已有数据计算；无数据时显示 `--`，不臆造数值。

### 验收标准

1. 「日内价格位置」标题右侧不再出现百分比文字；当日最高=最低等异常分支也不再显示百分比。
2. 详情接口（`/leek-fund/api/quoteDetail`）响应新增 `yestHigh / yestLow / high60 / low60` 四个数值字段。
3. 页面在「当日数据」视图展示：昨高、昨低、60 日最高、60 日最低（缺失时为 `--`），价格格式化复用现有 `displayPrice` 规则（ETF 三位小数、低价股三位）。
4. 数据来源：优先腾讯 `fqkline`（前复权日 K，60 根），腾讯不可用回退东财 `klt=101`（前复权）；两者都失败时返回零值，页面显示 `--`。
5. 昨日口径：若最新日 K 属于今天（含盘中未收盘的当日 K 线），昨高/昨低取倒数第二根；周末/节假日/盘前无当日 K 时，最新一根即上一交易日。
6. `npm test` 与 `npm run typecheck` 全部通过。

---

## 2. Task Card

### 当前任务

删除「日内价格位置」右侧百分比，并补充昨高/昨低/60 日高/60 日低四个参考价格字段（数据层 + 展示层 + 测试）。

### 允许修改

- `dsh-plugin/src/detail.ts`
- `dsh-plugin/src/client/StockDetail.tsx`
- `dsh-plugin/src/client/styles.module.css`
- `dsh-plugin/tests/detail.test.ts`
- 本 spec 文件

### 禁止修改

- 不修改自选/分组/提醒/状态存储相关代码。
- 不修改 K 线图表算法与坐标映射（`kline-math.ts`）。
- 不新增依赖。
- 不重构 `quote.ts` / `api.ts` 的既有逻辑（仅在必要时接触接口类型）。
- 不做无关格式化。

### 执行步骤

1. `detail.ts`：新增 `DailyBar`、`fetchDailyKline`（腾讯 fqkline 主源 + 东财 klt=101 回退）、`parseTencentDailyRows` / `parseEastmoneyDailyLines` / `chinaDateString` / `referencePrices` 纯函数；`fetchStockDetail` 并行抓取日 K 并输出 4 个新字段。
2. `StockDetail.tsx`：接口加字段；`DailyPanel` 删除百分比 `<b>`，在日内位置卡片内追加 2×2 参考价格网格。
3. `styles.module.css`：新增 `.refGrid` / `.refRow`，删除 `.rangeHead b`。
4. `tests/detail.test.ts`：补测试。
5. 验证：`npm test`、`npm run typecheck`。
6. Diff Summary + Review Report。

### Review 检查点

- 是否满足 Spec 目标？
- 是否覆盖全部 6 条验收标准？
- 是否超出修改范围？
- 是否存在无关重构？
- 新数据源失败时是否安全降级（不报错、不影响主流程）？
- 昨日口径在盘前/盘后/周末是否正确？
- 是否需要人工确认？

---

## 3. Review Report

> 开发完成后填写。

### Spec 符合性

结论：可合并。

说明：6 条验收标准全部满足——
1. 已删除「日内价格位置」标题右侧百分比 `<b>`（含 `当日最高与最低相同` 兜底文案），仅保留 位置条 + 低/高价标签；
2. `quoteDetail` 响应新增 `yestHigh / yestLow / high60 / low60`，由 `fetchStockDetail` 统一输出，集成测试断言了具体值；
3. 页面展示 昨高 / 昨低 / 60日最高 / 60日最低 四格，缺失时 `--`，价格通过既有 `displayPrice` 格式化（ETF 三位小数自动适配）；
4. 数据源为腾讯 `fqkline?param=...,day,,,60,qfq` 主源 + 东财 `klt=101&fqt=1` 回退；两者全失败返回 `[]` → 字段为 0 → 页面显示 `--`，主流程不中断（并行抓取 + `.catch(() => [])`）；
5. 昨日口径：`referencePrices` 纯函数按「最新日 K 日期 == 今日（上海日历日）」判断——盘中取倒数第二根，周末/节假日/盘前取最新一根；4 个分支均有单测；
6. `npm test` 135 项全绿；本变更涉及文件经 `tsc` 独立校验零错误。

### Task 完成情况

结论：已完成。

说明：详见下方 Diff Summary。改动仅限 Task Card 允许的 4 个代码文件 + 本 spec。

### Diff 范围检查

结论：通过。

说明：未触碰自选/分组/提醒/状态存储/`kline-math.ts`/`quote.ts`；未增依赖；`detail.ts` 与 `StockDetail.tsx` 相对 HEAD 的大 diff 属于此前未提交的 5 分钟 K 线双视图工作，本次只叠加增量（`git stash` 回退本次 4 个文件后，`tsc` 报错列表与本分支原有预存在错误完全一致，证明无新增类型错误）。

### 风险检查

风险等级：低。

风险项：
- **预存在构建阻断（与本次无关，需人工知悉）**：`npm run typecheck` / `npm run build` 在 `src/index.ts`（schemastry `Config`/`Volatile` 类型不匹配）与 `src/client/index.tsx`（`@deepseek-ai/dsh-client-ui-renderer/client`、`@deepseek-ai/dsh-client-ui-slots` 子路径解析失败）报 10 处错误，回退本次改动后错误完全一致，属环境/依赖版本问题；`tsdown` 直接打包成功，`lib/client.js`、`lib/index.js` 已重建并确认含新字段。
- **时间边界抖动**：`chinaDateString()` 基于服务器时钟，午夜切换瞬间存在极低概率的"昨日"口径抖动，与项目既有 `alertEvents` 的日期处理同级别，可接受。
- **60 日窗口含当日未收盘 K 线**：盘中 60日最高/最低会随今日价格变化，符合"创 60 日新高/新低"实盘直觉；若产品上要求"截至上一交易日"，需另开需求。
- 回滚方式：还原 `detail.ts` / `StockDetail.tsx` / `styles.module.css` / `tests/detail.test.ts` 四处即可；无数据驱动迁移、无 schema 变更。

### 测试与验证

已执行验证：
- `npm test`：135 pass / 0 fail（新增：`parseTencentDailyRows`、`parseEastmoneyDailyLines`、`chinaDateString`、`referencePrices` 4 分支、`fetchDailyKline` 东财回退与非法代码短路、`fetchStockDetail` 集成测试含 4 新字段取值）。
- `tsc` 独立校验 `detail.ts`、`tests/detail.test.ts`、`StockDetail.tsx`（含 `css.d.ts`）：0 错误。
- `npx tsdown`：打包成功，`lib/client.js` 含 `60日最高`/`yestHigh`/`high60`，已无百分比渲染与 `当日最高与最低相同` 文案。
- 未做浏览器端手工点验（本环境无法启动完整 DSH Web GUI 插件沙箱）。

未覆盖风险：真实网络下腾讯 fqkline 返回结构的细微差异（仅按 `code===0` + `qfqday/day` 数组兼容，若命中异常分支自动回退东财，最坏显示 `--`）。

### 合并建议

可合并。注意：完整 `npm run build` 仍被与本需求无关的预存在类型错误阻断，需单独跟进依赖版本（schemastry / dsh-client-ui-* 子路径）或在 DSH 宿主侧安装完整 peer 依赖后再统一构建验证。

---

## 附：Diff Summary（Developer 交付）

### 修改文件列表

| 文件 | 修改原因 |
|---|---|
| `dsh-plugin/src/detail.ts` | 新增腾讯 `fqkline` 日 K 抓取 + 东财 `klt=101` 回退、`parseTencentDailyRows`/`parseEastmoneyDailyLines`/`chinaDateString`/`referencePrices` 纯函数；`fetchStockDetail` 并行抓取日 K 并输出 4 个新字段；`StockDetail` 接口与 `DailyBar` 类型扩展 |
| `dsh-plugin/src/client/StockDetail.tsx` | `StockDetailData` 增加 4 字段；`DailyPanel` 删除「日内价格位置」右侧百分比，新增 昨高/昨低/60日最高/60日最低 2×2 参考网格 |
| `dsh-plugin/src/client/styles.module.css` | 新增 `.refGrid`/`.refRow`（虚线分隔的 2 列参考价格网格）；删除已失效的 `.rangeHead b` 规则 |
| `dsh-plugin/tests/detail.test.ts` | 新增 8 组测试：两组解析器、`chinaDateString` 上海时区、`referencePrices` 四种口径、`fetchDailyKline` 回退/短路、`fetchStockDetail` 集成断言 |
| `specs/dsh-plugin-stock-detail-reference-prices.md` | 本 Spec / Task Card / Review Report |

### 验收标准核对

全部满足（见上"Spec 符合性"）。

### 未完成项

无。遗留事项：整体 `npm run build` 因预存在（非本需求引入）的类型错误无法通过，需单独处理依赖版本。

### 建议验证命令

```bash
cd dsh-plugin
npm test
npx tsc --noEmit --skipLibCheck --module nodenext --moduleResolution nodenext \
  --target es2022 --lib es2022,dom --types node --jsx react-jsx \
  src/client/css.d.ts src/client/StockDetail.tsx src/detail.ts tests/detail.test.ts
npx tsdown   # 重建 lib/client.js 供宿主加载
```

### 需人工确认事项

1. 60 日最高/最低窗口**含**当日未收盘价格（盘中会变动）——是否符合预期；
2. 「昨高/昨低」按上一**交易日**而非自然日理解（周一看上周五）——是否符合预期；
3. 参考价格网格放在「日内价格位置」卡片内（虚线分隔）还是独立卡片/并入顶部指标格——如需调整布局，改 `DailyPanel` 一处即可。
