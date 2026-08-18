# VibeSpec：dsh-plugin-ui

## 1. Spec

### 目标

- 在 DSH Web UI 中，通过 dsh-better-sidebar 的 `ctx.betterSidebar.registerTab` 注册一个**「行情」侧边栏 tab**（与 explorer / 终端 / Git 同级，可从 `+` 菜单打开、拖到右侧栏/底部面板任意位置）。
- tab 内实现与 Hermes Desktop 版一致的 LeekFund 股票树与实时行情功能（A 股股票树、内置分组、两级自定义分组、2 秒刷新、红涨绿跌、增删/搜索/分组管理/持仓关注、分组涨跌汇总、拖动排序、ETF 三位小数）。
- tab 顶部提供**平铺行情条**（固定指数 + 状态栏自选股票，2 秒刷新），替代 Hermes 版底部状态栏平铺。
- host 半复用现有 `dsh-plugin/src` 的行情/搜索/状态逻辑，新增私有 HTTP API 供 client 轮询与变更。
- 不修改 DSH 本体、不修改 dsh-better-sidebar、不改动现有 10 个模型工具的 schema 语义。

### 修改范围

- `dsh-plugin/package.json`：新增 `dsh.client` 声明、`exports["./client"]`、peerDependencies（`dsh-better-sidebar` optional、client 运行时包）、tsdown 构建脚本。
- 新增 `dsh-plugin/tsdown.config.ts`：host（Node）+ client（浏览器 CJS closure factory）双入口构建，client bundle 使用 DSH PLATFORM_MODULES 冻结模块表。
- `dsh-plugin/src/index.ts`：host 入口注入 `webServer`，注册 `/leek-fund/api` 前缀路由。
- 新增 `dsh-plugin/src/api.ts`：HTTP API 处理器（快照 / 搜索 / 变更 / 重排）。
- `dsh-plugin/src/state.ts`：新增重排操作函数（股票组内排序/跨组移动、分组同级排序、持仓/关注独立排序）。
- 新增 `dsh-plugin/src/client/`：client half（`index.ts` 注册 tab、`api.ts` fetch 封装、`StockTree.tsx` 股票树、`TopTicker.tsx` 平铺条、`SearchDialog.tsx` 搜索、`MoveDialog.tsx` 移动树、`icons.tsx`、样式）。
- `dsh-plugin/tests/`：新增 API 处理器与重排操作测试。
- `specs/dsh-plugin-ui.md`（本文件）。

### 非目标范围

- 不在股票树中展示港股、美股分类（与 Hermes 版一致：数据保留在状态中，不渲染、不触发行情）。
- 不实现右侧内容区、股票详情、K 线、技术指标、提醒或定时任务。
- 不修改 DSH 本体与 dsh-better-sidebar。
- 不改动现有 10 个模型工具的 name/description/parameters 语义；若内部实现复用，保持行为兼容。
- 不新增行情数据源。
- 不自动 commit、push、merge；不写入敏感信息。

### 验收标准

1. `dsh-plugin` 安装到 web profile 后，DSH Web 硬刷新，better-sidebar 右侧栏 `+` 菜单出现「行情」tab（图标、标题正确）；打开后进入股票树视图，可拖到右侧栏/底部面板，会话切换后 tab 状态按会话隔离。
2. 股票树只展示 A 股分类，顺序为：持仓股、关注、未分组、自定义分组（一级），二级分组相对一级缩进；港股/美股状态数据不删除、不渲染。
3. 股票条目展示名称、代码、涨跌幅、现价；上涨红色、下跌绿色（低强度配色）；ETF 现价三位小数截断（sh51/52/56/588/589、sz159、名称含 ETF）。
4. 行情 2 秒刷新一次；tab 不可见（`visible === false`）时暂停轮询，恢复可见立即刷新。
5. 分组标题后展示 `↑上涨数 ↓下跌数 =平盘数`；一级父分组汇总其直接股票与所有二级子分组股票（按代码去重）。
6. 支持添加股票（按代码或中文名称搜索，结果固定高度滚动区，只返回沪深京 A 股）、删除股票。
7. 支持创建（一级/二级）、重命名、删除（含子分组）自定义分组；移动股票通过「移动到…」树形选择（一级展开、二级默认折叠）。
8. 支持切换持仓、关注标记；持仓/关注为叠加视图，不改变真实分组。
9. 拖动排序：股票在未分组/自定义分组内拖拽排序、拖到另一真实分组标题完成同市场跨组移动；持仓/关注列表各自独立拖拽排序；自定义分组在同级范围内拖拽排序；拖动成功静默、失败显示错误。
10. 顶部平铺条：固定指数（sh000001、sz399006、sh000680、b_NKY、b_KOSPI）与状态栏自选股票平铺展示，2 秒刷新，红涨绿跌。
11. host API 只允许浏览器同源访问（Host 头信任围栏），无鉴权绕过；状态写入复用原子写盘。
12. `tsc --noEmit` 通过；host 单元测试通过（新增重排/API 测试）；`tsdown` 构建产出 `lib/index.js` 与 `lib/client.js`。
13. 现有 10 个模型工具行为不变（行情、搜索、增删、分组、标记仍可用）。
14. Hermes 遗留未引入；`src/`（VSCode）零改动。

---

## 2. Task Card

### 当前任务

新增 dsh-leek-fund 的 better-sidebar「行情」tab（host API + client React 股票树 + 拖动排序 + 顶部平铺条），功能与 Hermes Desktop 版一致。

### 允许修改

- `specs/dsh-plugin-ui.md`
- `dsh-plugin/package.json`
- `dsh-plugin/tsconfig.json`、新增 `dsh-plugin/tsdown.config.ts`
- `dsh-plugin/src/index.ts`、`dsh-plugin/src/state.ts`
- 新增 `dsh-plugin/src/api.ts`、`dsh-plugin/src/client/**`
- `dsh-plugin/tests/**`
- `dsh-plugin/README.md`

### 禁止修改

- 禁止修改 `dsh-plugin/src/tools.ts` 的模型工具 name/description/parameters 语义。
- 禁止修改 `dsh-plugin/src/quote.ts`、`dsh-plugin/src/search.ts`、`dsh-plugin/src/types.ts` 的对外语义（内部可增补导出）。
- 禁止修改 dsh-better-sidebar、DSH 本体、VSCode `src/`、根 `package.json`、根 lock 文件。
- 禁止新增未说明依赖；client 运行时依赖仅限 DSH PLATFORM_MODULES 冻结表内的共享包与 `dsh-better-sidebar`（optional peer）。
- 禁止实现非目标功能（详情/K线/提醒/定时/港股美股展示）。
- 禁止自动 commit、push、merge。

### 执行步骤

1. 调研确认：dsh-better-sidebar `registerTab` API（已完成）、webServer 路由（已完成）、tsdown client bundle 配置（复制 dsh-better-sidebar 的 `tsdown.config.ts` 与 PLATFORM_MODULES 清单）。
2. host：`state.ts` 新增重排操作（`reorderStock`/`reorderGroup`/`reorderMark`，含约束校验）。
3. host：新增 `src/api.ts`（snapshot / search / mutate / reorder 处理器），`src/index.ts` 注册 `/leek-fund/api` 路由（信任围栏 + JSON 封装）。
4. client：搭建 `src/client/index.ts`（inject betterSidebar → `registerTab`，effect 包裹）与 `api.ts`（fetch 封装，带 sessionId）。
5. client：实现 `StockTree.tsx`（分组树 + 行情条目 + 2 秒轮询 + visible 门控 + 红涨绿跌 + ETF 三位小数 + 分组涨跌汇总）。
6. client：实现增删/搜索弹窗（`SearchDialog.tsx`）、移动树（`MoveDialog.tsx`）、持仓/关注切换、分组管理操作。
7. client：实现拖动排序（股票行/分组标题原生拖放，目标上半区/下半区决定插入前后，持仓/关注列表独立）。
8. client：实现顶部平铺条 `TopTicker.tsx`（固定指数 + 状态栏自选，2 秒刷新）。
9. 构建配置：`tsdown.config.ts`（host+client 双入口）、package.json 声明（`dsh.client`、`exports ./client`、peerDeps、files）。
10. 测试：host 重排与 API 处理器单元测试；`tsc --noEmit`、`tsdown` 构建、现有 37 测试全绿。
11. 验证：安装到 web profile → 硬刷新 → 打开「行情」tab → 检查股票树/平铺条/搜索/分组/拖动；模型工具回归（stock_quote 等仍可用）。
12. Review Report + Diff Summary。

### Review 检查点

- tab 是否与 explorer/终端/Git 同级注册、会话隔离、`visible` 门控轮询？
- 股票树是否只渲染 A 股、内置分组顺序正确、二级分组缩进？
- 行情刷新是否严格 2 秒、红涨绿跌、ETF 三位小数截断？
- 分组涨跌汇总是否含子分组并按代码去重？
- 搜索是否只返回沪深京 A 股、结果区固定高度？
- 拖动排序是否满足约束（同市场、组内/跨组/持仓关注独立/同级分组）？落点是否在原生事件期间同步计算？
- host API 是否带信任围栏、复用原子写盘？
- 现有 10 个模型工具是否行为不变？
- 是否超出修改范围、存在无关重构、新增未说明依赖？
- 是否需要人工确认（真实 GUI 交互、拖动手势）？

---

## 3. Review Report

### Spec 符合性

结论：符合。

说明：

- 新增 better-sidebar「行情」tab（`id: leek-fund:quotes`），与 explorer / 终端 / Git 同级注册（`order: 60`、`single`），会话隔离、`visible` 门控 2 秒轮询。
- host 半复用现有 `src/` 的行情/搜索/状态模块，新增 `/leek-fund/api` 前缀路由（snapshot / search / mutate / reorder），带 loopback 信任围栏与原子写盘。
- 股票树只渲染 A 股分类（持仓股、关注、未分组、自定义分组，二级缩进）；港股/美股保留在状态不渲染。
- 行情条目名称/代码/现价/涨跌幅，红涨绿跌低强度配色，ETF 三位小数截断；分组标题 `↑上涨 ↓下跌 =平盘` 汇总（父分组含二级子分组并按代码去重）。
- 添加（代码/名称搜索，固定高度滚动区，仅沪深京）、删除、分组创建/重命名/删除/移动（树形选择）、持仓/关注标记、平铺条加入/移出均已实现。
- 拖动排序：股票组内/未分组排序、拖到分组标题跨组移动（同市场校验）、持仓/关注独立排序、分组同级排序；落点在原生 drop 事件期间同步计算；成功静默、失败显示错误。
- 顶部平铺条：固定指数（sh000001、sz399006、sh000680、b_NKY、b_KOSPI）+ 状态栏股票平铺，随快照 2 秒刷新。
- 未修改 DSH 本体与 dsh-better-sidebar；现有 10 个模型工具语义未变（回归测试通过）。

### Task 完成情况

结论：已完成代码、自动化验证与隔离环境全链路验证。

说明：

- 已实现 host 重排操作（`reorderStock` / `reorderGroup` / `reorderMark`，含同市场/同级/锚点校验）与 API 处理器（`src/api.ts`），`src/index.ts` 注册 `/leek-fund/api` 路由并注入 `webServer`。
- 已实现 client half：`src/client/index.tsx`（inject `betterSidebar` → `registerTab`，effect 包裹）、`api.ts`（fetch 封装）、`StockTree.tsx`（股票树/轮询/拖动/右键菜单）、`TopTicker.tsx`、`SearchDialog.tsx`、`MoveDialog.tsx`、`icons.tsx`、`styles.module.css`。
- 已实现 tsdown 双入口构建（host ESM + client CJS closure factory，PLATFORM_MODULES 冻结表 + purity gate + CSS Modules），`package.json` 声明 `dsh.bundle`、`dsh.client`（`platform: 'web'`）、`exports["./client"]` 与 `./package.json`、peerDependencies（`cordis` / `dsh-better-sidebar` / `@deepseek-ai/schemastery` 等）。
- 修复开发中发现的问题：cordis Context 的 `webServer` 类型增强；`dsh.client.platform` 缺失导致 clientModules 不注册；`exports` 未导出 `./package.json` 导致 `require.resolve` 失败（404）；schemastery 未声明 peer 被误打包进 host bundle。
- 62 个单元测试（新增重排 15 + API 16）全部通过；`tsc --noEmit` 通过；`tsdown` 构建产出 `lib/index.js`（50.16 kB）与 `lib/client.js`（41.75 kB）。
- 隔离 DSH_HOME 完整验证：web 启动 200；`/plugins/dsh-leek-fund/client.js` 200 且内容为 `window.__ModuleLoader__.load({ id: "dsh-leek-fund", ... })`；boot 图包含 `dsh-leek-fund` 行；`/leek-fund/api/snapshot` 返回实时行情 JSON（上证指数等）；`mutate`（添加股票 ok:true）与 `search`（浦发 → 浦发银行等）均正常。

### Diff 范围检查

结论：符合 Task Card。

说明：

- 修改集中在 `dsh-plugin/`（host api/state/index + client 全量 + 构建配置 + 测试 + README）与 `specs/dsh-plugin-ui.md`。
- 未修改 `src/`（VSCode）、`template/`、根 `package.json`、lock 文件；未修改 dsh-better-sidebar 与 DSH 本体。
- 未新增第三方运行时依赖（client 仅用平台模块；新 devDependencies 为构建工具 react/tsdown/lightningcss 等）。
- 现有 10 个模型工具 name/description/parameters 语义未改动，62 测试含原有 37 项回归。

### 风险检查

风险等级：中。

风险项：

- 真实 GUI 交互（股票树渲染、右键菜单、拖动排序手势、平铺条）需用户重启后人工确认；自动化仅覆盖 host 逻辑与 bundle 服务链路。
- better-sidebar 版本差异：真实 profile 同时存在 npm 版 `dsh-better-sidebar`（挂载）与本地 `dsh-sidebar`（link）；`ctx.betterSidebar` 服务 API 以挂载版本为准，v0.12+ API 已使用（registerTab/single），兼容性需真实环境确认。
- 行情/搜索接口为外部公开服务，字段变化可能影响解析；已实现错误提示与保留缓存，但不可控。
- 2 秒轮询对本地 host 与外部接口的频率影响与 Hermes 版一致；tab 不可见时已暂停轮询。
- 构建工具链（tsdown + lightningcss）为新增 devDependencies，仅影响开发与打包，不引入运行时依赖。
- 回滚：`git checkout` 还原 `dsh-plugin/`；或 `dsh plugin --profile web remove dsh-leek-fund` 移除 bundle。

### 测试与验证

已执行验证：

- `dsh-plugin` 内 `npm run typecheck`：通过。
- `npm test`（62 用例）：全部通过（原 37 项回归 + 重排 15 项 + API 16 项）。
- `npm run build`（tsc 声明 + tsdown 双入口）：`lib/index.js`（ESM, 50.16 kB）、`lib/client.js`（CJS, 41.75 kB）、`lib/types/**` 产出正常；purity gate 无报错。
- `lib/client.js` 头部为 `window.__ModuleLoader__.load({ id: "dsh-leek-fund", factory: (require) => ... })`，react 等平台模块 external。
- 隔离 DSH_HOME（`/tmp/dsh-ui-verify`）：`dsh web --port 3199` 启动 200；`window.__DSH_BOOT__` 含 `dsh-leek-fund`（url `/plugins/dsh-leek-fund/client.js?rev=...`）；client.js 200；`/leek-fund/api/snapshot` 返回实时行情（上证指数 3941.90 等）；`mutate`/`search` 端点正常；完成后清理临时环境。
- 真实 web profile 安装（`dsh plugin --profile web add`）成功，`--dump-config` 显示 `# == dsh-leek-fund` bundle 层。
- 修复后 `exports["./package.json"]` 与 `dsh.client.platform: 'web'` 已确认被 clientModules 正确解析。

未覆盖风险：

- 真实 GUI 中「行情」tab 的渲染与交互（需用户重启后人工确认）。
- 拖动排序在真实浏览器中的手势体验与跨列表约束的端到端行为。
- 长周期外部行情接口稳定性。

### 合并建议

结论：需人工确认。

原因：代码、测试、构建与隔离环境全链路（client bundle 服务 + host API）均已验证；但真实 GUI 的 tab 渲染、右键菜单、拖动排序等交互需用户重启后人工确认，且 better-sidebar 挂载版本的服务兼容性需在真实环境核实。
