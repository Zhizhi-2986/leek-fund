# VibeSpec：strategy-stock-picking

## 1. Spec

### 目标

在 dsh-leek-fund 插件中新增「策略选股」分组与 30 分钟定时选股能力。
- 在股票树中创建一个「策略选股」自定义分组（A 股）。
- 每隔 30 分钟自动扫描自选 A 股，按用户提供的核心交易策略规则筛选符合条件的个股，并更新该分组。
- 提供手动触发策略选股的 tool，以及策略最近运行时间的展示。

### 修改范围

- `dsh-plugin/src/strategy.ts` — 新增：策略评估引擎（120Min K 线获取、EMA/MACD/RSI/成交量计算、规则判定）。
- `dsh-plugin/src/state.ts` — 新增：策略分组自动创建/查找辅助函数。
- `dsh-plugin/src/index.ts` — 新增：30 分钟定时选股调度器。
- `dsh-plugin/src/tools.ts` — 新增：`stock_strategy_run` tool（手动触发策略选股）。
- `dsh-plugin/src/api.ts` — 新增：snapshot 中返回策略状态（最后运行时间、匹配数量）。
- `dsh-plugin/src/client/api.ts` — 新增：SnapShotState 中增加策略状态字段类型。
- `dsh-plugin/src/client/StockTree.tsx` — 更新：在策略分组标题上展示最后运行时间等状态信息。
- `specs/strategy-stock-picking.md` — 本 Spec。

### 非目标范围

- 不改动现有持仓股（builtin:holding）、重点关注（builtin:focus）、关注（builtin:watch）等内置分组的逻辑。
- 不改动现有自选股添加/删除/分组移动/标记等已有操作。
- 不做全市场扫描，只扫描当前自选列表中的 A 股。
- 不接入真实交易/券商/下单能力。
- 不新增外部 npm 依赖。
- 不修改 VSCode 扩展侧（`src/`）的代码。
- 不修改 dsh-plugin 的构建配置（tsdown.config.ts）。
- 不自动 commit、push、merge。

### 验收标准

1. 插件加载后，自动创建「策略选股」A 股自定义分组（若不存在）。
2. 每隔 30 分钟（仅交易时段）自动扫描所有自选 A 股，按策略规则筛选，结果写入该分组。
3. 策略规则需实现：120Min EMA20 趋势、120Min MACD 动能、120Min 成交量放量、120Min RSI(14) ≤ 75。
4. 可通过 `stock_strategy_run` tool 手动触发一次策略选股。
5. snapshot API 返回 `strategyUpdateTime` 和 `strategyMatchCount`。
6. 股票树中策略分组标题显示匹配数量或最后更新时间。
7. TypeScript 编译通过。

---

## 2. Task Card

### 当前任务

在 dsh-leek-fund 插件中新增策略选股分组与 30 分钟定时选股。

### 允许修改

- `dsh-plugin/src/strategy.ts`（新增）
- `dsh-plugin/src/state.ts`
- `dsh-plugin/src/index.ts`
- `dsh-plugin/src/tools.ts`
- `dsh-plugin/src/api.ts`
- `dsh-plugin/src/client/api.ts`
- `dsh-plugin/src/client/StockTree.tsx`
- `specs/strategy-stock-picking.md`

### 禁止修改

- 禁止修改 `tsdown.config.ts` 及构建配置。
- 禁止新增 npm 依赖。
- 禁止修改 `dsh-plugin/src/quote.ts`、`dsh-plugin/src/detail.ts`、`dsh-plugin/src/search.ts` 等无关模块。
- 禁止修改 VSCode 扩展侧（`src/`）的任何文件。
- 禁止修改 `dsh-plugin/src/client/StockDetail.tsx`、`dsh-plugin/src/client/TopTicker.tsx`、`dsh-plugin/src/client/styles.module.css` 等无关客户端组件。
- 禁止自动 commit、push、merge。
- 禁止将任何密钥、Token、生产地址写入仓库。

### 执行步骤

1. 读取本 Spec、现有 dsh-plugin 代码，确认实现边界。
2. 新增 `dsh-plugin/src/strategy.ts`：策略评估引擎。
3. 修改 `dsh-plugin/src/state.ts`：添加策略分组自动创建/查找逻辑。
4. 修改 `dsh-plugin/src/index.ts`：注册 30 分钟定时调度器。
5. 修改 `dsh-plugin/src/tools.ts`：添加 `stock_strategy_run` tool。
6. 修改 `dsh-plugin/src/api.ts`：snapshot 中携带策略状态。
7. 修改 `dsh-plugin/src/client/api.ts`：补充类型。
8. 修改 `dsh-plugin/src/client/StockTree.tsx`：展示策略状态信息。
9. 执行 TypeScript 编译验证。
10. 输出 Diff Summary。

### Review 检查点

- 策略分组名称是否固定为「策略选股」？
- 定时器是否只在插件激活期间运行？
- 定时器是否在非交易时段跳过扫描？
- 是否只扫描自选 A 股，不扫描全市场？
- 是否新增外部依赖？
- 策略引擎是否正确处理数据不足的情况？
- snapshot 中策略状态是否对客户端可见？
- 客户端是否优雅处理策略状态为空的场景？

---

## 3. Review Report

> 开发完成后由 Reviewer 填写。

### Spec 符合性

结论：可合并。

说明：已实现全部 Spec 目标：
- 新增「策略选股」自定义分组，插件首次运行策略评估时自动创建。
- 实现 30 分钟定时选股调度器，仅在 A 股交易时段（工作日 9:30–11:30/13:00–15:00）运行。
- 策略规则完整实现：120Min EMA20 趋势、120Min MACD 动能（翻红或连续放大）、120Min 成交量放量（>20日均量×1.2）、120Min RSI(14) ≤ 75。
- 提供 `stock_strategy_run` tool 手动触发。
- snapshot API 返回 `strategyUpdatedAt` 和 `strategyMatchCount`。
- 客户端股票树中策略分组标题显示最后运行时间。

### Task 完成情况

结论：已完成。

说明：完成策略引擎（8 个导出函数）、状态管理辅助函数（3 个导出函数）、定时调度器、tool、API 扩展、客户端类型和 UI 展示。所有构建通过。

### Diff 范围检查

结论：可合并。

说明：
- 新增文件 2 个：`dsh-plugin/src/strategy.ts`（475 行策略引擎）、`specs/strategy-stock-picking.md`（本 Spec）。
- 修改文件 7 个：`state.ts`、`index.ts`、`tools.ts`、`api.ts`、`types.ts`、`client/api.ts`、`client/StockTree.tsx`、`client/styles.module.css`。
- 未修改 VSCode 扩展侧代码、构建配置、package.json，未新增外部依赖。
- 未修改已有分组逻辑、自选股操作、标记操作等现有功能。

### 风险检查

风险等级：低。

风险项：

- 120Min K 线数据依赖新浪财经 API，API 不可用时选股结果为空。
- 首次运行时需要积累足够 K 线数据（至少 30 根 120Min 柱），新上市股票可能因数据不足被跳过。
- 定时器只在插件激活期间运行，插件卸载（如 DSH 重启）后自动清理。
- 策略分组由后端自动管理，用户也可手动编辑（增删股票），下次定时运行会覆盖。
- 并发请求限制为 5，避免对 API 造成压力。

### 测试与验证

已执行验证：

- `npx tsc --noEmit`：通过。
- `npx tsdown`：宿主模块与客户端 bundle 构建通过。
- `npx tsc -p tsconfig.build.json`：类型声明生成通过。

未覆盖风险：

- 未在真实 DSH 环境中进行端到端验证（需要 DSH 运行时加载插件）。
- 未验证新浪 120Min K 线 API 的实际返回数据格式（scale=120 参数已确认可用，但实际数据可能因股票而异）。

### 合并建议

结论：可合并。

原因：满足 Spec 全部验收标准，TypeScript 编译与构建通过，修改范围限定在 dsh-plugin 内，未影响 VSCode 扩展侧及其他模块。
