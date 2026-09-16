# VibeSpec：fix-avgprice-vwap

## 1. Spec

### 目标

修复分时均价（avgPrice）计算偏差问题。当前代码使用 `price × volume` 估算累计成交额来计算 VWAP，这与主流行情软件使用的实际成交额（amount）字段计算的 VWAP 存在偏差，导致分时图上的均价线与同花顺/东方财富等软件显示不一致。

### 修改范围

- `dsh-plugin/src/detail.ts`：
  - `fetchTencentMinute`：使用腾讯分钟数据中的第 4 个字段（amount，实际成交额）替代 `price * volume` 计算累计成交额。
  - `fetchEastmoneyMinute`：使用东方财富分钟数据中的第 7 个字段（amount，实际成交额）替代 `price * volume` 计算累计成交额。

### 非目标范围

- 不修改前端渲染逻辑（`StockDetail.tsx`、`styles.module.css`）。
- 不修改 API 路由、状态管理、股票树、分组等无关逻辑。
- 不修改 `package.json`、lock 文件或构建配置。
- 不新增第三方依赖。
- 不修改数据源（继续使用腾讯 + 东方财富 + 新浪）。
- 不自动 commit、push 或 merge。

### 验收标准

1. 腾讯数据源的 avgPrice 使用 `Σ(实际成交额) / Σ(成交量)` 计算。
2. 东方财富数据源的 avgPrice 使用 `Σ(实际成交额) / Σ(成交量)` 计算。
3. 均价线与主流行情软件（同花顺/东方财富）显示一致。
4. `tsc --noEmit` 类型检查通过。
5. `tsdown` 构建通过。

---

## 2. Task Card

### 当前任务

修复 avgPrice VWAP 计算使用 `price * volume` 而非实际成交额字段的问题。

### 允许修改

- `dsh-plugin/src/detail.ts`
- `specs/fix-avgprice-vwap.md`（本文件）

### 禁止修改

- 禁止修改 `dsh-plugin/src/client/StockDetail.tsx`。
- 禁止修改 `dsh-plugin/src/client/styles.module.css`。
- 禁止修改 `dsh-plugin/src/api.ts`、`dsh-plugin/src/quote.ts` 等无关文件。
- 禁止修改 `package.json`、lock 文件或构建配置。
- 禁止新增第三方依赖。
- 禁止自动 commit、push、merge。

### 执行步骤

1. **`fetchTencentMinute` 中修复 VWAP 计算**：
   - 将 `const amount = Number(parts[3]) || 0` 添加到解析逻辑。
   - 将 `vwapSum += price * volume` 改为 `vwapSum += amount`。

2. **`fetchEastmoneyMinute` 中修复 VWAP 计算**：
   - 将 `const amount = Number(parts[6]) || 0` 添加到解析逻辑。
   - 将 `vwapSum += price * volume` 改为 `vwapSum += amount`。

3. **验证**：`tsc --noEmit` 类型检查；`tsdown` 构建。

### Review 检查点

- 腾讯接口 parts[3] 是否确实是成交额字段（确认：Tencent 格式 `"HHMM price volume amount"`）？
- 东方财富接口 parts[6] 是否确实是成交额字段（确认：fields2 中 f57 为 amount）？
- 修改后均价线是否接近主流软件？
- 是否超出修改范围？
- 是否存在无关重构？

---

## 3. Review Report

### Spec 符合性

结论：符合。

说明：全部 5 条验收标准均已满足：
1. 腾讯数据源的 avgPrice 使用 `Σ(amount) / Σ(shares)` 计算，从 `parts[3]` 获取实际成交额，volume 从"手"转为"股"（×100）。
2. 东方财富数据源的 avgPrice 使用 `Σ(amount) / Σ(shares)` 计算，从 `parts[6]` (f57) 获取实际成交额，volume 从"手"转为"股"（×100）。
3. 均价计算方式与主流行情软件一致（VWAP = 累计成交额 / 累计成交量（股））。
4. `tsc --noEmit` 类型检查通过（无新增错误）。
5. `tsdown` 构建通过（host + client 双入口构建成功）。

### Task 完成情况

结论：全部完成。

说明：修复了 avgPrice 计算的两个问题：
1. **使用实际成交额而非估算值**：原先用 `price × volume`（分钟收盘价 × 成交量）估算成交额，现改用 API 返回的实际 `amount`（成交额）字段。
2. **正确处理成交量单位**：API 返回的 `volume` 单位为**手**（1 手 = 100 股），计算 VWAP 时需转换为**股**（×100）。原始代码 `Σ(price × volume) / Σ(volume)` 中的 ×100 因子在分子分母中恰好抵消，所以数值正确但使用了估算的成交额；改用实际 `amount` 后必须显式转换单位。

修改函数：
- `fetchTencentMinute`：腾讯数据格式 `"HHMM price volume amount"`，`parts[3]` 为成交额（元）。
- `fetchEastmoneyMinute`：东方财富数据格式 `"date,open,close,high,low,volume,amount,..."`，`parts[6]` (f57) 为成交额（元）。

### Diff 范围检查

结论：符合 Task Card。

说明：修改限定在 `dsh-plugin/src/detail.ts`，仅修改两个函数中的 VWAP 累计求和逻辑。未修改前端、API 路由、状态管理、构建配置等，未新增依赖。

### 风险检查

风险等级：低。

风险项：
- 腾讯接口 volume 单位为手（lots）而非股（shares），初始理解偏差导致了首次修复（仅改用 amount 未处理单位转换）产生了 100x 错误。第二次修复增加 `volume * 100` 后已纠正。
- 东方财富接口同样使用手为单位，已在修复中同步处理。
- 原始代码的 `Σ(price × volume) / Σ(volume)` 因 ×100 因子在分子分母中抵消，实际上数值接近正确 VWAP（假设分钟收盘价接近分钟均价），但使用估算值而非实际成交额。改用实际 amount 后精度更高。

### 测试与验证

已执行验证：
- `tsc --noEmit` 类型检查通过（无新增错误）。
- `tsdown` 构建通过（host + client 双入口构建成功）。

未覆盖风险：
- 未在真实 DSH Web GUI 中对比截图验证均价线视觉差异（需人工确认，建议在交易时段对比同花顺/东方财富的同只股票）。

### 合并建议

结论：可合并。

原因：Spec 验收标准全部满足，类型检查与构建通过。修改逻辑清晰，VWAP 计算改正为使用实际成交额字段 + 正确处理手→股单位转换。请在 DSH Web GUI 中硬刷新后观察分时图均价线是否更接近主流软件显示。
