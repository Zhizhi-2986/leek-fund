# Spec：头部平铺条 科创综指 → 科创50

## Spec

- **目标**：把顶部平铺条（TopTicker）固定指数中的「科创综指」（`sh000680`）替换为「科创50」（`sh000688`），替换完成后重建插件（`lib/`），使 DSH Desktop 下次完整重启后生效。
- **修改范围**：
  1. `dsh-plugin/src/api.ts` 的 `DEFAULT_INDEX_CODES`（平铺条固定指数头）。
  2. `dsh-plugin/README.md` 顶部平铺条功能描述（文字同步）。
- **非目标范围**：
  - 不改平铺条其余固定指数（上证指数、创业板指、日经 225、韩国 KOSPI）。
  - 不改 `DEFAULT_STOCKS`（默认自选，已含 `sh000688`）。
  - 不改 VSCode 根项目 `src/statusbar/statusBar.ts` 及其他历史 spec 文档。
- **验收标准**：
  1. `DEFAULT_INDEX_CODES` 中 `sh000680` 被 `sh000688` 替换，无残留 `sh000680`。
  2. README 描述同步为「科创50」。
  3. `dsh-plugin` 类型检查与测试通过。
  4. `npm run build` 后 `lib/index.js` 内已无 `sh000680` 且包含 `sh000688`。

## Task Card

- **当前任务**：替换头部固定指数代码并重建插件。
- **允许修改**：`dsh-plugin/src/api.ts`、`dsh-plugin/README.md`、`dsh-plugin/lib/`（构建产物）、本 spec 文件。
- **禁止修改**：其余源文件；不自动 commit/push。
- **执行步骤**：
  1. `api.ts`：`sh000680` → `sh000688`。
  2. README 文字同步。
  3. `npm run typecheck` 与 `npm test`。
  4. `npm run build` 重建 `lib/`，确认产物。
- **Review 检查点**：见下方 Review Report。

## Review Report（开发完成后填写）

**Diff Summary（Developer）**

- 修改文件：
  1. `dsh-plugin/src/api.ts`：`DEFAULT_INDEX_CODES` 中 `sh000680`（科创综指）→ `sh000688`（科创50），其余固定指数不变。
  2. `dsh-plugin/README.md`：顶部平铺条描述同步为「科创50」。
  3. `dsh-plugin/lib/`（gitignore 构建产物）：`npm run bundle` 重新产出，`lib/index.js` 已含 `sh000688`、无 `sh000680` 残留，可直接被 host 加载。
  4. `specs/dsh-plugin-header-index.md`：本文件。
- 修改原因：用户要求头部平铺条固定指数从科创综指换成科创50。
- 验收标准逐项核对：
  1. ✅ `DEFAULT_INDEX_CODES` 已替换，源与产物均无 `sh000680`。
  2. ✅ README 已同步。
  3. ✅ `npm test` 80/80 通过；`npm run typecheck` 的 9 个报错全部位于未提交的 `src/index.ts` / `src/client/index.tsx`（tab-placement 在制品），与本改动无关。
  4. ✅ 产物验证：`lib/index.js` 含 `sh000688`×2、`sh000680`×0。
- 未完成项：无（生效需 DSH Desktop 完整重启，属运行侧动作）。
- 验证命令：`npm test`、`npm run typecheck`、`npm run bundle`。
- 需人工确认事项：**服务端 `lib/index.js` 改动必须 Cmd+Q 完全退出并重启 DSH Desktop 才生效**（记忆技法坊#1）；重启会中断当前会话，由用户自行执行，未代执行。

**Review 结论**：可合并（就本改动而言）。注意：工作区中另有未提交的 tab-placement / K 线在制品；typecheck 告警来自在制品，不阻塞本次改动。
