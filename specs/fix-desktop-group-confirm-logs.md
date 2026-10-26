# VibeSpec: fix-desktop-group-confirm-logs

## Spec

### 背景与根因

承接 `specs/fix-desktop-group-dialogs.md`（window.prompt → PromptDialog 修复）。
审计确认插件内仅剩的同类浏览器模态 API 是删除分组用的两处 `window.confirm`
（`dsh-plugin/src/client/StockTree.tsx:284`、`:309`），当前 Electron 可用，但与
prompt 同属浏览器对话框家族，为彻底消除桌面/浏览器环境差异，改为应用内确认对话框；
同时清理 3 处调试 `console.log` 残留（`:182`、`:267`、`:315`）。

### 目标

- 删除分组（一级/二级）确认改用插件内 ConfirmDialog，与 PromptDialog 交互一致。
- 移除全部调试 `console.log`（含仅为日志存在的 useEffect）。

### 修改范围

- `dsh-plugin/src/client/ConfirmDialog.tsx`（新增）
- `dsh-plugin/src/client/StockTree.tsx`
- `specs/fix-desktop-group-confirm-logs.md`（本文档）

### 非目标范围

- 不修改分组业务逻辑、API、状态层、`PromptDialog.tsx`。
- 不修改样式文件 / 构建配置 / package / lock 文件（全部复用现有 `.overlay/.dialog/.button*` 样式）。
- 不自动 commit、push、merge。
- 不影响工作区既有未提交改动。

### 验收标准

1. `src/client/` 下不再出现 `window.confirm` / `window.prompt` 调用（注释除外），构建产物中两者均为 0 次。
2. 「删除分组（一级，含二级分组）」与「删除分组（二级）」均弹出应用内确认框，文案保留原意。
3. 确认后调用 `groupDelete` 并刷新；取消/遮罩/Esc 关闭且不删除。
4. 删除所有调试 `console.log`（构建产物中无 `[leek-fund]` 开头的日志串）。
5. `npm test` 通过；`npm run bundle` 成功；`npm run typecheck` 与基线（9 个既有错误）一致。

## Task Card

### 当前任务

将两处 `window.confirm` 替换为应用内 ConfirmDialog，并清理 3 处调试 console.log。

### 允许修改

- 新增 `dsh-plugin/src/client/ConfirmDialog.tsx`。
- 修改 `dsh-plugin/src/client/StockTree.tsx`：两处删除确认入口、对话框渲染、移除 3 处 console.log 及其专用 useEffect。
- 填写本文件 Review Report。

### 禁止修改

- 禁止改动删除分组以外的交互/业务逻辑。
- 禁止新增依赖、修改样式与构建配置。
- 禁止格式化或重构无关代码。
- 禁止 commit / push / merge。

### 执行步骤

1. 新增 `ConfirmDialog.tsx`（title / message / 确认与取消按钮；遮罩与 Esc 取消，复刻 PromptDialog 模式）。
2. `StockTree.tsx` 增加 `groupConfirm` 状态；两处删除 action 改接对话框；渲染 ConfirmDialog；确认后 `runMutate('groupDelete', { id })`。
3. 删除 3 处 `console.log`（含「Log menu state changes for debugging.」的 useEffect 整体）。
4. `cd dsh-plugin && npm run bundle`；`npm test`；对比 `npm run typecheck`。
5. 核对构建产物无 `window.confirm` / `window.prompt` / `[leek-fund]` 日志串。
6. 填写 Review Report。

### Review 检查点

- 删除确认文案是否保留原意（一级含「及其二级分组」，二级不含）。
- 取消路径是否不会误删（取消/遮罩/Esc）。
- 是否只删了指定的日志，未动其他 console 语句。
- 构建与测试是否通过。
- 桌面 GUI 是否需人工验证。

## Review Report

### Diff Summary

1. 修改文件列表

- `dsh-plugin/src/client/ConfirmDialog.tsx`（新增）
- `dsh-plugin/src/client/StockTree.tsx`
- `specs/fix-desktop-group-confirm-logs.md`（本文档）
- 重建产物 `dsh-plugin/lib/client.js`（gitignore 的构建输出，不入库）

2. 每个文件的修改原因

- `dsh-plugin/src/client/ConfirmDialog.tsx`：新增应用内确认对话框组件，复刻 PromptDialog 模式（复用 `.overlay/.dialog/.dialogTitle/.dialogBody/.dialogFooter/.button/.buttonPrimary`），确认按钮自动聚焦，Esc 关闭；替代浏览器 confirm API。
- `dsh-plugin/src/client/StockTree.tsx`：
  - 新增 `groupConfirm` 状态，替换两处 `window.confirm`（一级/二级分组删除确认），确认后 `runMutate('groupDelete', { id })`，保留原文案语义（一级含「及其二级分组」）。
  - 删除 3 处调试 `console.log`（菜单状态日志 useEffect、右键股票/分组日志）。

3. 是否满足 Spec 验收标准

- 满足 1：`src/client/` 无 `window.confirm`/`window.prompt` 调用；构建产物两者均 0 次。
- 满足 2：删除分组（一级/二级）均弹应用内确认框，文案保留原意（`组内股票将回到关注。` ×2 在产物中可见）。
- 满足 3：确认后调用 `groupDelete` 并刷新；取消按钮/遮罩/Esc 均只关闭不删除。
- 满足 4：3 处 `console.log` 全部移除，构建产物中无 `[leek-fund]` 日志串。
- 满足 5：`npm test` 80/80 通过；`npm run bundle` 成功；`npm run typecheck` 9 个错误与基线（stash 前后对比）完全一致，无新增。

4. 是否存在未完成项

- 无。删除确认与新建/重命名/二级分组统一为应用内对话框，浏览器与 Desktop 行为一致。

5. 已执行验证

- `cd dsh-plugin && npm test`：80 passed。
- `cd dsh-plugin && npm run bundle`：lib/client.js 构建成功；`window.confirm`、`window.prompt`、`[leek-fund]` 均 0 次。
- grep 源码：无 `window.confirm` / `window.prompt` / `console.log`。
- `npm run typecheck`：与基线同为 9 个既有 `@deepseek-ai` 声明错误，无新增。

6. 建议执行的验证命令

- 桌面 GUI 刷新行情 Tab：验证删除分组的确认框弹出、取消/确认行为，以及新建/重命名/二级分组三个入口。
- `cd dsh-plugin && npm test && npm run bundle`

7. 是否存在需人工确认事项

- 需人工确认桌面 GUI 实测效果（本环境无法驱动桌面窗口）：删除确认框交互；其余三入口上轮已改，可一并复验。

### Review 结论

需人工确认。

原因：代码修改、构建与自动化测试均通过；桌面 GUI 的确认框交互需用户刷新行情 Tab 后实测确认。

