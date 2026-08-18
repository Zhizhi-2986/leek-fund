# VibeSpec：dsh-plugin

## 1. Spec

### 目标

- 将 leek-fund 从 "Hermes Desktop 插件" 模式改造为 **DeepSeek Harness（DSH）插件** 模式。
- 新增一个独立、可安装的 DSH bundle（`dsh-plugin/`），以**模型工具集**形态提供股票能力：行情查询、A 股搜索、自选股管理、两级自定义分组管理、持仓/关注标记。
- 状态持久化到 `$DSH_HOME/leek-fund/state.json`（路径可配置），DSH 重启后保留。
- 删除上一轮 Hermes 插件遗留文件，完成向 DSH 的完全迁移；VSCode 插件源码（`src/` 等）保持不动、不受影响。
- 提供 bundle 安装（`dsh plugin add`）与本地开发加载（`dsh web --patch`）两种使用方式。

### 修改范围

- 新增 `dsh-plugin/` bundle 包（独立 npm 包，`dsh.bundle` manifest）：
  - `dsh-plugin/package.json`：`name: dsh-leek-fund`，声明 `dsh.bundle.patch`，`main` 指向构建产物。
  - `dsh-plugin/cordis.patch.yml`：bundle 配置层，插入插件行并引用包名。
  - `dsh-plugin/tsconfig.json` 与 `tsconfig.build.json`：类型检查与构建配置。
  - `dsh-plugin/src/index.ts`：插件入口，导出 `name` 与 `apply(ctx)`，注册全部工具。
  - `dsh-plugin/src/types.ts`：共享类型（行情、分组、状态）。
  - `dsh-plugin/src/state.ts`：状态持久化（原子写盘）与状态操作（分组约束、持仓/关注子集）。
  - `dsh-plugin/src/quote.ts`：行情获取与解析（新浪 A 股/美股/全球指数 + 腾讯港股），ETF 三位小数截断。
  - `dsh-plugin/src/search.ts`：腾讯股票搜索，只返回沪深京 A 股。
  - `dsh-plugin/src/tools.ts`：全部工具定义（`defineTool`）。
  - `dsh-plugin/tests/*.test.ts`：node:test 单元测试。
  - `dsh-plugin/README.md`：安装、配置、工具说明。
- 新增 `dsh-plugin/cordis.dev.yml`：开发用 patch 示例（引用本目录源码，供 `--patch` 加载）。
- 新增 `specs/dsh-plugin.md`（本文件）。
- 删除 Hermes 遗留文件：`plugin.yaml`、`__init__.py`、`dashboard/`、`desktop/`、`scripts/install-hermes.sh`、`scripts/sync-vscode-data.py`、`tests/hermes/`。

### 非目标范围

- 不修改 VSCode 插件代码：`src/`、`template/`、`template-packages/`、根 `package.json`、`yarn.lock`、`package-lock.json`。
- 不实现 Conversation Node / Web UI 展示 / 自定义页面。
- 不实现定时任务、价格提醒、K 线、技术指标、策略或交易能力。
- 不新增行情数据源；仅复用新浪行情与腾讯搜索。
- 不实现 VSCode 数据自动/手动同步（Hermes 版同步脚本随遗留删除；状态模型保持与 VSCode 语义兼容，为将来同步预留）。
- 不修改根 README 与文档（可在 Review 阶段人工确认是否需要补充）。
- 不自动 commit、push、merge。

### 验收标准

1. `dsh-plugin/` 是独立 npm 包，含 `dsh.bundle` manifest 与 `cordis.patch.yml`；`dsh plugin add ./dsh-plugin` 可安装到 profile，`--dump-config` 能显示该 bundle 层。
2. 插件导出 `name: 'leek-fund'` 与 `apply(ctx)`，加载后通过 `ctx.tools.register(defineTool(...))` 注册以下工具：
   - `stock_quote`：查询指定代码或全部自选的实时行情（A 股/港股/美股/指数）。
   - `stock_search`：按代码或中文名称搜索，仅返回沪深京 A 股。
   - `stock_watchlist`：查看自选股、分组、持仓、关注全貌。
   - `stock_add` / `stock_remove`：添加/删除自选股。
   - `stock_group_create` / `stock_group_rename` / `stock_group_delete`：分组管理（支持一级/二级）。
   - `stock_group_move`：股票移入分组或移回未分组。
   - `stock_mark`：切换持仓/关注标记。
3. 行情解析复用 Hermes 版已实现的字段语义（`_quote` / `_parse_sina_cn` / `_parse_sina_us` / `_parse_sina_global_index` / `fetch_hk_quotes`），ETF 价格三位小数截断规则一致；搜索复用 `parse_tencent_stock_search` 的 A 股过滤语义。
4. 状态写入 `$DSH_HOME/leek-fund/state.json`（默认，`dataPath` 可覆盖），原子写盘（临时文件 + rename），重启后保留；`schema_version` 字段与 Hermes 版一致（2）。
5. 分组约束与 Hermes 版一致：最多两级、同市场、id 唯一、二级分组不能有子分组、删除分组保留股票。
6. `tsc --noEmit` 通过；`node --test` 单元测试通过（行情解析、状态操作、分组约束、搜索过滤）。
7. 开发加载：`dsh web --patch ./dsh-plugin/cordis.dev.yml`（或等价 dump-config 方式）能识别插件层；模型在真实会话中可调用 `stock_quote` 等工具并获得正确结果。
8. Hermes 遗留文件已删除；`git status` 确认 `src/` 无任何改动。
9. `dsh-plugin` 运行时依赖仅 `@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-tools`（peerDependencies，由 DSH 安装提供），无第三方运行时依赖；不修改根 lock 文件。

---

## 2. Task Card

### 当前任务

新增 DSH bundle 插件 `dsh-plugin/`（模型工具集：行情/搜索/自选/分组/持仓关注），删除 Hermes 遗留文件，完成 leek-fund 到 DSH 插件模式的完全迁移。

### 允许修改

- `specs/dsh-plugin.md`
- `dsh-plugin/**`（全部为新增文件）
- 删除以下 Hermes 遗留文件：`plugin.yaml`、`__init__.py`、`dashboard/`、`desktop/`、`scripts/install-hermes.sh`、`scripts/sync-vscode-data.py`、`tests/hermes/`

### 禁止修改

- 禁止修改 `src/`、`template/`、`template-packages/`、根 `package.json`、`yarn.lock`、`package-lock.json`、根构建配置。
- 禁止修改其余 `specs/*.md`（除本文件外）。
- 禁止新增未说明依赖；`dsh-plugin` 依赖仅限 DSH 官方包（peerDependencies）。
- 禁止实现非目标范围功能（UI 节点、定时任务、提醒、K 线、交易、新行情源）。
- 禁止自动 commit、push、merge。
- 禁止写入密钥、Token、生产地址或其他敏感信息。

### 执行步骤

1. 在 `dsh-plugin/` 下创建 bundle 骨架：`package.json`（`dsh.bundle`）、`cordis.patch.yml`、`cordis.dev.yml`、`tsconfig.json`/`tsconfig.build.json`。
2. 移植状态模块 `src/state.ts`：默认股票、代码规范化、分组归一化（最多两级/同市场/id 唯一）、持仓/关注子集、原子写盘、数据目录解析。
3. 移植行情模块 `src/quote.ts`：新浪 A 股/美股/全球指数解析、腾讯港股解析、ETF 三位小数截断、统一 `Quote` 结构。
4. 移植搜索模块 `src/search.ts`：腾讯搜索请求与 A 股过滤。
5. 实现 `src/tools.ts` 与 `src/index.ts`：用 `defineTool` 注册 10 个工具，`Config` schema（`dataPath`、`timeoutMs`），加载时初始化状态目录。
6. 编写 `tests/` 单元测试：行情解析（含 ETF 截断）、状态操作与分组约束、搜索过滤。
7. 在 `dsh-plugin/` 内执行 `tsc --noEmit`、`node --test`、`tsc -p tsconfig.build.json` 构建，全部通过。
8. 删除 Hermes 遗留文件，`git status` 确认删除清单与 `src/` 无改动。
9. 验证 bundle：`dsh --profile <name> --patch ./dsh-plugin/cordis.dev.yml --dump-config` 显示插件层；必要时在真实 DSH 会话中调用工具。
10. 基于本 Spec、Task Card 与 git diff 填写 Review Report，输出 Diff Summary。

### Review 检查点

- 是否满足 Spec 目标（DSH 插件化 + Hermes 遗留删除）？
- 是否覆盖全部验收标准？
- 工具 schema 是否正确（参数类型、`output.schema`、`render`）？
- 行情/搜索/状态逻辑是否与 Hermes 版语义一致？
- 是否超出允许修改范围、存在无关重构？
- `dsh-plugin` 是否引入第三方运行时依赖？
- 删除 Hermes 文件是否干净、是否误删其他文件？
- `src/` 与根构建配置是否零改动？
- 是否存在潜在 bug（原子写盘、并发、网络失败、空状态）？
- 是否需要人工确认（真实 DSH 会话调用、安装到用户 profile）？

---

## 3. Review Report

### Spec 符合性

结论：符合。

说明：

- 新增独立 DSH bundle `dsh-plugin/`（`name: dsh-leek-fund`，`dsh.bundle.patch` manifest），以模型工具集形态提供 10 个工具：行情查询、A 股搜索、自选增删、分组管理（一级/二级）、持仓/关注标记。
- 状态持久化到 `$DSH_HOME/leek-fund/state.json`（默认，`dataPath` 可覆盖），原子写盘，`schema_version = 2` 与 Hermes 版一致。
- 行情解析（新浪 A 股/美股/全球指数 + 腾讯港股）与 ETF 三位小数截断、搜索 A 股过滤，均与 Hermes 版字段语义一致。
- Hermes 遗留文件（`plugin.yaml`、`__init__.py`、`dashboard/`、`desktop/`、`scripts/`、`tests/hermes/`）已全部删除；`src/`（VSCode 插件）零改动。
- 提供 bundle 安装（`dsh plugin add`）与本地开发加载（`--patch`）两种方式，均已在隔离 DSH_HOME 验证。
- 运行时依赖仅 `@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-tools`（peerDependencies），无第三方运行时依赖；未修改根 `package.json` 与 lock 文件。

### Task 完成情况

结论：已完成代码、自动化验证与隔离环境加载验证。

说明：

- 已实现 bundle 骨架：`package.json`（`dsh.bundle`）、`cordis.patch.yml`、`cordis.dev.yml`、`tsconfig.json`/`tsconfig.build.json`、`README.md`。
- 已移植状态模块（代码规范化、分组两级/同市场/id 唯一约束、孤儿 A 股归入关注、原子写盘）。
- 已移植行情模块（`parseSinaBody`、港股 `fetchHkQuotes`、ETF 截断）与搜索模块（腾讯 A 股过滤）。
- 已用 `defineTool` 注册 10 个工具，均带类型化参数、canonical 输出与纯 render。
- 已编写 37 个单元测试（行情解析、状态操作、分组约束、搜索过滤、驼峰往返），全部通过；`tsc --noEmit` 与 `tsc -p tsconfig.build.json` 构建通过。
- 已修复开发中发现的状态往返 bug：`normalizeState` 只认下划线字段导致内部驼峰对象二次归一化丢失组内股票与标记，现同时兼容两种字段名并补充回归测试。
- 已删除 Hermes 遗留文件（9 个路径），`git status` 确认 `src/` 无改动。
- 隔离 DSH_HOME 验证：`--patch` 与 bundle 两种方式均出现在 `--dump-config`；bundle 安装到测试 profile 成功；工具端到端执行（10 工具注册、状态增删改查、真实行情 4 只、真实搜索）全部成功。

### Diff 范围检查

结论：符合 Task Card。

说明：

- 新增文件均在允许范围内：`dsh-plugin/**`（16 个文件）、`specs/dsh-plugin.md`。
- 删除文件均为 Hermes 遗留清单中的 9 个路径。
- 未发现无关重构、大面积格式化；`src/`、`template/`、`template-packages/`、根 `package.json`、lock 文件均未改动。
- 未新增第三方运行时依赖；`dsh-plugin/node_modules`、`lib/`、`package-lock.json` 已被 gitignore 排除。

### 风险检查

风险等级：中。

风险项：

- 真实 DSH GUI 中的模型调用（headless 一次性任务）需要 LLM API key，本轮在隔离 DSH_HOME（无凭据）无法执行；已通过 dump-config、bundle 安装与工具级端到端执行覆盖插件加载与工具可用性，真实会话调用仍需人工确认。
- bundle 安装只验证到隔离测试 profile，未安装到用户真实 profile（`web`/`workbench`），避免改动用户环境；用户可按需执行 `dsh plugin --profile <name> add ./dsh-plugin`。
- 行情与搜索接口是外部公开服务，字段变化可能影响解析；已实现失败保留与错误返回，但接口兼容性不可控。
- 删除 Hermes 遗留文件不可逆（git 可回滚到删除前版本）；Hermes 版状态文件（`$HERMES_HOME/plugins/leek-fund/data/state.json`）不在本仓库、未受影响。
- `cordis.dev.yml` 中的 `$LEEK_FUND_ROOT` 占位符需替换为绝对路径（Loader 相对 profile 目录解析模块路径），README 已说明。
- `dsh-plugin` 使用本地 `@deepseek-ai/*` 符号链接进行开发（DSH 内置包不在 npm registry），README 已说明前置条件。

### 测试与验证

已执行验证：

- `dsh-plugin` 内 `npm run typecheck`（`tsc --noEmit`）：通过。
- `npm test`（node:test，37 用例）：全部通过（行情解析含 ETF 截断、状态操作与分组约束、搜索过滤、驼峰往返回归）。
- `npm run build`（`tsc -p tsconfig.build.json` → `lib/`）：通过。
- `git status`：9 个 Hermes 遗留删除、`dsh-plugin/**` 与 `specs/dsh-plugin.md` 新增、`src/` 零改动。
- 隔离 DSH_HOME（`/tmp`）`--dump-config`：`# == /tmp/leek-fund-dev.patch.yml` 层显示 `leek-fund` 行，patch 源码加载识别成功。
- 隔离 DSH_HOME `dsh plugin --profile leek-test add ./dsh-plugin`：安装成功（`+ dsh-leek-fund link:...`）。
- 隔离 DSH_HOME `--dump-config`：`# == dsh-leek-fund` bundle 层显示 `name: dsh-leek-fund`。
- 工具端到端执行（临时脚本）：10 个工具全部注册；`stock_add`/`stock_group_create`/`stock_group_move`/`stock_mark` 状态写入正确；`stock_quote` 真实获取浦发银行、苹果、上证指数、腾讯控股行情；`stock_search` 按"浦发"返回浦发银行等 A 股候选。

未覆盖风险：

- 真实 DSH GUI 会话中模型实际调用工具（需用户环境与 LLM key）。
- 安装到用户真实 profile（`web`/`workbench`）后的启动与使用。
- 外部行情/搜索接口的长周期稳定性。

### 合并建议

结论：需人工确认。

原因：代码、自动化测试、构建与隔离环境加载验证均已完成；工具在真实网络下端到端可用，状态持久化与分组约束正确。但真实 DSH GUI 中的模型调用与安装到用户 profile 属于用户环境操作，需人工确认后执行。
