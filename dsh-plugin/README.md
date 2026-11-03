# dsh-leek-fund

LeekFund 股票行情工具集 —— DeepSeek Harness（DSH）插件。

以模型工具集形态提供 A 股行情能力：实时行情查询、A 股搜索、自选股管理、两级自定义分组、持仓/关注标记。数据通过 DSH 状态文件持久化，重启后保留。

## 安装

### 作为 bundle 安装（推荐）

```sh
# 从仓库根目录
dsh plugin --profile <name> add ./dsh-plugin
dsh --profile <name>
```

`dsh plugin add` 会通过 pnpm 链接本目录，并将 `dsh-leek-fund` 追加到 profile 的 `dsh.profile.bundles` 列表。卸载：

```sh
dsh plugin --profile <name> remove dsh-leek-fund
```

### 本地开发加载

仓库内已备好 dev overlay（`cordis.dev.yml`，指向构建产物 `./lib/index.js`；patch 里的相对 `name` 由 CLI 锚定到 patch 文件所在目录，因此无需绝对路径或占位符）：

```sh
cd dsh-plugin
npm run bundle                     # tsdown -> lib/index.js（host）+ lib/client.js（浏览器端）

dsh web --patch /绝对路径/leek-fund/dsh-plugin/cordis.dev.yml
```

两个容易踩的点：

- `--patch` 必须写在 `web`（或 `--profile <name>`）之后、在透传给 app 的参数（`--port`、`--no-open` …）**之前**——`web` 子命令开了 `passThroughOptions`，一旦出现 `--port` 这类参数，后面的 `--patch` 就不再被解析（报 `unknown option '--patch'`）。正确写法：`dsh web --patch <file> --port 3199`。
- **客户端 bundle 始终取自 `lib/client.js`**，所以改动 `src/client/**` 后必须重新 `npm run bundle`；改 host 源码若想免构建，可以从 `src/index.ts` 直接加载，但 `src/**` 里的 `import './api.js'` 是 ESM `.js` 说明符指向 `.ts` 源文件，Node 自身解析不了，需要 tsx 加载器：仓库根的 `pnpm dsh`（`node --import tsx/esm apps/cli/src/bin.ts`）已预载；用已发布的 `dsh` CLI 则写 `NODE_OPTIONS="--import tsx" dsh web --patch <指向 src/index.ts 的 patch>`（缺 tsx 时会以 `Cannot find module '.../src/api.js'` 启动失败）。

`npm run build` 会先跑 `tsc -p tsconfig.build.json` 产出 `lib/types/**`，仓库内任何类型错误都会让它在中途退出；只要 bundle 时用 `npm run bundle` 即可绕过。

## 配置

请求超时时间可通过 `cordis.yml` 中插件行的 `config` 覆盖（bundle 模式下可在 profile 的 `cordis.patch.yml` 覆盖）：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `timeoutMs` | number | `8000` | 行情/搜索请求超时（毫秒） |

```yaml
- insert:
    - id: leek-fund
      name: dsh-leek-fund
      config:
        timeoutMs: 10000
```

## 工具

| 工具 | 说明 |
|---|---|
| `stock_quote` | 查询实时行情（默认全部自选，可指定代码；A 股与指数） |
| `stock_search` | 按代码或中文名称搜索 A 股（沪深京） |
| `stock_watchlist` | 查看自选股、分组、持仓、关注全貌 |
| `stock_add` / `stock_remove` | 添加/删除自选股 |
| `stock_group_create` / `stock_group_rename` / `stock_group_delete` | 分组管理（支持一级/二级，仅 A 股） |
| `stock_group_move` | 股票移入分组或移回未分组 |
| `stock_mark` | 切换持仓/关注/重点关注（focus）标记 |
| `stock_alert_create` / `stock_alert_list` / `stock_alert_delete` | 经用户确认建立、查看、删除目标价或当日涨跌幅提醒 |

代码格式：A 股 `sh/sz/bj` + 6 位数字；指数 `sh000001` 等 A 股指数或 `b_` / `int_` 前缀（不识别港股/美股代码）。

## 数据与持久化

- 状态文件默认 `~/.dsh/leek-fund/state.json`（JSON，原子写盘）。
- 自选股全集、一级/二级分组、持仓/关注/重点关注（focus）标记、状态栏股票子集均持久化。
- 分组约束：最多两级、仅 A 股市场、id 唯一；删除分组保留股票。
- 未分组且无标记的 A 股自选会自动归入"关注"（与 Hermes 版行为一致）。
- ETF（`sh51/52/56/588/589`、`sz159` 或名称含 ETF）现价展示三位小数截断。
- **一次性数据迁移**：升级到仅 A 股版本后首次加载时，状态文件里旧的港股/美股代码（`hk*`、`usr_*`、`gb_*`）与非 A 股分组会被自动剔除（`normalizeState` 只保留 A 股代码与 A 股分组），无需手工处理。

## 开发

```sh
cd dsh-plugin
npm install        # 安装 typescript / tsx / @types/node
npm run typecheck  # tsc --noEmit
npm test           # node --test
npm run build      # tsc -> lib/
```

`@deepseek-ai/*` 为 DSH 内置包（peerDependencies），开发时从 DSH 安装目录解析；未安装 DSH 时，将 DSH 安装的 `$DSH_HOME/profiles/node_modules/@deepseek-ai` 符号链接到 `dsh-plugin/node_modules/@deepseek-ai` 即可本地开发。

## 行情 Tab

「行情」默认注册在官方右侧栏，也可以在插件设置里改为注册到**会话工作区 Tab**（与「对话」「上下文」「文件」同排）。两种位置的内容与交互完全一致。

### 注册位置

1. 打开 设置 → 插件（Plugins）→ `dsh-leek-fund` 详情页。
2. 在「行情 Tab 注册位置」中选择「侧边栏」或「工作区」。
3. 切换立即生效（无需重启），配置随插件设置持久化。

- **侧边栏（默认）**：「行情」以官方右侧 Sidebar 的 tab 类型（`kind: leek-fund`）注册，与内置的 Files / 文本预览同一套两阶段扩展点（`ctx.sidebarRightTabs` + `sidebar.right.pane.tab` slot），不依赖任何第三方侧边栏插件。
- **工作区**：「行情」注册为会话顶部 Tab（`conversation.view` slot），与「对话」「上下文」「文件」同排。

> 前置：DSH 自带 `@deepseek-ai/dsh-client-ui-sidebar-right`（`@deepseek-ai/dsh-web-app` bundle 内）与插件配置服务（`configForms`）。缺失时插件照常加载：右侧栏模式仅不注册 tab，工作区模式保持默认的侧边栏行为。

### 侧边栏模式如何打开

安装并重启后，硬刷新浏览器（Cmd/Ctrl+Shift+R）：

1. 在会话头部点开右侧栏（展开按钮），或直接展开已打开的右栏。
2. 点 tab 条上的 `+`（新增 tab）打开引导页。
3. 在引导页点「行情」入口框——该 tab 就地替换引导页，可停靠、分栏、浮出、关闭。

> 官方规则：右栏默认页由已注册的引导入口数决定——只有一个入口时直接打开它，多个入口时打开引导页。插件加载后入口变成两个（Files、行情），因此新会话的右栏默认显示引导页（点 Files 立即进入文件树）。

展开后：

- **股票树**：只展示 A 股分类，顺序为持仓股、重点关注、未分组（不在自定义分组中的 A 股）、自定义分组（一级/二级，二级缩进）；重点关注是附加标记，未分组是分组状态，二者可以重叠。新增股票默认留在未分组。
- **重点关注（focus）**：可通过股票行「⋯」菜单或模型侧 `stock_mark` 维护，列表内独立排序；删除股票时清理标记。
- **行情新鲜度**：行情树可见时每 2 秒更新，逐行标注交易状态及行情时间，显示最近成功刷新时间；断网时旧价标记更新失败。展开的详情每 30 秒更新当日 5 分钟 K 线（页面隐藏时暂停），MA5/10/20/30/60 数值显示在 K 线图上方；上涨红色、下跌绿色（低强度）；ETF 现价三位小数截断。
- **分组涨跌汇总**：分组标题后显示 `↑上涨 ↓下跌 =平盘`，一级父分组汇总含二级子分组（按代码去重）。
- **操作**：右键股票行 → 移动到…/持仓/加入平铺条/删除；右键分组标题 → 创建二级分组/重命名/删除；工具栏「添加股票」按代码或中文名称搜索沪深京 A 股；点击分组标题展开/折叠。
- **拖动排序**：股票在组内/未分组拖拽排序、拖到分组标题跨组移动；持仓/关注/重点关注列表各自独立排序；分组在同级范围内排序。拖动成功静默，失败显示错误。
- **顶部平铺条**：固定指数（上证指数、创业板指、科创50、日经 225、韩国 KOSPI）与加入平铺条的股票平铺展示，2 秒刷新。

### 今日关注与桌面提醒

1. 在行情工具栏点「提醒」，或从股票行「⋯ → 设置行情提醒」打开弹窗（后者预选该股）。弹窗里的「今日关注」展示最多 3 条最近触发的提醒，展开「查看历史记录」可回顾最近 10 条；选择自选股、价格或当日涨跌幅、高于/低于和阈值，确认后保存。默认无规则，不会自动荐股或交易。
2. 在提醒弹窗里明确点击「启用桌面通知」授权；浏览器拒绝或不支持通知时，事件仍保存在弹窗中。行情时间不可靠、非 A 股交易时段、数据过期时不触发；同一规则每交易日最多提醒一次。
3. 规则与历史事件保存在插件数据目录；行情页不打开时，只要 **DSH 宿主仍运行**，后台检查仍会记录事件。桌面通知需客户端仍连接、操作系统/浏览器允许；应用或浏览器完全退出时不保证实时弹窗，重开后在提醒弹窗仍可查看历史。浏览器后台节流也可能导致通知延迟。

> 前置：DSH 自带 `@deepseek-ai/dsh-client-ui-sidebar-right`（`@deepseek-ai/dsh-web-app` bundle 内）。缺失时插件照常加载，仅不注册 tab。展开状态按 tab 保存在浏览器内存中：切换 tab 后切回仍保持，tab 关闭或刷新页面即丢失（官方右栏的布局本就不跨刷新持久化）。
