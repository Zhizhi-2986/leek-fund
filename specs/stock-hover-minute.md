# VibeSpec：stock-hover-minute

## 1. Spec

### 目标

- 在 Hermes Desktop 插件的 A 股股票树上，鼠标悬浮股票条目时展示一个悬浮窗，显示该股当日分时走势。
- 悬浮窗包含股票名称、代码、现价、涨跌幅，以及分时价格折线图和昨收基准线。
- 分时数据由 Hermes 本地 Python 后端通过腾讯分时数据源获取，Desktop 页面通过插件私有 REST 命名空间读取，不直接从浏览器进程请求行情接口。

### 修改范围

- `dashboard/plugin_api.py`：
  - 新增腾讯分时点与实时行情获取函数（复用腾讯 `web.ifzq.gtimg.cn` 分钟接口和 `qt.gtimg.cn` 行情接口）。
  - 新增分时结果的内存 TTL 缓存，避免悬浮高频请求重复访问外部接口。
  - 新增私有 REST 接口 `GET /stock-minute`，仅接受 A 股代码，失败返回结构化错误。
- `desktop/plugin.js`：
  - 新增 `minuteStock` API 封装。
  - 新增分时悬浮窗组件，用 SVG 渲染分时折线、昨收基准线和基础信息。
  - 在 `StockRow` 上接入 hover 交互：仅 A 股股票触发，延迟展示、鼠标移出或滚动时关闭。
- `tests/hermes/test_plugin_api.py`：
  - 新增后端分时解析、缓存、非 A 股拒绝、错误处理的单元测试。
  - 新增 Desktop 静态回归检查，锁定分时接口路径和 A 股 hover 限制。

### 非目标范围

- 不实现 K 线、日线、技术指标、成交明细或右侧详情区。
- 不新增第三方行情数据源；只复用腾讯分时与行情接口，与现有腾讯搜索链路同源。
- 不覆盖港股、美股分时走势，只支持 A 股。
- 不修改状态模型、行情快照、拖拽排序、分组、持仓、关注等既有逻辑。
- 不修改 VS Code 插件代码（`src/`、`template/`、`template-packages/`）。
- 不修改 `package.json`、lock 文件、构建配置，不新增依赖。
- 不持久化分时数据。
- 不自动 commit、push 或 merge。

### 验收标准

1. A 股股票条目鼠标悬浮后出现分时悬浮窗，展示名称、代码、现价、涨跌幅和分时折线图。
2. 悬浮窗包含昨收基准线，能辨认相对昨收的涨跌位置。
3. 港股、美股、指数及非股票条目悬浮不触发分时悬浮窗。
4. 分时数据只通过后端 `/stock-minute` 接口获取，Desktop 不直接请求行情接口。
5. 后端对分时请求有 TTL 缓存，相同代码短时间内重复悬浮不重复请求外部接口。
6. 分时接口失败时返回结构化错误，悬浮窗展示可理解的错误信息，不影响股票树。
7. 悬浮窗随鼠标移出或股票树滚动关闭，不干扰右键菜单和拖拽操作。
8. 未新增第三方依赖，未改动 VS Code 逻辑，自动化验证通过。
9. 重新部署并重启 Hermes Desktop 后，真实股票树悬浮能展示分时卡片。

---

## 2. Task Card

### 当前任务

在 Hermes Desktop 插件中为 A 股股票条目增加鼠标悬浮分时走势悬浮窗，数据通过后端腾讯分时接口提供并做 TTL 缓存。

### 允许修改

- `specs/stock-hover-minute.md`
- `dashboard/plugin_api.py`
- `desktop/plugin.js`
- `tests/hermes/test_plugin_api.py`

### 禁止修改

- 禁止修改 `src/`、`template/`、`template-packages/` 及 VS Code 插件逻辑。
- 禁止修改 `package.json`、`yarn.lock`、`package-lock.json` 或构建配置。
- 禁止新增第三方依赖。
- 禁止修改状态模型、行情快照、拖拽、分组、持仓、关注等既有逻辑。
- 禁止接入新的第三方行情数据源。
- 禁止实现 K 线、日线、港股/美股分时或其他非目标功能。
- 禁止自动 commit、push 或 merge。
- 禁止写入密钥、Token、生产地址或其他敏感信息。

### 执行步骤

1. 后端新增腾讯分时点获取函数：请求 `web.ifzq.gtimg.cn/appstock/app/minute/query`，解析分钟点数据。
2. 后端新增腾讯实时行情获取函数：请求 `qt.gtimg.cn`，获取名称、昨收、现价等字段。
3. 后端新增内存 TTL 缓存，锁保护，缓存分时结果。
4. 后端新增 `GET /stock-minute` 路由，校验 A 股代码，返回结构化结果或错误。
5. Desktop 新增 `minuteStock` API 封装。
6. Desktop 新增分时悬浮窗组件，用 SVG 渲染折线、昨收基准线、网格和基础信息。
7. `StockRow` 接入 hover 交互：仅 A 股、延迟 300ms 展示、移出或滚动时关闭。
8. 新增后端单元测试和 Desktop 静态回归检查。
9. 执行验证命令：Python 单元测试、Python 语法检查、Desktop ESM `node --check`、`git diff --check`。
10. 对比源码和 Hermes 安装目录，确认安装文件包含分时接口与悬浮组件。
11. 重新安装插件并彻底重启 Hermes Desktop，在真实股票树验证悬浮分时。
12. 基于本 Spec、Task Card 和 git diff 填写 Review Report，输出 Diff Summary。

### Review 检查点

- 是否满足 Spec 目标？
- 是否覆盖验收标准？
- 分时数据是否只通过后端 `/stock-minute` 获取？
- 是否仅 A 股触发悬浮窗？
- 是否新增未说明依赖或行情数据源？
- 是否影响既有快照、拖拽、分组、持仓、关注逻辑？
- 缓存是否线程安全、TTL 是否合理？
- 悬浮窗是否随滚动关闭、不干扰右键菜单和拖拽？
- 分时接口失败是否结构化返回且不破坏股票树？
- 是否存在潜在 bug、兼容性或性能风险？
- Hermes 安装目录是否已更新为当前源码，真实悬浮是否生效？
- 是否需要人工确认？

---

## 3. Review Report

### Spec 符合性

结论：符合。

说明：A 股股票行悬浮后展示名称、代码、现价、涨跌幅、当日分时折线和昨收基准线；数据只由本地 Python 后端的 `/stock-minute` 私有接口提供，具备 60 秒线程安全缓存，并限制为沪深北 A 股代码。

### Task 完成情况

结论：全部完成。

说明：腾讯分钟点与实时报价解析、结构化错误、缓存、Desktop SVG 悬浮卡和 hover 生命周期均已完成。未生效的根因是 Hermes 当前 `developer` Profile 仍加载旧安装副本；全局目录和该 Profile 均已更新，重启后真实股票行已展示分时卡片。

### Diff 范围检查

结论：符合 Task Card。

说明：修改限定在本 Spec、后端、Desktop 单文件插件和 Hermes 测试文件；共享文件中同时包含 `stock-speed-ranking` Spec 的改动。未修改状态模型、VS Code 代码、依赖、lock 文件、构建配置或安装脚本。

### 风险检查

风险等级：低。

风险项：分时展示依赖腾讯公开行情接口；接口不可用或字段变化时悬浮卡会显示结构化错误，但不会影响股票树。固定定位已在当前 Hermes 窗口真实验证，其他显示器缩放组合未单独覆盖。

### 测试与验证

已执行验证：`python3 -m unittest tests.hermes.test_plugin_api`（36 项通过）；Python 语法检查；Desktop JavaScript 语法检查；`git diff --check`；Hermes Python 实时接口返回有效分钟点；Hermes Desktop 彻底重启后，在 `sh512980` 股票行真实触发悬浮，确认曲线、昨收和最新时间均显示。

未覆盖风险：未做多显示器、不同系统缩放比例和上游字段变更后的长期回归。

### 合并建议

结论：可合并。

原因：Spec、Task Card 和验收标准均已覆盖，自动化与真实 UI 验证通过，未发现阻断问题。
