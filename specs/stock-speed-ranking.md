# VibeSpec：stock-speed-ranking

## 1. Spec

### 目标

- 在 Hermes Desktop 的 LeekFund 插件中新增独立的“涨速榜”左侧 Pane，明确停靠在股票树下方。
- 榜单覆盖沪、深、北交易所全部 A 股，按行情源返回的实时涨速从高到低展示前 20 名。
- 每条榜单只展示排名、股票名称、股票代码、当前价格和涨跌幅；涨速字段只用于排序，不在界面展示。
- 榜单每 2 秒刷新一次，与现有股票树行情刷新频率一致。

### 修改范围

- 在 Hermes 插件 Python 后端新增全 A 股涨速榜数据请求、字段解析、短缓存和私有 REST 接口。
- 在单文件 Hermes Desktop 插件中新增涨速榜查询与独立左侧 Pane。
- 为后端解析、排序、缓存、错误响应和 Desktop 静态结构补充自动化测试。
- 新增本 Spec 文件。

### 非目标范围

- 不修改现有股票树、分组、持仓、关注、状态栏和悬浮分时的业务逻辑。
- 不展示成交量、成交额、振幅、换手率、涨速值或其他未指定字段。
- 不增加榜单筛选、搜索、分页、自选添加、股票详情或点击交互。
- 不自行根据本地快照计算涨速，不持久化历史价格序列。
- 不修改 VS Code 插件代码、`package.json`、lock 文件或构建配置。
- 不新增第三方依赖。
- 不自动 commit、push 或 merge。

### 验收标准

1. Hermes Desktop 左侧股票树下方能看到具有可用高度的独立“涨速榜”Pane。
2. 榜单数据范围只包含沪、深、北交易所 A 股。
3. 后端严格按涨速降序返回最多 20 条有效记录。
4. 每条记录包含名称、六位股票代码、当前价格和涨跌幅，Desktop 不展示涨速值。
5. Desktop 每 2 秒通过 `ctx.rest` 请求插件私有接口，不直接访问外部行情源。
6. 后端对成功结果使用 2 秒内存缓存，避免同一刷新窗口重复请求上游。
7. 上游请求或数据解析失败时返回结构化错误，不清空 Desktop 已有成功数据。
8. 不影响现有股票树、状态栏和悬浮分时功能。
9. 未新增依赖，未修改 `package.json`、lock 文件和现有 VS Code 运行逻辑。
10. Python 单元测试、Python 语法检查、Desktop JavaScript 语法检查和 `git diff --check` 通过。

---

## 2. Task Card

### 当前任务

为 Hermes Desktop LeekFund 插件增加全 A 股实时涨速榜前 20 名，只展示名称、代码、现价和涨跌幅。

### 允许修改

- `specs/stock-speed-ranking.md`
- `dashboard/plugin_api.py`
- `desktop/plugin.js`
- `tests/hermes/test_plugin_api.py`

### 禁止修改

- 禁止修改 `src/`、`template/`、`template-packages/`、同步脚本和安装脚本。
- 禁止修改 `package.json`、lock 文件或构建配置。
- 禁止新增第三方依赖。
- 禁止改变股票树、分组、持仓、关注、状态栏和悬浮分时语义。
- 禁止增加 Spec 未要求的榜单交互或展示字段。
- 禁止自动 commit、push 或 merge。

### 执行步骤

1. 在后端定义全 A 股涨速榜请求参数和 2 秒内存缓存。
2. 解析行情源字段，过滤无效记录，按涨速降序截取前 20。
3. 新增 `/speed-ranking` 私有 REST 接口并统一错误响应。
4. 在 Desktop 插件中新增 2 秒刷新查询和独立“涨速榜”Pane。
5. 只渲染排名、名称、代码、现价和涨跌幅。
6. 补充后端单元测试与 Desktop 静态回归测试。
7. 执行验证并基于 Spec、Task Card 和 git diff 填写 Review Report。

### Review 检查点

- 数据范围是否严格为沪、深、北 A 股？
- 是否真正按涨速降序取前 20，而不是按涨跌幅排序？
- Desktop 是否只展示用户指定字段而未展示涨速？
- Desktop 是否只通过插件私有 REST 接口取数？
- 2 秒缓存和 2 秒刷新是否生效？
- 请求失败是否保留 React Query 上一次成功数据？
- 是否改变现有股票树、状态栏或悬浮分时逻辑？
- 是否存在无关重构、大面积格式化或新增依赖？
- 是否需要在真实 Hermes Desktop 中人工确认 Pane 布局？

---

## 3. Review Report

### Spec 符合性

结论：符合。

说明：已新增独立涨速榜 Pane、沪深北全 A 股筛选、按涨速降序截取前 20、2 秒刷新与 2 秒后端缓存；界面仅展示排名、名称、六位代码、现价和涨跌幅。真实接口验收确认沪深北全 A 股范围总量为 5,889，榜单中可见 `920357`、`920857` 等北交所股票。

### Task 完成情况

结论：全部完成。

说明：后端请求、解析、缓存、私有 REST 路由、Desktop 查询与 Pane、错误状态和自动化测试均已完成；全局目录与当前 `developer` Profile 均已重新安装，Hermes Desktop 已彻底重启并验证。

### Diff 范围检查

结论：符合 Task Card。

说明：本需求只修改 `dashboard/plugin_api.py`、`desktop/plugin.js`、`tests/hermes/test_plugin_api.py` 和本 Spec。共享代码文件中同时包含 `stock-hover-minute` Spec 的待交付改动；未修改安装脚本、VS Code 运行代码、依赖、lock 文件或构建配置，无无关重构。

### 风险检查

风险等级：低。

风险项：榜单依赖公开外部行情接口，其可用性和字段结构变化会影响刷新；Hermes Python 的 HTTPS 握手会被该接口断开，因此使用同一公开接口可用的 HTTP 入口，请求不携带账号、密钥或用户数据。2 秒缓存避免同一刷新窗口重复访问上游。

### 测试与验证

已执行验证：`python3 -m unittest tests.hermes.test_plugin_api`（36 项通过）；`python3 -m py_compile dashboard/plugin_api.py tests/hermes/test_plugin_api.py`；`node --check desktop/plugin.js`；`git diff --check`；Hermes Python 实时接口校验；Hermes Desktop 重启后真实 Pane 校验，确认 20 条记录、沪深北代码、字段和持续刷新均正确。

未覆盖风险：未做跨交易日、休市日和上游字段变更后的长时间稳定性测试。

### 合并建议

结论：可合并。

原因：Spec 验收标准全部满足，自动化与真实 Hermes Desktop 验收通过，未发现阻断问题或超范围修改。
