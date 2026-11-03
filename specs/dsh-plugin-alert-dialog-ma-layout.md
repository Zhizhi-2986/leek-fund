# DSH 行情提醒弹窗与 K 线均线布局

## 1. Spec

### 目标

依据用户提供的行情页截图：移除工具栏中框选的「−」全部分组折叠按钮；将行内「今日关注／提醒规则」界面改为弹窗，既可从工具栏进入也可通过单只股票「设置行情提醒」进入；股票详情里的 MA5/10/20/30/60 数值显示在 K 线图上方。

### 范围

- `dsh-plugin/src/client/{StockTree,AlertPanel,StockDetail,styles.module.css}.tsx/.css`：入口、弹窗交互及均线顺序的最小改动；必要时补 `dsh-plugin/tests/*.test.ts` 和 README 的界面说明。
- 弹窗内保留今日最多三条、最近十条历史、规则创建/删除及通知权限提示；后台提醒监听仍由客户端插件 `apply` 生命周期和宿主维持，不随弹窗关闭而停止。
- 尊重已有未提交的详情 K 线、提醒功能与 Tab 位置工作；不重排其他股票树交互。

### 非目标范围

不改变规则 API、触发门控/去重、桌面通知实现、K 线计算及数据源；不新增依赖、不安装、不修改 DSH Desktop 配置，不提交/推送/发布。

### 验收标准

1. 工具栏不再渲染「全部分组折叠」减号按钮；刷新按钮仍在工具栏右侧，已有分组标题逐个展开/折叠正常。
2. 行情树不再常驻提醒表单；工具栏「提醒」点击后打开模态弹窗；股票行菜单「设置行情提醒」打开同一弹窗且预选该股。
3. 弹窗可用关闭按钮、遮罩及 Escape 关闭；有明确标题和可聚焦的交互区域。规则与历史、权限状态在弹窗内保持，关闭弹窗不删除规则/事件、不停止后台监测或已启用的通知监听。
4. 详情价格摘要下方先展示 MA5/10/20/30/60 数值，再展示 5 分钟 K 线；数值及图表逻辑不改。
5. 相关测试、全量测试与 bundle 实测；类型检查若仍有既有问题须报告；对照 Spec 与 git diff 填写 Review Report。无法实测真实 GUI 时明确说明。

## 2. Task Card

1. **界面入口与弹窗**：先检查 StockTree/AlertPanel 当前状态及已有对话框样式；仅在本 Spec 范围改 `StockTree.tsx`、`AlertPanel.tsx`、`styles.module.css`，移除减号按钮与行内提醒面板，添加可见「提醒」入口并复用股票菜单入口；弹窗复用已有遮罩/键盘行为并处理焦点。验证开/关、预选代码、内容不因关闭造成持久状态丢失。
2. **均线位置**：在 `StockDetail.tsx` 保持原数据与计算，只改变数值块相对 K 线的 DOM 顺序和必要间距。为可观察输出加回归验证，确保 MA 顺序和图表位置。
3. **验证及审查**：使用本机已有 Node 与 tsx/tsdown 运行测试和 bundle；查看 TypeScript 检查、`git diff --check`、当前差异与 Review Report。保留之前所有未提交内容；禁止依赖安装及提交。

### Review 检查点

- 工具栏移除的是截图中的全部折叠按钮，不是刷新或分组行自身的展开开关。
- 弹窗关闭只卸载 UI，不影响宿主定时监测及 apply 级通知；今日/历史数据重开可重新获取。
- 股票菜单预选代码未出现首次弹窗闪烁或关闭后错误复用；弹窗键盘和可访问标题可用。
- 不越界修改 API、K 线计算、构建脚本、依赖或 DSH 配置。

## 3. Review Report

**结论：需人工确认**（2026-10-26）。代码和本地 bundle 已更新，原生页面中的弹窗开关及布局还需用户刷新页面后目测和走查；不自动安装、重启或改变 DSH Desktop 配置。

### Diff Summary（本次相对既有未提交工作）

| 文件 | 修改原因 |
| --- | --- |
| `dsh-plugin/src/client/StockTree.tsx` | 删除工具栏「全部分组折叠」按钮及图标导入；新增「提醒」入口，股票行菜单通过同一弹窗预选代码；旧行内提醒组件改为条件挂载，关闭后焦点回工具栏。保留分组标题自己的展开交互、刷新按钮和旧未提交内容。 |
| `dsh-plugin/src/client/AlertPanel.tsx` | 复用原今日/历史、规则 CRUD 与通知权限 UI，改用带标题的模态 Portal、遮罩/关闭按钮/Escape/Tab 焦点循环；弹窗重新打开时从持久 API 刷新。 |
| `dsh-plugin/src/client/StockDetail.tsx` | 只将 MA5/10/20/30/60 数值块移到 K 线组件前，不更改数值计算或绘图逻辑。 |
| `dsh-plugin/src/client/styles.module.css` | 增加有限宽度与高度的提醒弹窗样式、滚动区域及顶部均线间距；复用现有遮罩和对话框视觉。 |
| `dsh-plugin/README.md` | 更新提醒入口/弹窗、历史入口及均线位置说明。 |
| `specs/dsh-plugin-alert-dialog-ma-layout.md` | 记录本次 Spec、Task Card 与 Review Report。 |

### 验收、验证与限制

- 源码核对：`StockTree.tsx` 不再出现「全部分组折叠」按钮，刷新入口保留；`AlertPanel` 仅在 `alertOpen` 时挂载，保留工具栏及股票菜单入口；均线 DOM 在 `<KlineChart>` 之前。宿主监测与 apply 级通知监听未改，关闭弹窗不会停掉它们。
- 使用本机现有 Node v22.23.2 运行 `node --import tsx --test tests/*.test.ts`：**97/97 通过**；直接运行 tsdown：**成功**，新 `lib/index.js`（81.92 kB）、`lib/client.js`（100.14 kB）在忽略目录生成；`node --check lib/client.js` 和 `git diff --check` 通过。没有安装新依赖。
- `node node_modules/typescript/bin/tsc --noEmit` **仍失败**，仅有此前已记录的宿主 renderer/slots 声明缺失、`ctx.slots` 类型缺失（`src/client/index.tsx:22–23,217,227,251`）及既有 Tab 位置 Schema `.volatile()` 类型不匹配（`src/index.ts:42`）；本次四个客户端文件没有新增类型诊断。
- 本项目现有 `node --import tsx` 测试环境不能导入 CSS Modules（探测得到 `ERR_UNKNOWN_FILE_EXTENSION`），且未安装 DOM 测试库。没有伪造源码字符串顺序测试；本次纯布局/弹窗交互用源码复核、bundle 构建与语法检查验证，真实点击、焦点及视觉尺寸仍需在运行中的 DSH GUI 人工验收。
- 安全与性能：未改 API/持久化/通知权限边界或行情计算。弹窗关闭时不再执行原提醒面板的 15 秒查询，重开时重新获取；宿主后台监测保持原生命周期。未改 package/lock、构建脚本、DSH 配置；未提交、推送或发布。之前未提交的 K 线和 Tab 位置差异仍在工作区，不能整体重置。

**建议人工走查：**刷新加载新客户端 bundle 后，确认工具栏减号消失、刷新仍靠右；点「提醒」与股票行「⋯ → 设置行情提醒」打开同一弹窗且后者预选股票；按 Escape、点遮罩、点关闭按钮可关闭，Tab 焦点不越出弹窗；再次打开规则/历史仍可见；展开股票详情，MA 数值行位于 K 线图上方。若现有 DSH 实例尚未加载新插件产物，需要人工确认其加载路径/刷新方式，不能把本地 bundle 构建等同于页面已更新。
