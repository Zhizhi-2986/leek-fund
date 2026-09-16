# VibeSpec：fix-limit-price-index

## 1. Spec

### 目标

修复涨跌停价（涨停价/跌停价）在 Tencent API 解析时索引偏移 1 位的 bug，导致展示数据错误的问题。

### 修改范围

- `dsh-plugin/src/detail.ts` — 修正 `fetchTencentMinute()` 和 `fetchLimitPricesFromQt()` 中 Tencent API 返回数组的索引，并更新相关注释和长度检查。

### 非目标范围

- 不修改 DSH plugin 客户端渲染逻辑（`StockDetail.tsx`等），数据修复后显示自动正确。
- 不修改原始 VS Code 扩展代码（`src/` 目录），因其使用东方财富 API（f41/f42）而非 Tencent API。
- 不修改 `src/shared/stockDetailData.ts`，因其使用东方财富 API，索引方式与 Tencent API 不同。
- 不修改 CSS、HTML 模板、构建配置等其他无关文件。
- 不自动 commit、push、merge。

### 验收标准

1. 涨停价从正确的 Tencent API 字段索引读取（0-indexed 47 → 1-indexed 48）。
2. 跌停价从正确的 Tencent API 字段索引读取（0-indexed 48 → 1-indexed 49）。
3. TypeScript 编译通过。
4. 展示的涨停/跌停价应与理论计算值一致（昨收 × 1.1 / 0.9，四舍五入到两位小数）。

---

## 2. Task Card

### 当前任务

修复 Tencent API 中涨跌停价索引偏移 1 位的 bug。

### 允许修改

- `dsh-plugin/src/detail.ts`

### 禁止修改

- 不修改 `src/` 目录下的任何文件。
- 不修改 `dsh-plugin/src/client/` 下的任何文件。
- 不修改构建配置、package.json、CSS、HTML 等。
- 不做无关重构。

### 执行步骤

1. 在 `fetchTencentMinute()` 中修正 `qtArr` 索引：
   - `limitUp`: `qtArr[46]` → `qtArr[47]`
   - `limitDown`: `qtArr[47]` → `qtArr[48]`
   - 数组长度检查：`>= 48` → `>= 49`
2. 更新相关注释中的 1-indexed 索引说明。
3. 在 `fetchLimitPricesFromQt()` 中修正 `fields` 索引：
   - `limitUp`: `fields[46]` → `fields[47]`
   - `limitDown`: `fields[47]` → `fields[48]`
4. 运行 TypeScript 编译验证。

### Review 检查点

- 是否满足 Spec 目标（涨跌停价展示正确）？
- 是否超出修改范围（只修改了 `dsh-plugin/src/detail.ts`）？
- 是否存在无关重构？
- 是否影响原有逻辑（其他字段索引保持不变）？

---

## 3. Review Report

> 开发完成后填写。

### Spec 符合性

结论：✅ 可合并

说明：
- 涨停价索引已从 `qtArr[46]` 修正为 `qtArr[47]`（0-indexed），对应 Tencent API 实际返回的 **涨停价** 字段。
- 跌停价索引已从 `qtArr[47]` 修正为 `qtArr[48]`（0-indexed），对应 Tencent API 实际返回的 **跌停价** 字段。
- `fetchLimitPricesFromQt()` 中的相同索引错误已同步修正。
- 经过实测验证：贵州茅台昨收 1290.88，涨停价理论值 1290.88×1.1=1419.97，当前代码 `qtArr[47]` 返回 1419.97，与理论值一致。

### Task 完成情况

结论：✅ 全部完成

| 步骤 | 状态 |
|------|------|
| 1. 修正 `fetchTencentMinute()` 中 `qtArr` 索引 | ✅ |
| 2. 更新注释中的 1-indexed 索引说明 | ✅ |
| 3. 修正 `fetchLimitPricesFromQt()` 中 `fields` 索引 | ✅ |
| 4. TypeScript 编译通过 | ✅ |

### Diff 范围检查

结论：✅ 未超出范围

- 修改仅限于 `dsh-plugin/src/detail.ts`
- 未修改 `src/`、`dsh-plugin/src/client/`、构建配置等禁止修改的文件

### 风险检查

风险等级：🟢 低

风险项：无。索引修正仅影响涨跌停价读取，不影响其他字段（name、yestclose、open、分时数据等）。

### 测试与验证

已执行验证：
1. 从 Tencent API `ifzq.gtimg.cn` 和 `qt.gtimg.cn` 分别获取贵州茅台、浦发银行数据，验证实际字段索引位置。
   - 贵州茅台：index 47=1419.97（涨停价），index 48=1161.79（跌停价）
   - 浦发银行：index 47=10.15（涨停价），index 48=8.31（跌停价）
   - 理论值验证：昨收 9.23×1.1=10.153≈10.15 ✓，昨收 9.23×0.9=8.307≈8.31 ✓
2. `npm run build` 编译通过。
3. 编译后 `lib/index.js` 中索引已正确更新。

未覆盖风险：暂无。

### 合并建议

结论：✅ 可合并

原因：修复定位准确，修改范围可控，验证充分，无兼容性风险。