# VibeSpec：dsh-leek-fund 当日数据面板 V2

## 1. Spec

### 目标

依照 `leek-fund-daily-panel-v2-spec.md` 及配套宽屏、K 线、窄屏预览，在现有详情组件内增量实现更完整的当日指标、阶段表现及响应式布局；仅使用项目已有报价和日 K / 5 分钟 K 线数据，不把原型样本作为生产行情。

### 修改范围

- `dsh-plugin/src/detail.ts`：复用现有腾讯前复权日 K 主源 / 东财回退，保留日收盘价并提供近 5 / 20 个有效交易日收益；保留快照高低价与成交量来源信息以支持诚实对账 / 均价；缺失值必须可区分于有效的 0。
- `dsh-plugin/src/daily-math.ts`（新增）：可单测的日内均价、阶段收益和区间位置纯函数。
- `dsh-plugin/src/client/DailyPanel.tsx`（新增）：承载当日关键价格、日内区间、成交活跃度、辅助指标和阶段表现。
- `dsh-plugin/src/client/StockDetail.tsx`：接入当日面板，保留手动视图选择与既有数据来源；5 分钟 K 线展示真实柱体极值标签及可比较时的快照差异提示。
- `dsh-plugin/src/client/styles.module.css`：面板卡片、淡雅红绿、宽窄响应式布局及可读性样式。
- `dsh-plugin/tests/detail.test.ts` 与 `dsh-plugin/tests/daily-math.test.ts`（新增）：覆盖行情历史解析、交易日收益和公式边界。
- 本 VibeSpec：Task Card 与开发后的 Review Report。

### 非目标范围

- 不新增分时图、外部图表库、依赖、行情端点或后端服务层；不把示例涨跌幅或截图数值写入生产数据。
- 不改自选树、搜索、分组、提醒、Host/Cordis、模型工具、路由、持久化结构或报价数据源架构。
- 不改 5 分钟 K 线 OHLC、MA 或坐标域的真实性规则；不得以快照价格补造 K 线影线。
- 新规格与 2026-11-03 `dsh-plugin-kline-hide-extremes.md` 对最高/最低标签和差异提示的删除要求冲突。本需求及新原型是后续明确决策：仅就详情 K 线显示恢复基于真实 bar 的高低标签和数据差异提示；不撤销该旧规格的其他约束。
- 不自动提交或推送本次 V2 功能代码；本次开始前用户另行授权的基线提交/推送不扩展为本任务交付授权。

### 验收标准

1. 日内均价按成交额（元）÷（成交量（手）×100）计算；成交量 / 成交额缺失、非有限或成交量非正时显示 `—`，标注为估算口径。
2. 近 5 / 20 日表现按有效交易日和现有前复权日 K 收盘价计算；样本不足或不可比时显示 `—`，不得使用原型的演示收益。
3. 60 日区间位置 `(P-L)/(H-L)×100%` 从数据计算；`H<=L` 时显示 `—`；超界文字保留真实百分比，视觉进度限于轨道并说明越界。
4. 日内现价点和昨收刻度共用当日高低价域；昨收越界时不伪造轨道位置，当前价越界时有状态说明。辅助指标的价差与百分比口径、涨跌颜色符合原文。
5. 六项关键价格、成交量/额、换手率、量比、流通市值、日内均价/相对均价/距高低/振幅、5/20 日收益及 60 日位置/距高低均能展示；不适用或缺失用 `—`，不出现 NaN / Infinity。
6. 视图仍由用户手动在「当日数据 / 5分钟K线」切换，模式记忆与切换股票时的模式保持现有行为；不影响左侧股票树。
7. K 线高低标签锚定 bar 自身实际极值；快照与 K 线同交易日且可比较时提示差异，不得补造影线；无法可靠对账时不做确定性差异断言。
8. 面板在 1366、1024、390px 视宽布局可读、不产生全局横向溢出或遮挡；桌面双栏、窄屏纵排。
9. `cd dsh-plugin && npm test`、相关文件独立 TypeScript 检查及 `npm run bundle` 通过。全量 `npm run typecheck` 的既有宿主 peer 类型问题单独记录，不得把它们归因于本改动。

---

## 2. Task Card

### 当前任务

使用既有行情数据实现 V2 当日数据面板和必要的 K 线极值/对账呈现，补齐计算、数据源和布局回归测试。

### 允许修改

- `dsh-plugin/src/detail.ts`
- `dsh-plugin/src/daily-math.ts`（新增）
- `dsh-plugin/src/client/StockDetail.tsx`
- `dsh-plugin/src/client/DailyPanel.tsx`（新增）
- `dsh-plugin/src/client/styles.module.css`
- `dsh-plugin/tests/detail.test.ts`
- `dsh-plugin/tests/daily-math.test.ts`（新增）
- `specs/leek-fund-daily-panel-v2.md`

### 禁止修改

- `dsh-plugin/package.json`、锁文件、构建配置、`src/api.ts` 路由、Host / 状态存储及提醒/自选树业务。
- 不新增依赖，不格式化无关文件，不变更行情源或把样例数据接入生产代码。
- 不改非本 Spec 明确范围内的 K 线算法、MA 语义与页面交互。
- 不在本次 V2 变更结束时自动 commit / push / merge。

### 执行步骤

1. 先给日均价、交易日收益和区间位置纯函数添加测试并运行，确认有针对性 RED。
2. 扩展现有日 K 解析及详情数据结果；为有/无当日 bar、样本不足、无效价格等情况增加测试。
3. 更新详情面板与 CSS，复用现有价格格式化、数据和视图持久化，不写入截图示例值。
4. 按相同交易日对账条件恢复 K 线真实高低标签和提示；确认不存在假影线。
5. 运行测试、相关文件独立类型检查、bundle；检查 1366/1024/390 的布局约束及完整 diff。
6. 填写本文件 Review Report 并输出 Diff Summary；本功能代码保留未提交状态。

### Review 检查点

- 近 N 日索引是否准确处理当日 bar、周末/停牌和历史不足；是否与前复权收盘价口径一致。
- 金额 / 成交量换算是否先统一单位；0 与缺失是否区分。
- 位置文字是否保留真实超界数值，视觉条才 clamp；昨收参考线是否也处理越界。
- K 线标签和差异提示是否仅来源于真实且可比较的 quote / bar；未修改 OHLC。
- 视图切换、左侧树状态和标题行情是否回归；窄屏无裁切或全局横溢。
- 改动文件、依赖、交互和验证是否符合本 Task Card；是否有人工确认事项。

---

## 3. Review Report

> 开发后按 Spec、Task Card、实际 diff 与实际验证结果填写。

### Spec 符合性

结论：可合并（待人工确认后提交）。

说明：9 条验收标准逐条核对——

1. 日内均价：`calcDayAverage(amountYuan, volumeHands)` 先做 `万元→元` / `手×100=股` 单位统一（数据层已换算 amount 为元、volume 为手）；成交量/额缺失、非有限、非正时返回 `null` 显示 `—`；展示标签为「日内均价（估算）」。当成交量回退为 K 线桶合计（`volumeFromBars = true`）时直接显示 `—`，避免与快照成交额跨时点相除。
2. 近 5 / 20 日：`calcPeriodReturn(P_t, previousCloses, N)` 取前 N 个有效交易日前收盘；`fetchStockDetail` 在「行情时间属于今日」时以实时价作 P_t 并剔除当日日 K，否则以最新日 K 收盘价作 P_t 并剔除该根，历史不足或含非正收盘返回 `null`。
3. 60 日位置：`calcRangePosition` 不钳制返回值，H≤L、缺失或非有限返回 `null`；卡片文字保留真实百分比，进度条宽度才做 `clamp(0,100)`，越界时附「现价超出 60 日区间」提示。
4. 日内区间：现价圆点与昨收刻度均由 `calcRangePosition` 在同一个 `[low, high]` 价格域内计算；昨收越界时不画刻度并提示，现价越界时给出数据时点提示。距高点/低点为绝对价差、阶段表现为百分比，两者视觉与单位区分。
5. 关键价格、成交与活跃度、区间辅助指标、阶段表现全部渲染；所有缺失值统一 `—`；新增指标经 `Number.isFinite` / `isPositiveFinite` 守卫，不会输出 `NaN` / `Infinity`。
6. 视图切换与 `readDetailView` / `writeDetailView` 逻辑未改动，仍是手动切换 + localStorage 记忆；`StockTree` 未修改，切换股票不重置模式。
7. K 线极值标签锚定 `bars[extremes.highIndex]` / `bars[extremes.lowIndex]` 的真实柱子；仅当行情快照时间与 K 线最新交易日同日且快照提供高低价时对账，差异只提示、不写入 OHLC（未修改蜡烛数据或坐标域）。
8. 布局：`dailySplit` 在 `≤1259px` 转为单列，`stageGrid` 在 `≤1259px` 两列 + 60 日区间整行、在 `≤700px` 进一步压缩指标网格并在 `stageDistances` 用两列；已用真实 CSS 在 1366 / 1024 / 700 / 390 视宽截图核对，无横向溢出与遮挡。
9. 验证命令全部通过（见下）。

### Task 完成情况

结论：已完成。

说明：改动限于 Task Card 允许的 7 个文件（5 个代码/测试文件 + 2 个新增源文件 + 本 spec）。`package.json`、锁文件、`src/api.ts`、状态存储、提醒、自选树、K 线算法（`kline-math.ts`）均未修改。

### Diff 范围检查

结论：通过。

说明：
- 数据层 `detail.ts`：日 K 解析新增 `close`（仍为前复权收盘价），新增 `snapshotHigh/SnapshotLow/volumeFromBars/return5/return20`；`fetchStockDetail` 在原有结构内增量计算，未改行情源、请求参数或回退顺序。
- 展示层：新增 `DailyPanel.tsx`（约 240 行）承载 V2 面板，`StockDetail.tsx` 删除旧版内联面板、接入新组件并补 K 线极值标签/对账提示，文件从 838 行降至约 646 行；未触碰股票树、搜索、提醒。
- 无新依赖、无格式化无关文件、无目录迁移。

### 风险检查

风险等级：低。

风险项：
- **口径取舍**：60 日高低价含当日未收盘价（沿用既有既有字段语义）；若产品要求「截至上一交易日」需另开需求。
- **日 K 与实时价基准不一致时**：「行情时间为今日」用实时价作 P_t，否则用最新日 K 收盘；盘前后取上一交易日收盘参与计算，与盘中实时价可能相差一个交易日，属预期口径。
- **`volumeFromBars` 为本接口新增字段**：旧客户端不识别时只是不再显示均价，不会报错（客户端按可选字段处理）。
- **对账提示依赖快照时间格式** `YYYY-MM-DD HH:mm:ss`；格式异常时退化为「暂不可对账」，不会误报一致。
- 回滚：还原 4 个修改文件并删除 2 个新增源文件与 1 个新增测试即可；无数据迁移、无 schema 变更。

### 测试与验证

已执行验证：
- `cd dsh-plugin && npm test`：144 pass / 0 fail（新增 `tests/daily-math.test.ts` 8 项；`tests/detail.test.ts` 新增日 K `close` 解析、非法收盘价、与实时价组合的 5/20 日收益、快照成交量与桶量回退区分等用例）。
- 相关文件独立 `tsc --noEmit`：0 错误。
- `npm run bundle`：成功，产物含新面板代码。
- 全量 `npm run typecheck`：仍为基线的 9 处错误（`src/index.ts` schemastery `Config`/`Volatile` 与 `src/client/index.tsx` 宿主子路径解析），与本次改动无关。
- 视觉验证：用 `/tmp` 下的 QA harness（引用真实 `styles.module.css` 类名 + 原型示例数据）以 headless Chrome 在 1366×930、1024×1250、700×1200、390×1500 截图核对；据此修正了「昨收」标签与底部标签重叠、窄屏阶段表现换行两处布局问题。**未在真实 DSH Web GUI 中点击验证**。

未覆盖风险：真实行情下的极值标签与轨道视觉密度需人工在 GUI 内确认；东财回退路径的实时快照对账未做联网实测（单测已覆盖分支逻辑）。

### 合并建议

结论：需人工确认。

原因：功能与测试满足 Spec，但涉及行情口径取舍（60 日窗口含当日、盘前后基准）与视觉密度，需人工在真实 GUI 中确认后再提交。

---

## Developer Diff Summary

### 1. 修改文件列表

| 文件 | 修改原因 |
|---|---|
| `dsh-plugin/src/daily-math.ts`（新增） | `calcDayAverage` / `calcPeriodReturn` / `calcRangePosition` / `calcPercentFromHigh` / `calcPercentAboveLow` / `calcIntradayAmplitude` 纯函数，全部对缺失与非有限输入返回 `null` |
| `dsh-plugin/src/detail.ts` | 日 K 解析保留前复权 `close`；输出 `snapshotHigh/snapshotLow/volumeFromBars/return5/return20`；`price` 优先实时快照价；解析时拒绝非有限价格 |
| `dsh-plugin/src/client/DailyPanel.tsx`（新增） | V2 当日面板：六项关键价格、日内区间（现价点 + 昨收刻度 + 越界提示）、五项区间辅助指标、成交与活跃度、阶段表现、数据口径脚注 |
| `dsh-plugin/src/client/StockDetail.tsx` | 接入 `DailyPanel`；头部价格缺失显示 `—`；5 分钟 K 线恢复真实柱体高低标签，并仅在可比较时给出快照差异提示 |
| `dsh-plugin/src/client/styles.module.css` | 面板卡片/指标/区间轨道/阶段表现样式与 1259px、700px 响应式断点 |
| `dsh-plugin/tests/detail.test.ts` | 日 K `close` 断言、非法 close 过滤、5/20 日收益（有实时价、无当日 bar）、快照量与桶量区分 |
| `dsh-plugin/tests/daily-math.test.ts`（新增） | 六个纯函数的正常、缺失、除零、超界与浮点边界用例 |
| `specs/leek-fund-daily-panel-v2.md`（新增） | 本 Spec / Task Card / Review Report |

### 2. 是否满足 Spec 验收标准

满足，逐条对应见「Spec 符合性」。原型中的 `20.06`、`+3.42%`、`-8.76%`、`40.69 / 18.03` 等示例值仅出现在 QA harness 与文档中，未进入生产代码。

### 3. 未完成项

- 未在真实 DSH Web GUI 内做人工点击与实时行情核对。
- 新增字段未同步到 `dsh-plugin/README.md` 的接口说明（Spec 将 README 列为非目标；如需文档同步请另行确认）。

### 4. 建议验证命令

```bash
cd dsh-plugin
npm test
npx tsc --noEmit --skipLibCheck --module nodenext --moduleResolution nodenext \
  --target es2022 --lib es2022,dom --types node --jsx react-jsx \
  src/client/css.d.ts src/client/StockDetail.tsx src/client/DailyPanel.tsx \
  src/detail.ts src/daily-math.ts tests/detail.test.ts tests/daily-math.test.ts
npm run bundle
```

### 5. 需人工确认事项

1. 60 日区间是否包含当日未收盘价（当前：包含）。
2. 盘前/盘后无「今日行情时间」时，5/20 日基准取最新日 K 收盘价，是否符合预期口径。
3. 5 分钟 K 线高低标签与对账提示条是否保留（本次按新原型恢复；旧 `dsh-plugin-kline-hide-extremes.md` 曾要求删除，属规格冲突，已在非目标范围中声明）。
4. 是否授权提交本次 V2 改动（当前保留未提交状态）。

