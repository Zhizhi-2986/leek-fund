# dsh-plugin 行情 Tab 注册位置可配置

## 1. Spec

### 背景

「行情」目前只注册为官方右侧栏（`ctx.sidebarRightTabs` + `sidebar.right.pane.tab`）的 tab。
希望它也能注册为**会话工作区 Tab**（与「对话」「上下文」「Git Plus」「文件」同排，即 `conversation.view` slot），
并在插件设置中提供选项，让用户选择注册位置。默认保持侧边栏，不改变现有行为。

### 目标

1. 「行情」支持两种注册位置：
   - `sidebar`（默认）：右侧栏 tab（现有行为）。
   - `workspace`：会话顶部 tab 栏（`conversation.view`）。
2. 插件设置页（Settings → Plugins → dsh-leek-fund 详情）出现「行情 Tab 注册位置」配置，可选择「侧边栏 / 工作区」，切换后即时生效（无需重启）。
3. 宿主未提供配置服务时回退为侧边栏，不报错。

### 修改范围

- `dsh-plugin/src/index.ts`：`Config` 增加 `location` 字段（volatile）；`apply` 注册 settings 投影。
- `dsh-plugin/src/client/index.tsx`：按配置动态注册侧边栏或工作区 tab；注册插件设置卡片。
- `dsh-plugin/README.md`：记录注册位置与配置方法。
- `specs/dsh-plugin-tab-placement.md`：本文件。

### 非目标范围

- 不修改行情数据、focusCodes、涨速榜、分组等业务逻辑。
- 不修改右侧栏 tab 的现有交互与样式。
- 不新增依赖（`configForms` 为宿主服务，非 npm 依赖）。
- 不自动 commit/push。

### 验收标准

1. 默认（未改配置）行为与现在一致：行情只在右侧栏出现。
2. 插件设置页可看到「行情 Tab 注册位置」选项（侧边栏/工作区），选择后持久化。
3. 选择「工作区」后，行情作为 tab 出现在会话顶部 tab 栏（与「对话」「文件」同排），内容与侧边栏模式一致（自选/分组/行情/焦点）。
4. 切回「侧边栏」后，工作区 tab 消失、右侧栏行情恢复。
5. 宿主无 `configForms` 服务时回退侧边栏，无异常。
6. `cd dsh-plugin && npm run bundle` 构建成功；`npm test` 全部通过。

---

## 2. Task Card

### 当前任务

实现行情 Tab 的可配置注册位置（侧边栏 / 工作区），并在插件设置中提供选择。

### 允许修改

- `dsh-plugin/src/index.ts`、`dsh-plugin/src/client/index.tsx`
- `dsh-plugin/README.md`、`specs/dsh-plugin-tab-placement.md`

### 禁止修改

- 行情业务逻辑（quote/api/state/tools/StockTree 等）
- `dsh-plugin/package.json`、构建配置、其它插件
- 不自动 commit/push/merge

### 执行步骤

1. host `Config` 增加 `location: 'sidebar' | 'workspace'`（默认 `sidebar`，`.volatile()`），并在 `apply` 中通过 `ctx.inject(['settings'], child => child.settings.configure({ auto: false }, ctx.fiber))` 注册配置投影。
2. client 通过 `ctx.get('configForms').get('leek-fund')` 读取配置与订阅变化（`form.set('location', value)` 写入）。
3. 抽出 `mount(location)`：`sidebar` 注册 `sidebarRightTabs` + `sidebar.right.pane.tab`；`workspace` 注册 `conversation.view`（`id: 'dsh-leek-fund'`，`label: () => '行情'`）。切换时先 dispose 旧注册。
4. 注册 `plugins.bundle.config` 卡片（key `dsh-leek-fund`）：单选「侧边栏 / 工作区」，写入 `form.set`。
5. 默认先挂侧边栏；读到配置/变化后再切换。
6. `npm run bundle` 构建并检查产物。

### Review 检查点

- 默认行为是否不变（侧边栏）？
- 工作区 tab 是否出现在会话顶部、内容一致？
- 切换是否即时生效、无重复注册？
- 配置服务缺失时是否安全回退？
- 是否只改动了允许范围内的文件？

---

## 3. Review Report

### 结论：需人工确认

**实现概述**

- host（`dsh-plugin/src/index.ts`）：`Config` 新增 `location: 'sidebar' | 'workspace'`（默认 `sidebar`，`.volatile()`）；`apply` 中通过 `ctx.inject(['settings'], child => child.settings.configure({ auto: false }, ctx.fiber))` 把 volatile 字段投影到宿主 settings 文档（与官方 locale/conversation 插件同一套机制）。
- client（`dsh-plugin/src/client/index.tsx`）：
  - 经 `ctx.get('configForms').get('leek-fund')`（别名 `dsh-leek-fund`）读取配置并订阅变化；
  - `mount(location)` 统一管理注册：`sidebar` 注册 `sidebarRightTabs` + `sidebar.right.pane.tab`（原行为）；`workspace` 注册 `conversation.view`（`id: dsh-leek-fund`、`label: () => '行情'`、`order: 40`），切换时先 dispose 旧注册；
  - 注册 `plugins.bundle.config` 卡片（key = bundle 包名 `dsh-leek-fund`）：单选「侧边栏 / 工作区」，经 `form.set('location', ...)` 写入；宿主无 `configForms` 时回退侧边栏并提示。

**验收标准核对**

| # | 验收项 | 结果 |
|---|---|---|
| 1 | 默认行为不变（仅侧边栏） | ✅ `mount('sidebar')` 先行；未读到配置时保持默认 |
| 2 | 设置页出现「行情 Tab 注册位置」选项并可持久化 | ✅ 卡片注册于 `plugins.bundle.config`（key=包名，与 dsh-git-plus/dsh-context 同机制）；写入经宿主 settings 文档 |
| 3 | 工作区模式下行情出现在会话顶部 tab 栏 | ✅ 注册 `conversation.view`（机制已对照 dsh-git-plus 源码确认） |
| 4 | 切回侧边栏恢复 | ✅ `mount` 切换时 dispose 旧注册并重挂 |
| 5 | 无 configForms 时回退侧边栏、无异常 | ✅ 可选链读取；卡片显示回退提示 |
| 6 | 构建成功、测试通过 | ✅ `npm run bundle` 成功（lib/index.js 66.12 kB、lib/client.js 69.61 kB）；`npm test` 74/74 通过；临时 shim 下 `tsc --noEmit` 0 错误 |

**修复记录（首次构建后激活失败）**

- 现象：插件页提示 `failed to import: TypeError: Schema.union(...).default(...).description(...).volatile is not a function`，插件未激活。
- 根因：`dsh-plugin/node_modules/@deepseek-ai/schemastery` 是 **3.18.1 的实体旧包（无 `volatile`）**，tsdown 将其内联进 `lib/index.js`；宿主运行时是 3.18.5。
- 修复：
  1. 将 `@deepseek-ai/schemastery` 重新链接到宿主 3.18.5（`/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/schemastery`），bundle 改为 `import Schema from '@deepseek-ai/schemastery'`（external，由宿主提供）；
  2. 链式顺序按官方写法调整为 `.default(...).volatile().description(...)`；
  3. 用宿主 3.18.5 实测链式调用通过（`meta: { default:'sidebar', volatile:true, description:... }`）；
  4. 重新 `npm run bundle` + `npm test`（74/74）。

**风险与未验证项（需人工确认）**

1. **未在真实 DSH Desktop 运行态验证**：本轮仅完成构建，尚未重启应用实测「设置页出现选项 → 切换 → 工作区 tab 出现」的完整链路。请在重启 DSH Desktop 后按以下步骤验证（见「验证步骤」）。
2. **settings namespace 兼容**：客户端优先取 `leek-fund`（插件 row id），别名 `dsh-leek-fund`。官方插件以 row id 为命名空间（如 `ui-chat`、`ui-conversation`），我们的 row id 为 `leek-fund`，预计匹配；若实测未生效，可改取 bundle 名（一行改动）。
3. **`plugins.bundle.config` 卡片 key**：使用 bundle 包名 `dsh-leek-fund`（与 dsh-git-plus 的 `dsh-git-plus` key 一致）；卡片出现在 插件详情页。
4. **宿主版本兼容**：`ctx.inject(['settings'], ...)` 与 `configForms` 为 DSH Desktop 内置能力（git-plus/dsh-context 均已使用）；宿主缺失时侧边栏行为不变。

**回滚方式**

- `git revert <本提交>`，或把 `dsh-plugin/src/index.ts`、`dsh-plugin/src/client/index.tsx`、`dsh-plugin/README.md` 恢复至提交前版本；无数据迁移、无状态字段变更，回滚安全。

**验证命令**

```sh
cd dsh-plugin && npm run bundle   # 构建（已通过）
cd dsh-plugin && npm test        # 74/74（已通过）
```

**人工验证步骤（DSH Desktop 重启后）**

1. 完全退出并重启 DSH Desktop，硬刷新（Cmd/Ctrl+Shift+R）。
2. 打开 设置 → 插件 → `dsh-leek-fund`：应看到「行情 Tab 注册位置」卡片，默认选中「侧边栏」。
3. 选择「工作区」→ 关闭设置 → 新建/打开会话：顶部 tab 栏（对话/上下文/文件 同排）应出现「行情」，内容正常刷新。
4. 切回「侧边栏」→ 工作区「行情」tab 消失，右侧栏行情恢复（若右栏未展开，点展开按钮）。
5. 若第 2 步未见卡片或第 3 步未生效：检查浏览器控制台是否有 `dsh-leek-fund: settings card` / `configForms` 相关报错，并反馈（预期问题集中在 namespace 或 slot 名称）。

---

### Diff Summary

| 文件 | 修改原因 |
|---|---|
| `dsh-plugin/src/index.ts` | `Config` 新增 volatile `location` 字段；`apply` 注册 settings 投影（`ctx.inject(['settings'])` + `settings.configure({ auto: false })`） |
| `dsh-plugin/src/client/index.tsx` | 双注册位置（`sidebarRightTabs` / `conversation.view`）按配置动态挂载；`plugins.bundle.config` 设置卡片；订阅配置实时切换；缺配置服务时回退 |
| `dsh-plugin/README.md` | 新增「行情 Tab」章节：注册位置说明、设置入口、工作区/侧边栏差异、前置条件 |
| `specs/dsh-plugin-tab-placement.md` | 本 Spec + Task Card + Review Report |
