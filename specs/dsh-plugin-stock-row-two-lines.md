# DSH 股票行情行两行布局

## 1. Spec

### 目标

股票树行情行仅展示两行：左侧第一行股票名称、第二行股票代码；右侧第一行价格、第二行涨跌幅。未开盘等行情状态和行情更新时间不占据行内空间，仅在悬停提示中展示。

### 修改范围

- `dsh-plugin/src/client/StockTree.tsx` 的股票行布局和相关悬停提示，并移除独立的最近更新时间条；`dsh-plugin/src/client/styles.module.css` 的局部样式。
- `dsh-plugin/tests/stock-row-layout.test.ts` 补充针对布局和悬停信息的回归验证。

### 非目标范围

不修改行情数据、刷新频率、市场状态判断、分组/拖拽/详情/提醒交互、顶部平铺条、依赖及 DSH 配置；不提交、推送或发布。保留工作区已有未提交修改。

### 验收标准

1. 普通股票行左侧股票名在上、股票代码在下；右侧价格在上、涨跌幅在下，行内只有这两行，不显示状态和更新时间。
2. 悬停股票行仍能获知行情状态和完整行情时间，更新失败提示也保留；不另占一行显示最近更新时间。
3. 行操作按钮、点击展开、拖拽和右键菜单不受布局调整影响。
4. 测试与客户端 bundle 通过；若类型检查存在既有失败，记录差异；Review Report 基于实际 diff 和验证结果填写。

## 2. Task Card

- 先添加布局回归测试并运行确认预期失败，再仅修改允许范围内的股票行 JSX 与局部 CSS 达成两行布局。
- 验证相关测试、全量测试、bundle、类型检查与 diff；检查不会覆盖已有未提交变更。
- 允许修改：本 Spec 文件、`dsh-plugin/src/client/StockTree.tsx`、`dsh-plugin/src/client/styles.module.css`、`dsh-plugin/tests/stock-row-layout.test.ts`。禁止修改其余文件及新增依赖。
- Review 检查点：股票名/代码与价格/百分比各形成上下两行；状态/时间只在 tooltip；交互处理器原样保留；无无关格式化或既有改动回退。

## 3. Review Report

**结论：需人工确认**（2026-10-27）。静态布局回归测试与全量测试通过；09:40 使用本机已有独立 Node 22 成功构建插件，桌面 profile 的符号链接指向同一新产物。原生界面的两行高度和悬停仍需刷新实际页面确认。

### Diff Summary

| 文件 | 修改原因 |
| --- | --- |
| `dsh-plugin/src/client/StockTree.tsx` | 将股票名称/代码归到左侧上下两行，右侧仅保留价格/涨跌幅；删去独立的最近更新时间栏及对应无用状态，保留整行悬停的状态与完整行情时间和既有行交互，并让操作按钮继承行悬停提示。 |
| `dsh-plugin/src/client/styles.module.css` | 新增左侧两行布局样式；移除不再使用的状态与更新时间条样式。 |
| `dsh-plugin/tests/stock-row-layout.test.ts` | 增加布局结构及悬停提示的五项源码回归测试（测试环境无法直接导入 CSS Modules）。 |
| `specs/dsh-plugin-stock-row-two-lines.md` | 记录本次范围、验收与验证情况。 |

### 验收与验证

- RED：先运行 `node --import tsx --test tests/stock-row-layout.test.ts`，名称/代码同列及去掉行内状态两项失败；随后为最近更新时间栏与操作按钮提示补测，均先出现预期失败。GREEN：相同测试目标 **5/5 通过**。
- 全量 `node --import tsx --test tests/*.test.ts`：**102/102 通过**。`git diff --check`：通过。未安装依赖、未提交或发布。
- `node node_modules/typescript/bin/tsc --noEmit`：**失败**，九处既有诊断，仅在 `src/client/index.tsx`（缺宿主声明与 Context.slots）和 `src/index.ts:42`（volatile Schema 类型）；本次改动文件无新增诊断。
- DSH 自带签名 Node 运行 `node node_modules/tsdown/dist/run.mjs` 曾因 Rolldown 原生 binding 的 Team ID 不匹配失败。改用本机**已有** `~/.nvm/versions/node/v22.23.2/bin/node node_modules/tsdown/dist/run.mjs`：**成功**，`lib/index.js` 81.92 kB、`lib/client.js` 99.33 kB；两份 bundle 的 `node --check` 均通过。未重装依赖或修改签名。
- 当前 DSH Desktop 进程监听 `127.0.0.1:43120`，desktop profile 的 `node_modules/dsh-leek-fund` 已是指向本工作区插件的符号链接；通过该链接访问 `lib/client.js` 的 SHA-256 与刚构建的文件一致（`90831b57…e6408d`）。对 GUI URL 发起无凭据请求得到 403，不能验证当前浏览器实际加载版本，亦没有自动刷新或重启 DSH Desktop。
- 回归测试是 JSX/CSS 源码结构契约，不是浏览器像素/交互测试；用户需硬刷新实际插件页面，人工走查两行布局、悬停气泡和行操作。
- 审查仅针对本次局部修改；工作区还有先前未提交的提醒、K 线和插件变更，未覆盖、提交或回退。无新增依赖或高风险配置修改。需人工确认：实际页面加载新 bundle 后的视觉效果；如需回滚，仅撤销本次股票行 JSX、CSS 和测试/Spec 的局部变更，不要整体重置工作区。

