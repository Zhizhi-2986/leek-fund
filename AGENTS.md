# 项目级 Agent 规则

本项目采用 VibeSpec 轻量 AI 编码工作流。

VibeSpec 的目标不是构建重型自动化流程，而是通过轻量 Spec、Task Card 和 Review Report，让 AI 编码过程具备明确边界、可审查 diff、可识别风险，并由人工最终确认是否合并。

## 一、核心流程

用户提出需求
↓
生成轻量 Spec
↓
生成 Task Card
↓
按 Task Card 做最小必要代码修改
↓
基于 Spec、Task Card 和 git diff 进行 Review
↓
输出 Review Report
↓
人工决定是否提交、推送、合并

## 二、基本原则

1. 不允许在没有 Spec 的情况下直接编码。
2. 不允许自动 commit、push、merge。
3. 不允许自动合并到 main / master。
4. 不允许做无关重构。
5. 不允许大面积格式化无关文件。
6. 不允许修改 Spec 中明确列入“非目标范围”的内容。
7. 不允许新增未说明依赖。
8. 开发完成后，必须基于 Spec、Task Card 和 git diff 进行 Review。
9. Review 结论只能是：可合并、需修复、需人工确认。

## 三、VibeSpec 文件约定

每次需求只维护一个文件：

specs/<change-name>.md

文件包含三部分：

1. Spec：目标、修改范围、非目标范围、验收标准。
2. Task Card：当前任务、允许修改、禁止修改、执行步骤、Review 检查点。
3. Review Report：开发完成后填写，基于 Spec、Task Card 和 git diff 审查代码。

## 四、Developer 工作要求

进入开发阶段时，必须：

1. 先读取本文件。
2. 读取对应的 specs/<change-name>.md。
3. 如 Spec 未完成，先补全 Spec。
4. 基于 Spec 生成 Task Card。
5. 只做 Task Card 允许范围内的最小必要修改。
6. 不做无关重构。
7. 不新增未说明依赖。
8. 不自动 commit、push、merge。
9. 开发完成后输出 Diff Summary。

Diff Summary 必须包括：

1. 修改文件列表。
2. 每个文件的修改原因。
3. 是否满足 Spec 验收标准。
4. 是否存在未完成项。
5. 建议执行的验证命令。
6. 是否存在需人工确认事项。

## 五、Reviewer 工作要求

进入审查阶段时，必须读取：

1. specs/<change-name>.md。
2. 当前 git diff。
3. Developer 输出的 Diff Summary，如果存在。
4. 已执行的验证结果，如果存在。

Review 必须检查：

1. 是否满足 Spec 目标。
2. 是否覆盖 Spec 验收标准。
3. 是否违反 Spec 非目标范围。
4. 是否超出 Task Card 允许修改范围。
5. 是否存在无关重构。
6. 是否存在大面积格式化。
7. 是否新增未说明依赖。
8. 是否存在潜在 bug。
9. 是否存在兼容性风险。
10. 是否存在性能风险。
11. 是否存在安全风险。
12. 是否需要补充测试。
13. 是否需要人工确认。

最终结论只能是：

1. 可合并。
2. 需修复。
3. 需人工确认。

## 六、高风险修改

以下修改必须提示人工确认：

1. 数据库结构变更。
2. 权限认证逻辑变更。
3. 登录鉴权逻辑变更。
4. 加密逻辑变更。
5. package.json 或 lock 文件变更。
6. CI/CD 配置变更。
7. 构建脚本、部署脚本变更。
8. 环境变量或生产配置变更。
9. 公共组件大范围重构。
10. 全局状态、路由、权限、公共 API 客户端变更。
11. 删除大量代码。
12. 迁移目录结构。
13. 修改框架适配层。

如果涉及高风险修改，必须说明：

1. 为什么必须修改。
2. 可能影响哪些模块。
3. 建议执行哪些验证命令。
4. 是否需要人工确认。
5. 如何回滚。

## 七、Git 规则

开发前建议检查：

git branch --show-current
git status

开发后建议检查：

git status
git diff --stat
git diff

提交前建议检查：

git status
git diff --cached

AI 不自动提交、推送、合并，最终由用户人工确认。

## 八、敏感信息规则

不得要求用户粘贴：

1. API Key。
2. Token。
3. 密码。
4. 私钥。
5. 公司敏感配置。
6. 生产环境地址。
7. 生产数据库信息。
8. 包含敏感字段的生产日志。

所有密钥必须放在本地环境变量或安全配置中，不得写入：

1. AGENTS.md。
2. specs 文件。
3. Review Report。
4. 日志。
5. Git 仓库。
