# VibeSpec：dsh-plugin-official-sidebar

## 1. Spec

### 目标

- 把 dsh-leek-fund 的「行情」侧边栏 tab 从第三方 `dsh-sidebar`（better-sidebar）的 `ctx.betterSidebar.registerTab` 迁移到 **DSH 官方右侧 Sidebar** 的原生扩展点：
  - `ctx.sidebarRightTabs.register(definition)` 注册 tab 类型（页面类型，无资源地址，带引导页入口框）；
  - `ctx.slots.inject('sidebar.right.pane.tab', …)` + `ctx.slots.register({ name, key: <definition id> }, Body)` 注册 tab 正文；
  - 正文通过 slot 注入的 `useTabInfo()` 读取 `tab.id`、`tab.visible` 等实时信息。
- 该路径与官方内置 `files` / `text` tab 完全一致（`ui-sidebar-files`、`ui-sidebar-documentpreview` 是同一种两阶段注册），因此不依赖任何第三方侧边栏插件。
- 股票树、平铺条、分组管理、拖动排序、搜索、详情等功能与交互**保持不变**（继续使用 host `/leek-fund/api` 与 2 秒轮询）。

### 修改范围

- `dsh-plugin/src/client/index.tsx`：删除 better-sidebar 注册，改为官方右栏两阶段注册（类型定义 + keyed 正文）。
- `dsh-plugin/src/client/StockTree.tsx`：`StockTreeView` props 由 `{ sessionId, visible, tab: { id, meta }, ctx }` 改为 `{ tabId, visible }`；展开状态由 `tab.meta`（better-sidebar 专有）改为客户端内存缓存（按 tab id）。
- `dsh-plugin/package.json`：移除 `dsh-sidebar` peerDependency 及其 `peerDependenciesMeta`；新增 `@deepseek-ai/dsh-client-ui-sidebar-right`（optional peer）；`dsh.client.inject` 增加官方右栏客户端包；更新 description。
- `dsh-plugin/tsdown.config.ts` 与 `dsh-plugin/tsdown.config.js`（tsdown 实际优先加载 `.js`，两者保持一致）：`CLIENT_EXTERNALS` 对齐官方 `PLATFORM_MODULES`（`packages/client/web/src/platform.ts`），即 `react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。
- `dsh-plugin/README.md`：更新「行情 Tab」章节（官方右栏入口、移除 dsh-sidebar 前置说明）。
- `specs/dsh-plugin-official-sidebar.md`（本文件）。

### 非目标范围

- 不修改 host 半（`src/index.ts`、`src/api.ts`、`src/state.ts`、`src/tools.ts`、`src/quote.ts`、`src/search.ts`、`src/detail.ts`、`src/strategy.ts`）：模型工具与 `/leek-fund/api` 语义不变。
- 不修改 `src/client` 中的业务逻辑（股票树分组、行情渲染、拖动排序、搜索/移动弹窗、详情、样式）。
- 不修改 DSH 本体、不修改 `dsh-sidebar`（better-sidebar）仓库、不修改 VSCode `src/`、根 `package.json`、lock 文件。
- 不引入官方 slot store / locale 体系（展开状态用内存缓存；tab 标题为固定中文，不新增 locale 命名空间）。
- 不实现 `sidebar.right.pane.tab.title`（活标题）、`sidebar.right.tab.menu.item`（额外菜单项）等未使用的官方扩展点。
- 不修复 `src/detail.ts` 中另一在途任务（`specs/fix-avgprice-vwap.md`）遗留的类型错误。
- 不自动 commit、push、merge；不写入敏感信息。

### 验收标准

1. `dsh-plugin` 安装/加载后硬刷新 DSH Web，右侧 Sidebar 的「+」（新增 tab）打开引导页，出现「行情」入口框（标题、图标、描述正确）；点击后以页面类型（`kind: leek-fund`）打开 tab，可停靠、分栏、浮出、关闭。
2. tab 正文渲染原有股票树；`visible === false`（右栏折叠）时暂停 2 秒轮询，恢复可见立即刷新；tab 关闭后停止轮询。
3. 展开/折叠状态在**切换 tab 再切回**后保持（内存缓存按 tab id）；tab 关闭后丢弃。
4. 分组展示、涨跌汇总、红涨绿跌、ETF 三位小数、搜索/新增/删除、分组管理、移动、拖动排序、平铺条行为与迁移前一致。
5. 代码中不再出现 `betterSidebar` / `dsh-sidebar` 引用；`package.json` 不再声明 `dsh-sidebar` 依赖。
6. `tsc --noEmit` 中 client 与 host（除 `src/detail.ts` 在途任务遗留错误外）无错误。
7. `tsdown` 构建产出 `lib/index.js`（ESM）与 `lib/client.js`（`window.__ModuleLoader__.load({ id: "dsh-leek-fund", … })`），client bundle 仅 external 官方平台模块。
8. 现有 70 个 host 单元测试全绿（模型工具行为不变）。
9. 隔离 `DSH_HOME` 启动 `dsh web` 后：`/plugins/dsh-leek-fund/client.js` 200；boot 图中 `dsh-leek-fund` 行存在且其依赖边包含官方右栏包；`/leek-fund/api/snapshot` 正常返回行情。

---

## 2. Task Card

### 当前任务

将「行情」tab 的注册从 dsh-sidebar（better-sidebar）迁移到官方右侧 Sidebar 扩展点，并保证功能与验证链路不回归。

### 允许修改

- `specs/dsh-plugin-official-sidebar.md`
- `dsh-plugin/src/client/index.tsx`、`dsh-plugin/src/client/StockTree.tsx`
- `dsh-plugin/package.json`、`dsh-plugin/tsdown.config.ts`、`dsh-plugin/tsdown.config.js`
- `dsh-plugin/README.md`

### 禁止修改

- 禁止修改 host 半（`src/*.ts` 中除 client 目录外的文件），尤其是 `src/detail.ts`（在途任务）。
- 禁止修改 `src/client` 其余文件（`api.ts`、`StockDetail.tsx`、`SearchDialog.tsx`、`MoveDialog.tsx`、`TopTicker.tsx`、`icons.tsx`、`styles.module.css`、`types.ts`、`css.d.ts`）。
- 禁止修改 `tests/**`、`cordis.patch.yml`、`cordis.dev.yml`、`.gitignore`。
- 禁止修改 DSH 本体、`dsh-sidebar`、VSCode `src/`、根 `package.json` / lock 文件。
- 禁止新增第三方运行时依赖；client 运行时只允许官方平台模块。
- 禁止实现非目标范围内的官方扩展点与功能。
- 禁止自动 commit、push、merge。

### 执行步骤

1. 调研官方扩展点（已完成）：`ctx.sidebarRightTabs.register` 的两阶段注册、`sidebar.right.pane.tab` keyed slot 的 props（`useTabInfo()`）、`ctx.slots.inject` 等待声明、官方 `PLATFORM_MODULES` 清单、右栏默认页与引导页入口框规则。
2. `src/client/index.tsx`：改写为官方两阶段注册；`inject = ['slots', 'sidebarRightTabs']`；类型定义 `id: 'dsh-leek-fund'`、`kind: 'leek-fund'`、`priority: 'extension'`、`title: '行情'`、`guide: [{ order: 60, … }]`；正文包装组件读取 `useTabInfo()` 并把 `tab.id` / `tab.visible` 传给 `StockTreeView`。
3. `src/client/StockTree.tsx`：props 收窄为 `{ tabId, visible }`；模块级 `Map<string, string[]>` 缓存展开状态（初始化 + 变更写入），删除 `betterSidebar.updateTab` 调用。
4. `package.json`：移除 `dsh-sidebar` peer 与 meta；新增 `@deepseek-ai/dsh-client-ui-sidebar-right` optional peer；`dsh.client.inject` 增加该包；更新 description。
5. `tsdown.config.ts` / `tsdown.config.js`：`CLIENT_EXTERNALS` 对齐官方 `PLATFORM_MODULES`。
6. `README.md`：更新行情 Tab 章节为官方右栏用法，删除 dsh-sidebar 前置与硬刷新说明中的第三方描述。
7. 本地开发环境补齐类型解析（`node_modules`，不入库）：为 `@deepseek-ai/dsh-client-ui-sidebar-right`、`dsh-client-ui-dockkit`、`dsh-client-store` 等建立符号链接。
8. 验证：`tsc --noEmit`（区分在途遗留错误）、`tsdown` 构建产物检查、`npm test`（70 用例）、隔离 `DSH_HOME` 的 `dsh web` 全链路（client bundle 服务 + boot 图依赖边 + host API）。
9. Review Report + Diff Summary。

### Review 检查点

- 是否使用官方两阶段注册（`sidebarRightTabs.register` + `sidebar.right.pane.tab` keyed slot），且 `key` 等于定义 `id`？
- 是否彻底移除 better-sidebar 依赖与引用（代码、`package.json`、README）？
- `visible` 门控与 2 秒轮询、加载/错误处理是否与迁移前一致？
- 展开状态在 tab 切换后是否保持、tab 关闭后是否丢弃？内存缓存是否会造成明显泄漏？
- client bundle 的 external 是否严格等于官方平台模块清单？是否误打包 DSH 内部包或引入未声明依赖？
- `dsh.client.inject` 是否包含官方右栏包（保证模块图边正确）？
- 是否改动 host 半、测试、非允许范围内的文件？是否存在无关重构或大面积格式化？
- 是否存在需人工确认事项（真实 GUI 中的 tab 打开、停靠、拖动、折叠暂停轮询）？

---

## 3. Review Report

### Spec 符合性

结论：符合。

说明：

- 「行情」不再注册到 `ctx.betterSidebar`，改为官方右侧 Sidebar 的两阶段扩展点：`ctx.sidebarRightTabs.register(definition)`（`id: dsh-leek-fund`、`kind: leek-fund`、`priority: extension`、`title: 行情`、一个 `order: 60` 的引导入口框）+ `ctx.slots.inject('sidebar.right.pane.tab', …)` 注册 keyed 正文（`key === definition.id`），与内置 `files` / `text` 类型同一路径。
- 正文包装组件 `QuotesBody` 用 slot 注入的 `useTabInfo()` 读取实时 tab 记录，把 `tab.id` / `tab.visible` 交给 `StockTreeView`；`visible === false`（右栏折叠或非活动 tab）时不启动 2 秒轮询，恢复可见立即刷新，卸载时清定时器并 abort 请求——与迁移前一致。
- 展开状态改存模块级 `Map<tabId, string[]>`（官方 `TabRecord` 无 `meta` 字段，且非活动 tab 的正文会卸载）；切 tab 后切回保持，tab 关闭/刷新丢弃，已写入 README。
- `dsh-sidebar`（better-sidebar）依赖、`betterSidebar` 注册代码与 README 前置说明全部移除；`package.json` 改为声明官方右栏包为 optional peer。
- host 半（模型工具与 `/leek-fund/api`）零改动，业务渲染逻辑零改动。

### Task 完成情况

结论：已完成代码、自动化验证与隔离环境全链路验证。

说明：

- `src/client/index.tsx` 重写为 71 行（类型定义 + 正文 + apply），`inject = ['slots', 'sidebarRightTabs']`。
- `src/client/StockTree.tsx` props 由 `{ sessionId, visible, tab, ctx }` 收窄为 `{ tabId, visible }`（`sessionId` 原本未被使用），展开状态读写改为内存缓存。
- `tsdown.config.ts` / `tsdown.config.js` 的 `CLIENT_EXTERNALS` 对齐官方 `PLATFORM_MODULES`（9 项，逐一核对运行中 shell 的 seed 表）；移除 4 个官方已不再 seed 的旧 specifier（`cordis`、`dsh-client-web-react`、`dsh-client-schema-form`、`dsh-client-runtime/client`），purity gate 因此更严。
- `package.json`：`dsh.client.inject` 增加 `@deepseek-ai/dsh-client-ui-sidebar-right`（boot 图中确认该依赖边落到右栏 row 之后，即右栏模块先于本插件 materialize）。
- 本地开发环境（`node_modules`，不入库）：补齐/修正 `@deepseek-ai/dsh-client-ui-sidebar-right`、`dsh-client-ui-renderer`、`dsh-client-ui-slots`（原为悬空链接）、`dsh-client-ui-dockkit`、`dsh-client-store` 的类型解析，并把 `@deepseek-ai/cordis` 指向 profile 的同一实例（否则 `Context` 声明合并不生效，`ctx.sidebarRightTabs` 报 TS2339）。

### Diff 范围检查

结论：符合 Task Card。

说明：

- 实际改动 6 个文件：`src/client/index.tsx`、`src/client/StockTree.tsx`、`package.json`、`tsdown.config.ts`、`tsdown.config.js`、`README.md`，外加本 spec；未触碰 `src/client` 其余文件、`tests/**`、host 半、DSH 本体与 VSCode `src/`。
- 未新增第三方运行时依赖；client bundle 的 external 仍只有 `react` / `react/jsx-runtime` / `react-dom`（与官方平台模块一致）。
- 无无关重构、无大面积格式化：`src/client/StockTree.tsx` 仅 3 处 hunk（常量、props、持久化 effect）。
- 工作区内另有在途任务改动 `dsh-plugin/src/detail.ts`（`specs/fix-avgprice-vwap.md`）与未跟踪的该 spec 文件，非本次改动，未触碰。

### 风险检查

风险等级：中。

风险项：

- **真实 GUI 交互未自动验证**：tab 在真实浏览器中的打开（`+` → 引导页 → 行情）、停靠/分栏/浮出、折叠时暂停轮询、拖动排序手势需人工确认。
- **右栏默认页变化（官方规则，非缺陷）**：`defaultSeed` 在“唯一引导入口”时直接打开该类型、多入口时打开引导页。插件加载后入口为 Files + 行情两个，因此新会话/新 pane 的右栏默认显示引导页（此前直接进文件树）。已用官方 `defaultSeed` 实测确认（`files` → `guide`）并写入 README；若不希望改变默认页，唯一的替代是去掉 `guide` 入口，代价是 UI 中再无打开本 tab 的入口。
- **在途任务阻塞完整构建**：`dsh-plugin/src/detail.ts` 现有 2 个类型错误（`specs/fix-avgprice-vwap.md` 在途改动，改动前即存在），导致 `npm run build`（`tsc && tsdown`）在 tsc 阶段退出非 0；本次验收以 `npx tsdown` 单独验证 bundle，`npm run build` 需在另一任务收尾后复跑。
- **展开状态为内存缓存**：tab 关闭或页面刷新即丢（官方右栏布局同样不跨刷新持久化）；缓存键为 tab id，tab 关闭后残留一个空数组条目，规模受 tab 数限制，无实际泄漏风险。
- **主题变量**：`styles.module.css` 使用 `var(--text-1, …)` 等自备 fallback，未改用官方 `--dsw-alias-*`；观感可能与官方面板不完全一致（属既有样式，未在本次范围内）。
- 回滚：`git checkout -- dsh-plugin/src/client dsh-plugin/package.json dsh-plugin/tsdown.config.* dsh-plugin/README.md`。

### 测试与验证

已执行验证：

- `npx tsc --noEmit`：仅剩 `src/detail.ts` 的 2 个在途错误（改动前基线同样为这 2 个 + 4 个 client 错误）；client 与 host 侧零错误，`@deepseek-ai/dsh-client-ui-sidebar-right` 的官方 `.d.ts` 校验通过。
- `npx tsdown`：`lib/index.js`（ESM, 79.40 kB）、`lib/client.js`（CJS, 66.67 kB）构建成功；确认它加载的是 `tsdown.config.ts`（`tsdown.config.js` 为历史编译副本，已同步修改保持一致）。
- `lib/client.js` 头部为 `window.__ModuleLoader__.load({ id: "dsh-leek-fund", factory: (require) => … })`；`require` 仅 `react` / `react/jsx-runtime` / `react-dom`；bundle 内已无 `betterSidebar` / `dsh-sidebar` 字样。
- `npm test`：70 用例全绿（host 逻辑零改动）。
- **隔离 `DSH_HOME=/tmp/dsh-official-sidebar` 启动真实 web 实例**（`dsh --profile web --patch <plugin>/lib/index.js`，port 3199）：boot 图含 `dsh-leek-fund` row，`inject` 边为 `[…, "@deepseek-ai/dsh-client-ui-sidebar-right"]`，且右栏 row（index 13）先于本插件 row（index 48）；application batch 内含 `dsh-leek-fund/client.js`；该 combo URL 返回 200（66,718 B）且内容含 `sidebarRightTabs`；`POST /leek-fund/api/snapshot` 返回实时行情（上证指数 3934.40 等）。
- **客户端注册实测（真实官方实现）**：把构建出的 bundle 注入伪 `__ModuleLoader__`，对 checkout 中真实的 `SidebarRightTabRegistry` 源码执行 `apply` —— `registry.get('leek-fund')` 得到 `{id: dsh-leek-fund, kind: leek-fund, priority: extension, title: 行情}`，`registry.guide()` 得到 `[{kind: leek-fund, order: 60, title: 行情}]`，`registry.claim('sidebar://leek-fund','leek-fund')` 成功；slot 注册为 `{name: sidebar.right.pane.tab, key: dsh-leek-fund}`；用 runner 的 `useTabInfo()` prop 形状 `renderToString` 该正文，输出 919 字符的股票树 markup（工具栏 + 平铺条 + 加载态）。
- 官方 `defaultSeed` 影响实测（`files` → `guide`），结论已写入 README 与风险项。
- 验证用临时实例、cookie 与 `/tmp/dsh-official-sidebar` 已全部清理。

未覆盖风险：

- 真实浏览器中的 tab 打开/停靠/浮出/拖动与折叠暂停轮询（需人工确认）。
- 官方右栏布局不跨刷新持久化，因此每次刷新后需重新通过 `+` → 行情打开 tab。

### 合并建议

结论：需人工确认。

原因：代码、类型、构建产物、boot 图依赖边、真实 host API 与“对官方注册表源码的真实注册 + 渲染”均已验证；但真实浏览器中的 tab 打开与交互必须由人工确认，且同工作区另一在途任务（`src/detail.ts`）的类型错误会阻塞 `npm run build`，提交前需先收尾或明确其归属。

### Diff Summary

| 文件 | 修改原因 |
|---|---|
| `dsh-plugin/src/client/index.tsx` | 从 `ctx.betterSidebar.registerTab` 迁移到官方两阶段注册（`sidebarRightTabs` + `sidebar.right.pane.tab` keyed slot），正文改用 `useTabInfo()` 读取 tab 记录 |
| `dsh-plugin/src/client/StockTree.tsx` | props 收窄为 `{tabId, visible}`（`sessionId` 原未使用）；展开状态从 `tab.meta` 改为按 tab id 的内存缓存 |
| `dsh-plugin/package.json` | 移除 `dsh-sidebar` peer/optional meta；新增官方右栏包 optional peer；`dsh.client.inject` 增加右栏包；更新 description |
| `dsh-plugin/tsdown.config.ts` / `tsdown.config.js` | `CLIENT_EXTERNALS` 对齐官方 `PLATFORM_MODULES`（同一份清单两处保持同步） |
| `dsh-plugin/README.md` | 行情 Tab 章节改为官方右栏入口与前置说明，记录默认页规则与展开状态生命周期 |
| `specs/dsh-plugin-official-sidebar.md` | 本次 VibeSpec（Spec / Task Card / Review Report） |

验收标准对照：1–4 已由“真实注册表 + 渲染 + boot 图 + bundle 服务”覆盖（浏览器交互待人工确认）；5–8 已直接验证；9 已由隔离实例验证。

未完成项：无（`src/detail.ts` 类型错误属另一在途任务，未在本任务范围内修改）。

建议执行的验证命令：

```sh
cd dsh-plugin
npx tsc --noEmit              # 仅 src/detail.ts 在途错误
npx tsdown                    # 或 npm run build（需先清掉 detail.ts 类型错误）
npm test
```

需人工确认事项：

1. 重启后硬刷新浏览器，确认右侧栏 `+` → 引导页出现「行情」入口框，点击后 tab 正常渲染、可停靠/分栏/浮出。
2. 确认右栏默认页变为引导页可接受（或改走“去掉 guide 入口 + 命令入口”的替代方案）。
3. 折叠右栏确认行情轮询暂停、展开立即恢复；切 tab 再切回确认展开状态保持。
4. `src/detail.ts` 在途改动的归属与提交顺序（会阻塞 `npm run build`）。
5. 提交前提供本次关联的用户故事号。

### 追加：加载方式排查（用户报告“看不到行情入口”后）

现象与结论：

- 运行中的 `dsh web`（cwd = `deepseek-harness` checkout）**没有加载 dsh-leek-fund**：`/leek-fund/api/snapshot` 与任意不存在路径的表现完全一致（GET 404 / POST 405），而插件已加载时 POST 返回 200 实时行情。
- 根因在加载方式，不在插件代码：
  1. `--patch` 必须写在 `web` 之后、透传给 app 的参数之前：`dsh web --port 3199 --no-open --patch x.yml` 报 `unknown option '--patch'`（`web` 子命令开了 `passThroughOptions`，出现 `--port` 之后不再解析选项），正确形式是 `dsh web --patch x.yml --port 3199`；
  2. 用 `cordis.dev.yml` 从 `src/index.ts` 加载时，`src/index.ts` 的 `import './api.js'` 是 ESM `.js` 说明符指向 `.ts` 源文件，Node 自身无法解析（`ERR_MODULE_NOT_FOUND: .../src/api.js`），必须启用 tsx 加载器（仓库根 `pnpm dsh` 已预载 `tsx/esm`；已发布 CLI 需 `NODE_OPTIONS="--import tsx"`）。
- 已在隔离 `DSH_HOME` 下实测两条可用路径（均以 `POST /leek-fund/api/snapshot` → 200 校验）：
  - patch 指向构建产物 `lib/index.js`；
  - `NODE_OPTIONS="--import tsx"` + patch 指向 `src/index.ts`（host 免构建）。
  两者 boot 图均含 `dsh-leek-fund` row（`inject` 含 `@deepseek-ai/dsh-client-ui-sidebar-right`），combo URL 均 200 且为当前构建（66,718 B，含 `sidebarRightTabs`）。
- `dsh-plugin/README.md`「本地开发加载」已改写为上述两种可用形式，并说明客户端 bundle 始终来自 `lib/client.js`（改 `src/client/**` 后必须 `npm run bundle`）。

按用户要求追加的改动（超出原 Task Card 允许范围，经用户明确指定）：

- `dsh-plugin/cordis.dev.yml`：插件行由 `$LEEK_FUND_ROOT/dsh-plugin/src/index.ts` 改为 `./lib/index.js`，删除占位符与“必须绝对路径”的旧说明，改为说明“先 `npm run bundle` 再 `dsh web --patch <该文件绝对路径>`”。
  - 依据：CLI 的 `anchorInsertedPluginNames`（`packages/boot/app-boot/src/index.ts`，已发布的 `dsh-app-boot/lib/index.js` 同样存在）会把 patch `insert` 里以 `./` / `../` / 绝对路径书写的 `name` 解析到 **patch 文件所在目录**，因此相对路径是受支持的正式写法，且不再需要每台机器手改绝对路径。
  - 实测：隔离 `DSH_HOME` 下 `dsh web --patch /Users/zhizhi/Code/Git/leek-fund/dsh-plugin/cordis.dev.yml --port 3199 --no-open` → `POST /leek-fund/api/snapshot` 200；boot 图含 `dsh-leek-fund` row（inject 含官方右栏包），combo URL 200（66,718 B）。
  - 仍不纳入改动：`cordis.patch.yml`（bundle 安装模式，用包名解析，语义不同，无需改）。
