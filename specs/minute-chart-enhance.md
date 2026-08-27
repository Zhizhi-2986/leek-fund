# VibeSpec：minute-chart-enhance

## 1. Spec

### 目标

参考同花顺分时图功能，改造当前 DSH LeekFund 的分时图（`MinuteChart`），使其在视觉布局和数据维度上接近主流行情软件的分时图体验。

### 修改范围

- `dsh-plugin/src/detail.ts`：`StockDetail` 接口增加 `limitUp`、`limitDown` 字段；`fetchMinuteLine` 或上游调用处获取腾讯实时行情（field 47/48）的涨停价、跌停价并透传。
- `dsh-plugin/src/client/StockDetail.tsx`：重构 `MinuteChart` 组件，增加成交量柱、右轴百分比、涨停/跌停价标注、更细粒度时间轴、价格/百分比双轴刻度。
- `dsh-plugin/src/client/styles.module.css`：增补分时图相关样式（成交量的颜色、区域分割等）。
- `dsh-plugin/src/api.ts`：`quoteDetail` 路由的上游补充 limitUp/limitDown 字段（已在 detail.ts 透传后自动携带）。
- `specs/minute-chart-enhance.md`（本文件）。

### 非目标范围

- 不修改后端行情数据源（继续使用 Eastmoney 分时线 + Sina 日 K + 腾讯实时行情）。
- 不修改股票树、分组、持仓/关注、行情排行、顶部平铺条逻辑。
- 不修改状态模型字段结构、不修改 `package.json`、lock 文件或构建配置。
- 不新增第三方依赖。
- 不实现交互式十字光标（hover 价格标签等）（留待后续）。
- 不修改 MA5/MA10/MA20 均线逻辑。
- 不自动 commit、push 或 merge。

### 验收标准

1. 分时图顶部区域绘制价格线（红/绿）与均价线（黄），纵轴左侧为价格刻度，右侧为涨跌幅百分比刻度。
2. 分时图底部区域绘制逐分钟成交量柱（红色/绿色按该分钟涨跌着色），成交量柱高度按当日最大成交量归一化。
3. 纵轴范围以涨停价、跌停价为上下边界（涨停价/跌停价无效时回退当前价格范围 ±10% 或 ± 价格范围的 8%）。
4. 图上标注涨停价、跌停价的数值与百分比（右上角/右下角或对应 y 轴位置）。
5. 昨收价线（灰色虚线）保持不变。
6. 时间轴标注更细：9:30、10:30、11:30/13:00、14:00、15:00。
7. 后端 `fetchStockDetail` 返回值包含 `limitUp`、`limitDown` 字段（从腾讯实时行情的 field 47/48 获取）。
8. 成交量数据复用现有 `minute[].volume` 字段（Eastmoney 的 volume 单位为手）。
9. 构建通过：`tsc --noEmit`、`tsdown` 构建成功。

---

## 2. Task Card

### 当前任务

参考同花顺分时功能，改造当前 SVG 分时图：增加成交量柱、价格/百分比双轴、涨停/跌停价标注和更细时间轴。

### 允许修改

- `dsh-plugin/src/detail.ts`
- `dsh-plugin/src/client/StockDetail.tsx`
- `dsh-plugin/src/client/styles.module.css`
- `specs/minute-chart-enhance.md`

### 禁止修改

- 禁止修改 `dsh-plugin/src/api.ts` 的 API 路由逻辑（`quoteDetail` 的 limitUp/limitDown 由 detail.ts 自动携带，无需改动路由）。
- 禁止修改 `dsh-plugin/src/quote.ts`、`dsh-plugin/src/search.ts`、`dsh-plugin/src/types.ts` 的对外语义。
- 禁止修改 `dsh-plugin/src/state.ts`、`dsh-plugin/src/tools.ts`。
- 禁止修改股票树、分组、持仓/关注、顶部平铺条相关文件。
- 禁止修改 `package.json`、lock 文件或构建配置。
- 禁止新增第三方依赖。
- 禁止自动 commit、push、merge。

### 执行步骤

1. **后端 `detail.ts`**：
   - 在 `StockDetail` 接口增加 `limitUp: number`、`limitDown: number` 字段。
   - 在 `fetchMinuteLine` 或 `fetchStockDetail` 中通过腾讯行情接口（`qt.gtimg.cn/q=code`）获取 field 47（涨停价）、field 48（跌停价）。
   - 注意：腾讯行情需要解析 `v_sh600000=...` 格式的字符串，字段以 `~` 分隔。
2. **前端 `StockDetail.tsx`**：
   - 重构 `MinuteChart` 组件：拆分为上下两个区域（价格区 + 成交量区）。
   - 价格区（约占 75% 高度）：绘制价格线、均价线、昨收线；左轴价格刻度、右轴百分比刻度；标注涨停/跌停价。
   - 成交量区（约占 25% 高度）：绘制逐分钟成交量柱，按涨跌着色。
   - 时间轴统一在底部标注。
   - 更新 `StockDetailData` 接口增加 `limitUp`/`limitDown`。
3. **样式 `styles.module.css`**：增补成交量柱颜色等样式。
4. **验证**：`tsc --noEmit` 类型检查；`tsdown` 构建。

### Review 检查点

- 成交量柱是否按该分钟涨跌正确着色（涨红跌绿）？
- 价格线/均价线/昨收线是否清晰可辨？
- 涨停价/跌停价标注是否正确显示数值和百分比？
- 左轴价格、右轴百分比刻度是否对齐？
- 时间轴是否标注到 5 个时间点？
- 后端 limitUp/limitDown 数据源是否正确（腾讯 field 47/48）？
- 涨停/跌停无效时是否回退到安全边界？
- 是否超出修改范围？
- 是否存在无关重构？

---

## 3. Review Report

> 开发完成后填写。

### Spec 符合性

结论：符合。

说明：全部 9 条验收标准均已满足：
1. 分时图价格区包含价格线（红/绿）、均价线（黄虚线），左轴价格刻度、右轴百分比刻度。
2. 底部成交量柱按逐分钟涨跌着色（红涨绿跌），高度按当日最大成交量归一化。
3. 纵轴以涨停/跌停价为边界（有效时），无效时回退价格范围 +8% 边距。
4. 图上标注涨停价/跌停价的数值与百分比（对应 y 轴位置）。
5. 昨收价线（灰色虚线）保持不变。
6. 时间轴标注 5 个时间点：9:30、10:30、11:30/13:00、14:00、15:00。
7. 后端 `fetchStockDetail` 返回 `limitUp`/`limitDown`（腾讯 field 47/48）。
8. 成交量复用现有 `minute[].volume`（手单位）。
9. `tsc --noEmit` 和 `tsdown` 构建均通过。

### Task 完成情况

结论：全部完成。

说明：后端新增 `fetchLimitPrices` 从腾讯获取涨停/跌停价并透传；前端完全重写 `MinuteChart` 组件，增加成交量柱、价格/百分比双轴、涨停/跌停标注、5 点时间轴和网格线。

### Diff 范围检查

结论：符合 Task Card。

说明：修改限定在 `dsh-plugin/src/detail.ts` 和 `dsh-plugin/src/client/StockDetail.tsx`（以及本 Spec 文件）。未修改 `package.json`、lock 文件、构建配置、股票树/分组/持仓/关注等无关模块，未新增依赖。

### 风险检查

风险等级：低。

风险项：
- 腾讯行情接口 `qt.gtimg.cn` 的 field 47/48 字段序号可能随上游变更而偏移，如遇解析失败会静默返回 0，前端会回退价格范围边界，不影响核心功能。
- 成交量柱宽度基于采样间距估算，在数据点极稀疏时可能显示过宽或过窄；但 SVG 的 `preserveAspectRatio="none"` 拉伸渲染下仍可见。
- 新增的 `fetchLimitPrices` 并发请求增加了一个 HTTP 调用，但与其他请求并行且带超时控制，对整体性能影响可忽略。

### 测试与验证

已执行验证：
- `tsc --noEmit` 类型检查通过（无错误）。
- `tsdown` 构建通过（host + client 双入口构建成功）。

未覆盖风险：
- 未在真实 DSH Web GUI 中截图验证视觉布局（需人工确认）。
- 未在非 A 股（港股/美股）上验证 fallback 行为（预期安全，因 `fetchLimitPrices` 对非 sh/sz 代码返回 0）。
- 未验证腾讯接口限流或网络不可达时的静默降级（catch 已处理）。

### 合并建议

结论：可合并（建议人工确认视觉效果）。

原因：Spec 验收标准全部满足，类型检查与构建通过。请在 DSH Web GUI 中硬刷新后观察分时图的视觉布局、成交量柱显示和涨停/跌停标注是否正确。如发现时间轴标签或成交量柱对齐问题，可后续微调 SVG 坐标常量。
