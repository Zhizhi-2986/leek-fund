# VibeSpec：dsh-speed-ranking

## 1. Spec

### 目标

- 在 `dsh-plugin` 右侧 Sidebar 的股票树最底部增加固定分组“涨速榜”。
- 使用腾讯 A 股行情排行接口提供的 `speed` 5 分钟涨速，按涨速降序展示前 20 条实时排名。
- 每条榜单记录展示个股所属行业板块；板块取东方财富数据中心的 `BOARD_NAME_LEVEL` 行业层级字段。
- 榜单只读，不写入用户状态，不参与自选分组、拖动排序或右键菜单。
- 沿用股票树现有 2 秒快照刷新机制，客户端不直接访问外部行情源。

### 修改范围

- `dsh-plugin/src/types.ts`：增加涨速榜条目类型。
- `dsh-plugin/src/quote.ts`：请求、解析并规范化沪深北 A 股 5 分钟涨速榜，批量补充并短缓存行业板块信息。
- `dsh-plugin/src/api.ts`：在现有 `snapshot` 响应中返回涨速榜。
- `dsh-plugin/src/client/api.ts`、`client/types.ts`：补充快照类型。
- `dsh-plugin/src/client/StockTree.tsx`：在自定义分组之后渲染固定“涨速榜”分组及只读行。
- `dsh-plugin/src/client/styles.module.css`：补充行业板块字段的紧凑展示样式。
- `dsh-plugin/tests/quote.test.ts`：覆盖榜单筛选、排序、上限和字段解析。
- 本 Spec 文件。

### 非目标范围

- 不修改 VS Code `src/`、Hermes Desktop 旧插件或 DSH 官方 Sidebar 注册方式。
- 不新增状态字段、不持久化榜单、不把榜单股票加入自选或任何用户分组。
- 不新增榜单筛选、分页、搜索、详情、拖动、右键菜单或其他交互。
- 不自行根据本地轮询快照计算涨速；涨速只使用行情源 `speed`。
- “板块”仅指东方财富 `BOARD_NAME_LEVEL` 的行业层级中间层，不展示概念板块、地域板块或用户自定义分组。
- 不新增依赖、不修改 `package.json`、lock 文件、构建配置或无关模块。
- 不自动 commit、push 或 merge。

### 验收标准

1. 股票树中“涨速榜”始终位于所有用户自定义分组之后。
2. 榜单范围仅包含沪、深、北交易所 A 股，按 5 分钟涨速降序返回最多 20 条。
3. 每行展示排名、股票名称、所属行业板块、代码、当前价格和日涨跌幅，榜单行不可拖动且无右键操作。
4. 榜单随现有快照每 2 秒刷新，刷新失败不影响已有股票树快照接口结构。
5. 客户端只通过 `/leek-fund/api/snapshot` 取得榜单数据。
6. 现有股票树、用户分组、状态栏、详情和其他 DSH 插件功能不改变。

## 2. Task Card

### 当前任务

在 dsh-plugin 股票树底部实现只读的实时 5 分钟涨速榜固定分组。

### 允许修改

- `specs/dsh-speed-ranking.md`
- `dsh-plugin/src/types.ts`
- `dsh-plugin/src/quote.ts`
- `dsh-plugin/src/api.ts`
- `dsh-plugin/src/client/api.ts`
- `dsh-plugin/src/client/types.ts`
- `dsh-plugin/src/client/StockTree.tsx`
- `dsh-plugin/src/client/styles.module.css`
- `dsh-plugin/tests/quote.test.ts`

### 禁止修改

- 禁止修改 VS Code `src/`、Hermes Desktop 目录、依赖和构建配置。
- 禁止修改持久化状态结构或现有股票树交互语义。
- 禁止新增第三方依赖和无关重构。
- 禁止自动 commit、push 或 merge。

### 执行步骤

1. 定义榜单条目和行情源字段解析。
2. 在现有快照请求中获取榜单，并以一次批量请求后台预热行业板块元数据；上游失败时返回空榜单或空板块而不阻断快照。
3. 补充客户端快照类型。
4. 在自定义分组之后渲染固定分组和只读榜单行。
5. 增加解析单元测试并执行类型检查、测试和 diff 检查。
6. 基于 Spec、Task Card 和 git diff 填写 Review Report。

### Review 检查点

- 是否真正使用 `speed`，而非日涨跌幅或本地快照计算？
- 是否严格筛选沪深北 A 股并按涨速降序取前 20？
- 固定分组是否位于最底部且不进入持久化状态？
- 榜单行是否只读、不可拖动、无右键菜单？
- 是否保持现有快照、股票树和分组行为不变？
- “板块”是否来自东方财富 `BOARD_NAME_LEVEL` 行业层级，且未误用概念、地域字段或用户分组？
- 是否新增了未说明依赖或超出范围的修改？

## 3. Review Report

### Spec 符合性

结论：符合，需人工确认真实 DSH 页面。

说明：本轮在既有 DSH 涨速榜基础上补充个股所属行业板块展示；板块定义为东方财富数据中心 `BOARD_NAME_LEVEL` 的行业层级中间层，不改变涨速榜的只读和状态隔离语义。板块元数据通过一次批量请求后台预热，避免阻塞 2 秒快照轮询。

### Task 完成情况

结论：已完成代码与自动化验证。

说明：服务端通过 `/leek-fund/api/snapshot` 返回榜单，板块元数据按股票代码短缓存并在后续快照中带回；客户端沿用 2 秒刷新，在榜单或板块上游失败时仍可得到稳定快照结构。新增测试覆盖代码筛选、涨速降序、前 N 条限制、腾讯 `rank_list` 和东方财富行业层级解析。

### Diff 范围检查

结论：符合 Task Card。

说明：实际修改限定在本 Spec、dsh-plugin 的类型/行情/API/客户端树文件和行情测试；未修改 VS Code `src/`、依赖、lock 文件、构建配置或持久化状态逻辑。

### 风险检查

结论：中。

说明：榜单依赖腾讯公开行情接口，板块依赖东方财富数据中心接口；代码在任一上游失败时保持快照结构，板块不可用时显示 `--`。DSH 页面中的折叠、刷新和真实榜单视觉效果仍需人工确认。

### 测试与验证

已执行验证：

- `cd dsh-plugin && npm test`：74 项通过。
- dsh-plugin 本次涉及文件的定向 `npx tsc --noEmit ...`：通过。
- `cd dsh-plugin && npm run bundle`：通过，生成 `lib/index.js` 与 `lib/client.js`。
- `git diff --check`：通过。
- 联网 smoke test：数据中心批量接口返回 `小家电`、`房地产服务`、`化学制品` 等行业板块。
- snapshot smoke test：隔离 DSH 实例返回 20 条 `speedRanking`，板块预热后字段结构包含 `code`、中文名称、`speed` 和 `sector`。
- 完整 `npm run typecheck`：被既有的 `src/client/index.tsx` 官方 Sidebar 类型缺失/字段不匹配和 `src/index.ts` 的 `Volatile<number>` 配置类型错误阻断；本次修改文件无新增错误。

未完成验证：

- 未在真实 DSH 浏览器中人工确认固定分组的折叠和最底部视觉位置。

未覆盖风险：外部行情接口字段或网络可用性变化；首次快照可能在板块后台预热完成前显示 `--`；需在 DSH 页面复核实时刷新。

### 合并建议

结论：需人工确认。

原因：代码、解析测试、定向类型检查、bundle、腾讯涨速榜和隔离 DSH 板块字段链路已通过，但真实 DSH 页面交互仍需确认；完整 typecheck 还存在本次之前的基线错误。

### Diff Summary

| 文件 | 修改原因 |
|---|---|
| `dsh-plugin/src/types.ts` | 增加带 5 分钟涨速的榜单条目类型。 |
| `dsh-plugin/src/quote.ts` | 请求并解析腾讯 `speed`，筛选 A 股、按涨速降序截取前 20，并后台批量获取/缓存东方财富行业板块。 |
| `dsh-plugin/src/api.ts` | 将榜单加入现有 snapshot 响应。 |
| `dsh-plugin/src/client/api.ts`、`dsh-plugin/src/client/types.ts` | 补充客户端快照和类型导出。 |
| `dsh-plugin/src/client/StockTree.tsx` | 在用户分组底部渲染只读固定“涨速榜”及排名行。 |
| `dsh-plugin/src/client/styles.module.css` | 增加行业板块字段的紧凑展示和溢出提示样式。 |
| `dsh-plugin/tests/quote.test.ts` | 增加涨速榜解析、筛选、排序和数量限制测试。 |
| `specs/dsh-speed-ranking.md` | 记录本次 Spec、Task Card 和 Review Report。 |

验收标准：1–6 的代码路径已覆盖；真实 DSH UI 仍需人工确认。

未完成项：无代码待办；仅保留上述环境验证项。

建议执行的验证命令：

```sh
cd dsh-plugin
npm test
npm run bundle
npm run typecheck
```

需人工确认事项：

1. 在真实 DSH 环境打开股票树，确认“涨速榜”位于最底部且展开/折叠正常。
2. 在 DSH 中确认榜单实时返回前 20，并持续随 2 秒快照刷新。
3. 确认榜单行能看到行业板块，板块暂不可用时显示 `--`。
4. 修复或确认既有完整 typecheck 基线错误后再合并。
