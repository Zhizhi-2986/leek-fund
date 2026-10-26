# VibeSpec: fix-desktop-group-dialogs

## Spec

### 背景与根因

迁移到 DSH Desktop（Electron shell）后，行情 Tab 里三个分组操作坏掉：

- 「新建分组」（工具栏按钮）
- 「重命名分组」（分组右键菜单）
- 「创建二级分组」（一级分组右键菜单）

三个入口的取输入方式都是 `dsh-plugin/src/client/StockTree.tsx` 里的 `window.prompt()`。
`window.prompt` 是浏览器专属 API，Electron 明确不支持（不会弹出对话框，静默返回 `undefined`），
因此 desktop 环境三个操作全部静默失效；浏览器环境正常。已核对 DSH Desktop 打包产物
（`dsh-plugin-desktop`，Electron shell）未对 `prompt`/`confirm` 做任何 polyfill/补丁。
`window.confirm`（删除分组用）Electron 原生支持，不在本次坏点范围内。

### 目标

- 让「新建分组」「重命名分组」「创建二级分组」在浏览器与 desktop 环境行为一致、均可用。
- 用插件内 React 对话框替换 `window.prompt` 三个调用点，复用现有对话框样式与交互（同 SearchDialog/MoveDialog 模式）。

### 修改范围

- `dsh-plugin/src/client/PromptDialog.tsx`（新增）
- `dsh-plugin/src/client/StockTree.tsx`（三个 prompt 调用点改接对话框）
- `specs/fix-desktop-group-dialogs.md`（本文档）

### 非目标范围

- 不修改删除分组的 `window.confirm`（Electron 支持，未报告损坏）。
- 不修改分组业务逻辑、状态 schema、API 协议、`src/api.ts`、`src/state.ts`、`src/tools.ts`。
- 不修改样式文件 / 构建配置 / package / lock 文件。
- 不自动 commit、push、merge。
- 不影响工作区已有的未提交改动（header-index / kline / tab-placement 相关）。

### 验收标准

1. `dsh-plugin/src/client/` 下不再出现 `window.prompt`。
2. 「新建分组」：点击工具栏按钮弹出输入框，确认后调用 `groupCreate`（无 parentId）。
3. 「创建二级分组」：一级分组右键菜单弹出输入框，确认后调用 `groupCreate`（带 parentId）。
4. 「重命名分组」：右键菜单弹出预填当前名称的输入框，确认且名称有变化时调用 `groupRename`。
5. 空名称 / 全空白名称不发起请求（沿用原 `if (name)` 守卫语义）。
6. 输入框 Enter 确认、Esc 取消、点击遮罩取消。
7. `npm test` 与 `npm run bundle` 通过；`npm run typecheck` 无新增错误。

## Task Card

### 当前任务

用插件内 React 对话框替换 StockTree 里三个 `window.prompt` 调用点，修复 desktop 下分组创建/重命名/二级分组失效。

### 允许修改

- 新增 `dsh-plugin/src/client/PromptDialog.tsx`。
- 修改 `dsh-plugin/src/client/StockTree.tsx` 仅这三个入口（工具栏新建分组、右键创建二级分组、右键重命名，含子分组分支）。
- 为触发入口增加一个对话框状态。
- 填写本文件 Review Report。

### 禁止修改

- 禁止改动 `window.confirm` 删除分支。
- 禁止改动分组业务逻辑 / API / 状态层 / 模型工具。
- 禁止新增依赖、修改构建配置与样式文件。
- 禁止格式化或重构无关代码。
- 禁止 commit / push / merge。

### 执行步骤

1. 新增 `PromptDialog.tsx`（title / initialValue / placeholder / onConfirm(trimmed 非空) / onCancel；Enter 确认、Esc 与遮罩取消；自动聚焦全选）。
2. `StockTree.tsx` 增加 `groupPrompt` 状态，替换三处 `window.prompt`。
3. `cd dsh-plugin && npm run bundle` 重建 client bundle。
4. `cd dsh-plugin && npm test`、`npm run typecheck`（对比基线确认无新增错误）。
5. 核对 `lib/client.js` 不再含 `window.prompt`。
6. 填写 Review Report。

### Review 检查点

- 是否所有 `window.prompt` 均已替换（含子分组重命名分支）。
- 对话框交互（Enter/Esc/遮罩/预填/空值守卫）是否符合验收标准。
- 是否只改了允许的文件与行。
- 构建与测试是否通过。
- desktop 环境是否仍需人工验证 GUI。

## Review Report

### Diff Summary

1. 修改文件列表

- `dsh-plugin/src/client/PromptDialog.tsx`（新增）
- `dsh-plugin/src/client/StockTree.tsx`
- `specs/fix-desktop-group-dialogs.md`（本文档）
- 重建产物 `dsh-plugin/lib/client.js`（lib/ 为 gitignore 的构建输出，不入库）

2. 每个文件的修改原因

- `dsh-plugin/src/client/PromptDialog.tsx`：新增插件内输入对话框组件，复用现有 `.overlay/.dialog/.input/.button` 样式；聚焦并全选输入，Enter 确认（trim 后非空才回调）、Esc/遮罩取消。替代 Electron 不支持的浏览器 prompt API。
- `dsh-plugin/src/client/StockTree.tsx`：移除三处 `window.prompt`（工具栏「新建分组」、一级分组右键「创建二级分组」、一级/二级分组右键「重命名」），改为 `groupPrompt` 状态 + `PromptDialog`；确认后仍走原有 `runMutate('groupCreate'/'groupRename')`，保留自动展开新建分组的既有逻辑。删除分组的 `window.confirm`（Electron 原生支持）按非目标范围保持不变。

3. 是否满足 Spec 验收标准

- 满足 1：`src/client/` 下已无 `window.prompt` 调用（仅剩 1 处解释性注释；构建产物 0 处）。
- 满足 2~4：三个入口均改为插件内对话框，确认后分别调用 `groupCreate`（无 parentId）、`groupCreate`（带 parentId）、`groupRename`（预填当前名，名称未变不发请求）。
- 满足 5：空/全空白名称不发起请求（对话框侧 trim 守卫 + 原有 `if (name)` 语义）。
- 满足 6：Enter 确认、Esc 取消、遮罩点击取消。
- 满足 7：`npm test` 80/80 通过；`npm run bundle` 成功；`npm run typecheck` 9 个错误与基线完全一致（均为既有的 `@deepseek-ai` peer 缺声明错误，与本次改动无关，已用 stash 前后对比确认）。

4. 是否存在未完成项

- 代码层面无未完成项。删除分组仍用 `window.confirm`（未报告损坏，Electron 原生支持），如需彻底统一可另立需求。

5. 已执行验证

- 复现根因：DSH Desktop（Electron shell，dsh-plugin-desktop 2.0.18）未对 prompt/confirm 做任何 polyfill；Electron 不支持 prompt 对话框（静默返回 undefined），与用户「三个操作全坏」的现象精确对应。
- `cd dsh-plugin && npm test`：80 passed。
- `cd dsh-plugin && npm run bundle`：lib/client.js 构建成功；产物中 `window.prompt` 出现 0 次，`新建分组/二级分组名称/重命名分组` 字符串均在。
- `node --check lib/client.js lib/index.js`：语法通过。
- `npm run typecheck`：与基线同为 9 个既有错误，无新增。

6. 建议执行的验证命令

- 桌面 GUI：打开行情 Tab，刷新页面（或重载插件）后手工验证三个操作；浏览器访问 http://127.0.0.1:43120 同验。
- `cd dsh-plugin && npm test && npm run bundle`

7. 是否存在需人工确认事项

- 需人工确认 GUI 实际效果：本环境无法驱动桌面窗口点击，桌面端需刷新后人工验证「新建分组 / 创建二级分组 / 重命名」三个入口；浏览器与桌面行为应一致。

### Review 结论

需人工确认。

原因：根因（Electron 不支持 `window.prompt`）与三项损坏的调用点一一对应，代码修复、构建与自动化测试均通过；但桌面 GUI 交互需用户在刷新后的行情 Tab 中实测确认。

