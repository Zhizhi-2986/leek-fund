# VibeSpec：dsh-plugin-scope-cleanup

## 1. Spec

### 背景

`dsh-plugin` 分支在历次迭代中积累了三类超出「dsh-plugin 能力」范围的能力：策略选股（40 分钟定时调度 + 新浪 K 线 + 自动写入状态分组）、大盘实时概览（东方财富 ulist 数据源，VSCode 侧功能移植）、港股/美股支持（腾讯港股 + 新浪美股解析、`hk`/`usr_`/`gb_` 代码语法）。经用户确认，本次将这些能力从插件中移除，使插件收敛为 **A 股行情工具集 + 指数**；同时将「重点关注（focusCodes）」正式文档化为受支持能力，统一工具面与 UI 面的语义描述。

### 目标

- **移除策略选股**：删除 `strategy.ts`、30 分钟定时调度器、`stock_strategy_run` 工具、「策略选股」分组自动创建/更新、snapshot 中的策略状态字段、股票树中的策略分组渲染。
- **移除大盘实时概览**：删除 `/leek-fund/api/marketOverview` 路由、`fetchMarketOverview`、`MarketOverview` 类型、`StockDetail` 中的 `MarketOverviewPanel` 及样式。
- **移除港股/美股支持，保留指数**：删除 `hk`/`usr_`/`gb_` 代码语法与类别、腾讯港股行情解析、新浪美股解析；`stock_quote`/`stock_add` 等工具描述收敛为 A 股与指数；默认自选股删除港美股代码；**保留**指数（`sh*/sz*` A 股指数、`b_`/`int_` 全球指数，含平铺条日经 225 `b_NKY`、韩国 KOSPI `b_KOSPI`）。
- **文档化重点关注（focusCodes）**：保留现有交互逻辑不变；在 spec 与 README 中声明其语义边界（UI 股票树内置分组「重点关注」+ 右键菜单管理；模型工具 `stock_mark` 仅管理 holding/watch，不暴露 focus），使工具面与 UI 面在文档语义上一致。
- 存量 `state.json` 中的港美股代码/分组在下次加载时被规范化剔除（一次性数据迁移），并在文档中说明。

### 修改范围

- `dsh-plugin/src/strategy.ts`（整文件删除）
- `dsh-plugin/src/index.ts`：删除策略调度器与相关 import
- `dsh-plugin/src/tools.ts`：删除 `stock_strategy_run` 与相关 import；更新 `stock_quote`、`stock_add`、`stock_group_create` 描述（港美股 → A 股/指数）
- `dsh-plugin/src/state.ts`：删除策略分组函数与相关 import；`Category`/`CATEGORY_ORDER` 收敛为 `'A'`；`CODE_PATTERN` 去掉 `hk`/`usr_`/`gb_`；`categoryOf` 只返回 `'A'`；`DEFAULT_STOCKS` 删除港美股代码
- `dsh-plugin/src/types.ts`：`Category` 收敛；`State` 删除 `strategyUpdatedAt`/`strategyMatchCount`
- `dsh-plugin/src/api.ts`：删除 `marketOverview` 路由、snapshot 策略字段
- `dsh-plugin/src/quote.ts`：删除 `parseSinaUs`、`fetchHkQuotes`、`TENCENT_QUOTE_URL`、`parseSinaBody` 中港美股份支、`fetchQuotes` 港股分支；保留指数解析
- `dsh-plugin/src/search.ts`：`CODE_PATTERN` 收紧为 A 股
- `dsh-plugin/src/detail.ts`：删除 `MarketOverview` 接口、`fetchMarketOverview`、`getElapsedTradingMinutes`
- `dsh-plugin/src/client/api.ts`：删除 `MarketOverview`/`fetchMarketOverview`、snapshot 策略字段；`categoryOf` 收敛
- `dsh-plugin/src/client/StockDetail.tsx`：删除 `MarketOverviewPanel` 及渲染与样式引用
- `dsh-plugin/src/client/StockTree.tsx`：删除策略分组渲染、`STRATEGY_GROUP_NAME`、`formatStrategyTime`；保留重点关注（focusCodes）逻辑
- `dsh-plugin/src/client/styles.module.css`：删除 `marketOverview`/`strategyInfo` 相关样式
- `dsh-plugin/tests/quote.test.ts`、`state.test.ts`、`api.test.ts`、`reorder.test.ts`：删除/改写港美股与策略相关用例
- `dsh-plugin/README.md`：工具表与「行情 Tab」章节同步（A 股/指数、重点关注、移除港美股与策略说明）
- `specs/dsh-plugin-scope-cleanup.md`（本文件）

### 非目标范围

- 不修改「重点关注（focusCodes）」的现有交互逻辑（状态字段、API `mark: 'focus'`、股票树内置分组、右键菜单、独立排序均保持现状）。
- 不修改涨速榜（未提交 WIP，`dsh-speed-ranking.md` 范围内）的业务逻辑；本次只保证其不回归。
- 不删除、不改写历史 spec 文件（`strategy-stock-picking.md`、`stock-detail-enhance.md` 等保留为历史记录，本次改动在 Review Report 中注明取代关系）。
- 不处理 `dsh-plugin/tests/*.test.js` 陈旧重复副本（已与 `.ts` 脱节、不参与 `npm test`，另行处置）。
- 不修改 VSCode 扩展侧 `src/`、根 `package.json`、lock 文件、构建配置。
- 不自动 commit、push、merge；不写入敏感信息。

### 验收标准

1. `dsh-plugin/src/strategy.ts` 已删除；`src/**` 与 `tests/*.test.ts` 中不再出现 `stock_strategy_run`、`strategyUpdatedAt`、`strategyMatchCount`、`策略选股`、`evaluateBatch`、`STRATEGY_GROUP_NAME`（历史 spec 文件除外）。
2. 代码中不再出现 `marketOverview`（`src/**` 与 `tests/*.test.ts`）；`StockDetail` 无大盘面板。
3. `normalizeCode('hk00700')`、`normalizeCode('usr_aapl')`、`normalizeCode('gb_aapl')` 均返回 `''`；`categoryOf` 对港美股代码返回 `undefined`、对 A 股与指数返回 `'A'`；`DEFAULT_STOCKS` 无 `hk`/`usr_` 前缀代码。
4. 指数能力保留：`b_NKY`、`b_KOSPI`、`sh000001` 等仍可查询；`DEFAULT_INDEX_CODES`（平铺条固定指数）不变。
5. focusCodes：`State.focusCodes`、API `mark: 'focus'`、股票树「重点关注」内置分组与右键菜单保持不变；README 与 spec 已声明其语义边界。
6. `stock_quote`/`stock_add`/`stock_group_create` 等工具描述不再含港美股示例或代码格式。
7. 存量状态迁移：`normalizeState({ stocks: ['sh600000','hk00700','usr_aapl'], groups:[{category:'HK',...}] })` 剔除港美股及非 A 分组。
8. `cd dsh-plugin && npx tsc --noEmit` 0 错误；`cd dsh-plugin && npm test` 全部通过。
9. README 与代码行为一致：无港美股、无策略选股、无大盘概览；记录「重点关注」与一次性数据迁移说明。

---

## 2. Task Card

### 当前任务

按上述 Spec 移除策略选股、大盘实时概览与港股/美股支持，文档化 focusCodes，并把 README、测试与实现收敛一致。

### 允许修改

- Spec「修改范围」列出的 `dsh-plugin/**` 文件与 `dsh-plugin/tests/*.test.ts`
- `dsh-plugin/README.md`
- `specs/dsh-plugin-scope-cleanup.md`

### 禁止修改

- 禁止修改「重点关注」交互逻辑（focusCodes 相关 UI/API 保持原样）。
- 禁止修改涨速榜业务逻辑、`src/client` 中与本次无关的组件渲染与交互语义。
- 禁止修改 VSCode 扩展侧 `src/`、根 `package.json`、lock 文件、`dsh-plugin/package.json`、构建配置。
- 禁止处理 `tests/*.test.js` 陈旧副本、历史 spec 文件。
- 禁止自动 commit、push、merge。

### 执行步骤

1. 删除 `dsh-plugin/src/strategy.ts`。
2. `state.ts`：删除策略分组函数与 import；`Category` 收敛；`CODE_PATTERN`/`categoryOf`/`DEFAULT_STOCKS` 更新。
3. `types.ts`：`Category` 与 `State` 字段更新。
4. `index.ts`：删除策略调度器（import、常量、setTimeout/setInterval、effect）。
5. `tools.ts`：删除 `stock_strategy_run` 与相关 import；更新 `stock_quote`/`stock_add`/`stock_group_create` 描述。
6. `quote.ts`：删除美股/港股解析与分支，保留 A 股与指数；更新文件头注释。
7. `search.ts`：`CODE_PATTERN` 收紧。
8. `detail.ts` + `api.ts` + `client/api.ts` + `StockDetail.tsx` + `styles.module.css`：删除大盘概览全链路。
9. `StockTree.tsx` + `styles.module.css`：删除策略分组渲染与样式；保留重点关注。
10. `tests/*.test.ts`：删除/改写港美股与策略用例。
11. `README.md`：同步工具表、代码格式、行情 Tab、数据与持久化、重点关注语义边界与一次性迁移说明。
12. 验证：`npx tsc --noEmit`、`npm test`、`git diff` 检查无超范围改动。
13. 基于 Spec、Task Card 与 git diff 填写 Review Report。

### Review 检查点

- `strategy.ts` 是否已删除，且无残留 import/引用？
- 指数（`b_`/`int_`/`sh`/`sz`）与平铺条固定指数是否保留？
- focusCodes 交互逻辑是否原样保留、仅文档化？
- 港美股删除后 `normalizeState` 迁移行为是否符合预期（剔除非法代码与非 A 分组）？
- 工具描述、README 是否与实现一致（无港美股/策略/大盘概览残留）？
- 是否新增了未说明依赖、超出允许范围的文件改动、或触碰了 `tests/*.test.js`？
- typecheck 与单元测试是否全绿？

---

## 3. Review Report

### 结论：需人工确认

**验收标准逐条核对（全部满足）**

| # | 验收项 | 结果 |
|---|---|---|
| 1 | `strategy.ts` 删除；`src/**`、`tests/*.test.ts` 无 `stock_strategy_run`/`strategyUpdatedAt`/`strategyMatchCount`/`策略选股`/`evaluateBatch`/`STRATEGY_GROUP_NAME` | ✅ grep 0 命中（含调度器、`stock_strategy_run` 工具、状态字段、股票树渲染、样式、导入） |
| 2 | `marketOverview` 全链路消失（`detail.ts` 的接口/函数、`api.ts` 路由、`client/api.ts`、`StockDetail.tsx` 面板与渲染、样式） | ✅ grep 0 命中 |
| 3 | `normalizeCode` 对 hk/usr_/gb_ 返回 `''`；`categoryOf` 仅返回 `'A'`/`undefined`；`DEFAULT_STOCKS` 无港美股 | ✅ 测试断言覆盖（`state.test.ts`） |
| 4 | 指数保留：`b_`/`int_`/`sh`/`sz` 解析与大小写保持、`DEFAULT_INDEX_CODES` 未动，`b_NKY`/`b_KOSPI` 测试仍绿 | ✅ |
| 5 | focusCodes：State 字段、API `mark:'focus'`、`builtin:focus` 分组/右键菜单/独立排序原样保留；README + spec 声明边界（focus 由 UI 管理，`stock_mark` 只管持仓/关注） | ✅ |
| 6 | `stock_quote`/`stock_add`/`stock_group_create` 描述无港美股示例、`category` 枚举仅 `['A']` | ✅ |
| 7 | 存量状态一次性迁移：`normalizeState` 剔除港美股代码与非 A 分组 | ✅ 新增专项测试（`state.test.ts`「drops HK/US groups and codes on load」） |
| 8 | typecheck 0 错误、npm test 全绿 | ✅ 74/74 通过（原 74：删 1 条 US 解析用例、加 1 条迁移用例） |
| 9 | README 一致：工具表/代码格式无港美股、无策略、无大盘概览；记录重点关注边界与迁移说明 | ✅ |

**风险与说明**

1. **删除了大量代码（净 -688 行）**（AGENTS.md 高风险 #11）：strategy.ts（475 行）+ 全链路删除。属用户明确要求的「多余能力清除」（决策堂/偏好阁#4），非随意重构。影响面：模型工具集少 2 个工具（`stock_strategy_run` 无了、`stock_mark` 维持原样），行情 Tab 少大盘面板与策略分组渲染。
2. **一次性状态迁移**（AGENTS.md 高风险 #1 类）：升级加载时 `normalizeState` 自动剔除存量港美股代码与 `category≠'A'` 的分组，`strategyUpdatedAt`/`strategyMatchCount` 字段自然消失，`策略选股` 分组（A 分组）会保留但不再被维护——如用户希望一并清理需手工删除或等待展示层忽略。此为不可逆数据丢失（软删除可手工恢复）。
3. **验证环境局限**：宿主 DSH 分发（10-18 更新后）不再携带 `@deepseek-ai/*` 的 `.d.ts`。本地 typecheck 使用临时 5 模块声明文件（`src/__env_verify_shims__.d.ts`，验证后已删除、不入库）通过 0 错误；测试运行（tsx）不受影响。用户在带完整类型的 DSH 环境跑 `npx tsc --noEmit` 应同样 0 错误，但**建议在干净环境复验一次**。
4. **未触碰**：涨速榜 WIP（`dsh-speed-ranking.md` 与 8 个相关文件仍保持未提交状态）、关注交互逻辑、`tests/*.test.js` 陈旧副本、历史 spec、VSCode 侧 `src/`、根与插件 `package.json`/lock。
5. **回滚**：本分支存在未提交 WIP，无法用 `git checkout` 整体回退。回滚路径 = 从本 diff 恢复被删文件（`strategy.ts` 等）+ 还原状态字段。因此未自动提交，等待人工确认。

**验证命令**

```sh
cd dsh-plugin && npx tsc --noEmit   # 0 错误（带完整 @deepseek-ai 类型环境）
cd dsh-plugin && npm test           # 74 pass / 0 fail
git status && git diff --stat       # 仅 spec 范围内文件
```

**需人工确认事项**

- [ ] 一次性状态迁移（港美股代码/分组被剔除）是否接受；是否需要一并处理存量「策略选股」A 分组
- [ ] 验证环境局限（宿主无 `.d.ts`，typecheck 依赖临时声明）是否可接受
- [ ] 确认后由用户授权提交（`#{故事号} …`），不自动 commit/push/merge

### Diff Summary

**修改文件列表（19 个文件，+384 / -1072）**

| 文件 | 原因 |
|---|---|
| `dsh-plugin/src/strategy.ts` | **删除**（475 行策略选股实现：EMA20/MACD/RSI/成交量、交易时段判定） |
| `dsh-plugin/src/types.ts` | `Category='A'`；State 删除 `strategyUpdatedAt`/`strategyMatchCount` |
| `dsh-plugin/src/state.ts` | `DEFAULT_STOCKS` 去 5 只港美股；`CATEGORY_ORDER=['A']`；`CODE_PATTERN`/`categoryOf` 仅 A 股；删除策略分组 4 个函数；迁移行为在 `normalizeGroup` 现有逻辑下自动生效 |
| `dsh-plugin/src/index.ts` | 删除策略调度器（import、常量、`setTimeout`/`setInterval`、effect） |
| `dsh-plugin/src/tools.ts` | 删除 `stock_strategy_run`；清理 import；`stock_quote`/`stock_add`/`stock_group_create` 描述与枚举仅 A 股 |
| `dsh-plugin/src/quote.ts` | 删除 `TENCENT_QUOTE_URL`、`parseSinaUs`、`fetchHkQuotes`、`fetchQuotes` 港股分支；`fetchSinaQuotes` 校验仅 A 股；保留指数解析、涨速榜与板块缓存（WIP） |
| `dsh-plugin/src/search.ts` | `CODE_PATTERN` 仅 A 股 |
| `dsh-plugin/src/detail.ts` | 删除 `MarketOverview` 接口、`fetchMarketOverview`、`getElapsedTradingMinutes` |
| `dsh-plugin/src/api.ts` | 删除 `marketOverview` 路由与 snapshot 策略字段；`groupCreate` 仅 `'A'` |
| `dsh-plugin/src/client/api.ts` | 删除策略字段、`MarketOverview`、`fetchMarketOverview`；`categoryOf` 仅 `'A'` |
| `dsh-plugin/src/client/StockDetail.tsx` | 删除大盘概览面板（import、组件、渲染），头部注释同步 |
| `dsh-plugin/src/client/StockTree.tsx` | 删除策略分组名常量、`formatStrategyTime` 与策略渲染 span；重点关注原样保留 |
| `dsh-plugin/src/client/styles.module.css` | 删除 `.strategyInfo` 与 `.marketOverview` 系列 |
| `dsh-plugin/tests/{quote,state,api,reorder}.test.ts` | US 解析用例删除；港美股断言改为「被拒绝」语义；删除类型非法的 cross-market 用例；新增一次性迁移用例 |
| `dsh-plugin/README.md` | 工具表/代码格式仅 A 股；行情 Tab 记录关注重点边界与独立排序；持久化段记录 focus 与一次性迁移说明 |
| `specs/dsh-plugin-scope-cleanup.md` | 本 Spec + Review Report |

**未完成项**：无（全部验收标准达成；typecheck 与测试全绿）。

**建议验证命令**：见上方「验证命令」。

**需人工确认事项**：见上方「需人工确认事项」。
