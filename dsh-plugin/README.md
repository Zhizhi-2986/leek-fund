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

```sh
dsh web --patch /绝对路径/leek-fund/dsh-plugin/cordis.dev.yml
```

> `cordis.dev.yml` 中的插件行 `name` 必须指向**绝对路径**（Loader 相对 profile 目录解析模块路径）。将文件中的 `$LEEK_FUND_ROOT` 替换为仓库绝对路径，或在仓库根执行 `dsh web --patch "$(pwd)/dsh-plugin/cordis.dev.yml"`（同样需先替换占位符）。

修改源码后重新构建：`npm run build`（bundle 安装模式），或直接重启 `dsh web --patch ...`（源码加载模式）。

## 配置

通过 `cordis.yml` 中插件行的 `config` 覆盖（bundle 模式下可在 profile 的 `cordis.patch.yml` 覆盖）：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `dataPath` | string | `$DSH_HOME/leek-fund/state.json` | 状态文件绝对路径 |
| `timeoutMs` | number | `8000` | 行情/搜索请求超时（毫秒） |

```yaml
- insert:
    - id: leek-fund
      name: dsh-leek-fund
      config:
        dataPath: /Users/me/.dsh/leek-fund/state.json
        timeoutMs: 10000
```

## 工具

| 工具 | 说明 |
|---|---|
| `stock_quote` | 查询实时行情（默认全部自选，可指定代码；A 股/港股/美股/指数） |
| `stock_search` | 按代码或中文名称搜索 A 股（沪深京） |
| `stock_watchlist` | 查看自选股、分组、持仓、关注全貌 |
| `stock_add` / `stock_remove` | 添加/删除自选股 |
| `stock_group_create` / `stock_group_rename` / `stock_group_delete` | 分组管理（支持一级/二级） |
| `stock_group_move` | 股票移入分组或移回未分组 |
| `stock_mark` | 切换持仓/关注标记 |

代码格式：A 股 `sh/sz/bj` + 6 位数字，港股 `hk` + 5 位数字，美股 `usr_` 或 `gb_` 前缀，指数 `sh000001` 等或 `b_` / `int_` 前缀。

## 数据与持久化

- 状态文件默认 `$DSH_HOME/leek-fund/state.json`（JSON，原子写盘）。
- 自选股全集、一级/二级分组、持仓/关注标记、状态栏股票子集均持久化。
- 分组约束：最多两级、同市场、id 唯一；删除分组保留股票。
- 未分组且无标记的 A 股自选会自动归入"关注"（与 Hermes 版行为一致）。
- ETF（`sh51/52/56/588/589`、`sz159` 或名称含 ETF）现价展示三位小数截断。

## 开发

```sh
cd dsh-plugin
npm install        # 安装 typescript / tsx / @types/node
npm run typecheck  # tsc --noEmit
npm test           # node --test
npm run build      # tsc -> lib/
```

`@deepseek-ai/*` 为 DSH 内置包（peerDependencies），开发时从 DSH 安装目录解析；未安装 DSH 时，将 DSH 安装的 `$DSH_HOME/profiles/node_modules/@deepseek-ai` 符号链接到 `dsh-plugin/node_modules/@deepseek-ai` 即可本地开发。

## 行情 Tab（better-sidebar）

安装并重启后，硬刷新浏览器（Cmd/Ctrl+Shift+R），在 dsh-sidebar 右侧栏的 `+` 菜单中找到「行情」tab（与 explorer / 终端 / Git 同级）：

- **股票树**：只展示 A 股分类，顺序为持仓股、关注（即未分组，所有不在自定义分组中的 A 股）、自定义分组（一级/二级，二级缩进）；添加的股票自动进入关注。
- **实时行情**：每 2 秒刷新（tab 不可见时暂停）；上涨红色、下跌绿色（低强度）；ETF 现价三位小数截断。
- **分组涨跌汇总**：分组标题后显示 `↑上涨 ↓下跌 =平盘`，一级父分组汇总含二级子分组（按代码去重）。
- **操作**：右键股票行 → 移动到…/持仓/加入平铺条/删除；右键分组标题 → 创建二级分组/重命名/删除；工具栏「添加股票」按代码或中文名称搜索沪深京 A 股；点击分组标题展开/折叠。
- **拖动排序**：股票在组内/未分组拖拽排序、拖到分组标题跨组移动；持仓/关注列表各自独立排序；分组在同级范围内排序。拖动成功静默，失败显示错误。
- **顶部平铺条**：固定指数（上证指数、创业板指、科创综指、日经 225、韩国 KOSPI）与加入平铺条的股票平铺展示，2 秒刷新。

> 前置：需要安装 dsh-sidebar（`dsh plugin --profile web add dsh-sidebar@latest` 或本地 link）。未安装时插件照常加载，仅不注册 tab。
