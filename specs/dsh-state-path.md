# VibeSpec: dsh-state-path

## Spec

### 目标

- 将 DSH 插件默认状态文件读写位置固定为 `~/.dsh/leek-fund/state.json`。
- 避免在未设置 `DSH_HOME` 时退回到 `process.cwd()/.dsh-leek-fund/state.json`，导致不同启动目录产生多份状态。

### 修改范围

- `dsh-plugin/src/state.ts`
- `dsh-plugin/src/index.ts`
- `dsh-plugin/tests/state.test.ts`
- `dsh-plugin/tests/state.test.js`
- `dsh-plugin/README.md`
- `specs/dsh-state-path.md`

### 非目标范围

- 不修改状态 JSON schema。
- 不实现历史状态文件自动迁移。
- 不修改 DSH 右侧栏、行情请求、分组业务逻辑。
- 不修改 package 或 lock 文件。
- 不自动 commit、push、merge。

### 验收标准

1. 未传 `dataPath` 时，`resolveStatePath()` 返回当前用户 home 下的 `.dsh/leek-fund/state.json`。
2. 不再因为 `DSH_HOME` 未设置而落到 `process.cwd()/.dsh-leek-fund/state.json`。
3. DSH 插件运行时不再暴露 `dataPath` 配置覆盖。
4. 文档中的状态文件路径与代码一致。
5. 相关测试通过。

## Task Card

### 当前任务

固定 DSH 插件默认状态文件路径为 `~/.dsh/leek-fund/state.json`。

### 允许修改

- 调整状态路径解析函数及注释。
- 更新入口配置注释与 README。
- 增加或更新状态路径测试。
- 填写本文件 Review Report。

### 禁止修改

- 禁止改动股票树 UI、行情 API、分组/持仓/关注业务规则。
- 禁止引入新依赖。
- 禁止修改构建配置、package、lock 文件。
- 禁止做迁移脚本或删除历史数据文件。

### 执行步骤

1. 修改 `resolveStatePath()` 默认路径。
2. 更新相关注释和 README。
3. 补充默认路径测试。
4. 运行相关测试。
5. 基于 Spec、Task Card 和 git diff 填写 Review Report。

### Review 检查点

- 默认路径是否严格指向 `~/.dsh/leek-fund/state.json`。
- DSH 插件运行时是否没有 `dataPath` 覆盖入口。
- 是否仍使用原子写盘。
- 是否没有触碰非目标范围。
- 是否存在历史数据需人工迁移确认。

## Review Report

### Diff Summary

1. 修改文件列表

- `dsh-plugin/src/state.ts`
- `dsh-plugin/src/index.ts`
- `dsh-plugin/tests/state.test.ts`
- `dsh-plugin/tests/state.test.js`
- `dsh-plugin/README.md`
- `specs/dsh-state-path.md`

2. 每个文件的修改原因

- `dsh-plugin/src/state.ts`：将未配置 `dataPath` 时的默认状态文件路径改为 `homedir()/.dsh/leek-fund/state.json`，移除 `DSH_HOME` 与 `process.cwd()` fallback。
- `dsh-plugin/src/index.ts`：移除 DSH 插件运行时的 `dataPath` 配置入口，固定调用默认状态路径。
- `dsh-plugin/tests/state.test.ts`：新增默认路径断言，覆盖 `resolveStatePath()` 未传参行为。
- `dsh-plugin/tests/state.test.js`：同步已跟踪的 JS 测试文件。
- `dsh-plugin/README.md`：同步固定状态文件路径说明，并移除 `dataPath` 配置示例。
- `specs/dsh-state-path.md`：记录本次需求、任务边界和审查结果。

3. 是否满足 Spec 验收标准

- 满足。默认路径已固定为当前用户 home 下的 `.dsh/leek-fund/state.json`。
- 已移除 `process.cwd()/.dsh-leek-fund/state.json` fallback。
- DSH 插件运行时不再暴露 `dataPath` 覆盖。
- README 固定路径说明已同步。
- 相关测试通过。

4. 是否存在未完成项

- 代码层面无未完成项。
- 历史数据文件不会自动迁移，需要人工确认是否从旧位置复制到 `~/.dsh/leek-fund/state.json`。

5. 已执行验证

- `node --import tsx --test tests/state.test.ts`：通过，22 tests passed。
- `npm test`：通过，71 tests passed。
- `npm run typecheck`：失败，`src/client/index.tsx` 找不到 `@deepseek-ai/dsh-client-ui-slots` 类型声明；该错误位于客户端入口依赖解析，和本次状态路径修改无直接关系。

6. 建议执行的验证命令

- `cd dsh-plugin && npm test`
- 修复或安装当前 DSH client UI peer 后执行：`cd dsh-plugin && npm run typecheck`

7. 是否存在需人工确认事项

- 需人工确认是否迁移旧数据：当前本机曾出现旧 fallback 文件 `/Users/zhizhi/Code/Git/deepseek-harness/.dsh-leek-fund/state.json`。如需保留该数据，应手动复制到 `~/.dsh/leek-fund/state.json`。

### Review 结论

需人工确认。

原因：代码修改满足本次 Spec，测试通过；但旧 fallback 数据是否迁移会影响用户现有自选/分组数据，需要人工确认。
