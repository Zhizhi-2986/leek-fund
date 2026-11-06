# VibeSpec：5 分钟 K 线隐藏极值标注与图下提示条

> 编写日期：2026-11-03
> 修订日期：2026-11-06（当日数据面板 V2 提交 `a997469` 重新引入了极值标签与「快照对账」提示条，本 Spec 的 Review Report 重置为待开发，按最新代码状态重新执行）
> 关联分支：dsh-plugin

## 1. Spec

### 目标

精简 5 分钟 K 线视图：

1. 图表内不再绘制**最高点 / 最低点**标注（指向极值蜡烛的连线 + 白色圆圈描边 + 「最高 xx / 最低 xx」胶囊标签）；
2. 图表下方不再展示**对账提示条**（`verifyBar` 的四种文案态：`⚠ 快照与 K 线极值不同（不补造影线）：…`、`✓ 快照已提供的高低价与 K 线极值一致`、`行情快照极值或时间不足，暂不可对账`、`⚠ 行情日期 … 与 K 线日期 … 不一致，暂不可对账`）。

### 修改范围

- `dsh-plugin/src/client/StockDetail.tsx`：
  - 删除「Extremum labels」整段（`extremeLabel` 函数）及其两处调用（最高/最低）；
  - 删除快照对账计算块（`quoteDate`/`barDate`/`quoteHigh`/`quoteLow`/`hasQuoteExtremes`/`canReconcile`/`mismatch`/`mismatchParts`/`reconciliationWarn`/`reconciliationText`）与 `verifyBar` 渲染节点；
  - 删除 `extremeMismatch` 导入；同步更新文件头注释。
- `dsh-plugin/src/client/styles.module.css`：删除随之失效的 `.verifyBar`、`.verifyBar.warn` 规则。
- `specs/dsh-plugin-kline-hide-extremes.md`：本 Spec / Task Card / Review Report。

### 非目标范围

- **保留**：K 线坐标与刻度（刻度集仍以本日 K 线极值为范围，蜡烛本体影线天然展示高低）、MA 线、昨收/涨停/跌停参考线、「进行中」标记、悬停十字线、悬停 OHLC 信息条与「悬停蜡烛查看分时 OHLC」提示（交互反馈，与最高/最低展示无关）。
- **保留**：`DailyPanel`（「当日数据」视图）中「今日最高/最低」「阶段最高/最低」等文案——属于当日数据面板，不是 5 分钟图。
- 不改 `kline-math.ts`（`barExtremes` 仍用于坐标范围；`extremeMismatch` 保留导出，其单测不动）。
- 不改数据层（`detail.ts` 的 `snapshotHigh/snapshotLow` 字段与相关单测不动），不新增依赖，不自动提交/推送/合并。

### 验收标准

1. K 线图内无任何「最高/最低」文字标签、圆圈标注或指向连线。
2. 图下方无 `verifyBar`（四种文案态任一）渲染；`StockDetail.tsx` 不再引用 `extremeMismatch`。
3. 悬停十字线、OHLC 信息条、MA 线、参考线、「进行中」标记、`DailyPanel` 等既有元素与交互不受影响。
4. `npm test` 全绿；改动文件 `tsc` 独立校验零错误；`tsdown` 打包成功。

---

## 2. Task Card

### 当前任务

删除 5 分钟 K 线的最高/最低点标注与图下对账提示条（V2 重新引入的元素）。

### 允许修改

- `dsh-plugin/src/client/StockDetail.tsx`
- `dsh-plugin/src/client/styles.module.css`
- 本 spec 文件

### 禁止修改

- 不修改 `kline-math.ts` / `detail.ts` / `DailyPanel.tsx` / 数据源。
- 不修改悬停交互、OHLC 信息条与其余 K 线元素。
- 不做无关重构与格式化。

### 执行步骤

1. `StockDetail.tsx`：删除「Extremum labels」整段与两处调用；删除快照对账计算块与 `verifyBar` 渲染节点；删除 `extremeMismatch` 导入；更新文件头注释。
2. `styles.module.css`：删除 `.verifyBar`、`.verifyBar.warn`。
3. 验证：`npm test`、独立 `tsc`、`npx tsdown` 重建 `lib/`。
4. 输出 Diff Summary 并填写 Review Report。

### Review 检查点

- 是否满足 Spec 目标与验收标准？
- 是否误删坐标范围计算 / 悬停 / OHLC 等依赖？
- CSS 死规则是否清理干净？
- 是否有残留未使用导入 / 变量？

---

## 3. Review Report

> 开发完成后填写。

### Spec 符合性

结论：可合并。

说明：4 条验收标准全部满足——
1. K 线图中「最高/最低」胶囊标签、白色圆圈描边与指向连线全部删除，仅保留蜡烛本体影线作为高低表达；
2. 图下 `verifyBar` 四种文案态（含「⚠ 快照与 K 线极值不同（不补造影线）」）全部移除，`StockDetail.tsx` 不再引用 `extremeMismatch`；
3. 坐标范围仍由 `barExtremes` 驱动（`extremes.low/high` 仅用于刻度域与空数据守卫），MA 线、昨收/涨停/跌停参考线、「进行中」标记、悬停十字线、悬停 OHLC 信息条与「悬停蜡烛查看分时 OHLC」提示不受影响；`DailyPanel`（当日数据视图）今日最高/最低等文案未动；
4. `npm test` 145 项全绿；`StockDetail.tsx` 独立 `tsc` 零错误；`tsdown` 打包成功且 `lib/client.js` / `lib/index.js` 已确认不含「不补造影线 / 快照与 K 线极值 / 快照已提供的高低价 / 暂不可对账」等文案。

### Task 完成情况

结论：已完成。

说明：`StockDetail.tsx` 四处删除（`extremeMismatch` 导入、快照对账计算块、极值标注整段及其两处调用、`verifyBar` 渲染节点）+ 头注释更新；`styles.module.css` 删除 `.verifyBar`、`.verifyBar.warn` 两条死规则。改动仅限 Task Card 允许范围。

### Diff 范围检查

结论：通过。

说明：`kline-math.ts`、`detail.ts`、`DailyPanel.tsx`、数据源、悬停交互、OHLC 信息条均未改动；未误删坐标计算（`extremes` 仍用于 253-254/266 行刻度域与 227 行空数据守卫）；`tick`、`clamp`、`fmtPrice`、`validPrice` 等仍被其余逻辑使用。`StockDetail.tsx` 头注释声明 `snapshotHigh/snapshotLow` 可选字段保留（对应服务端契约，数据层未动）。

### 风险检查

风险等级：低。

风险项：
- 图表信息密度下降：删除标注后，单根蜡烛的高低只能通过右轴刻度和悬停 OHLC 读取——悬停信息条恰好补位，属于有意取舍（与上一轮 hide-extremes 相同的取舍）。
- 既有死变量：`digits`/`tickDigitsFor`（236 行）在本次改动前的 HEAD 版本即已未使用，属预先存在，按「不做无关重构」原则未顺手清理；可在后续提交单独处理。
- 无数据迁移、无 schema 变更；回滚仅需还原 `StockDetail.tsx` 与 `styles.module.css`。

### 测试与验证

已执行验证：
- `npm test`：145 pass / 0 fail。
- 独立 `tsc`（`StockDetail.tsx` + `css.d.ts`）：0 错误；追加 `--noUnusedLocals` 仅报预先存在的 `digits` 未使用（见风险检查）。
- `npx tsdown` 重建 `lib/client.js` / `lib/index.js`：产物确认不含「不补造影线 / 快照与 K 线极值 / 快照已提供的高低价 / 暂不可对账」及 `extremeLabel`；「悬停蜡烛查看分时 OHLC」与「进行中」保留；产物中残留的「今日最高/最低」均出自 `DailyPanel`（当日数据视图，非 5 分钟图）。
- 项目级 `npm run typecheck` 有既有报错（`src/client/index.tsx` 缺少宿主提供的 `@deepseek-ai/dsh-client-ui-renderer/client` 模块声明、`src/index.ts` 配置 schema 类型不匹配），均在本次未改动文件，与本次改动无关（本次只改动文件已独立 tsc 通过）。
- 未做浏览器端手工点验（本环境无法启动完整 DSH Web GUI 插件沙箱）。

未覆盖风险：真实数据下 5 分钟图视觉密度/可读性回归，需人工打开详情页确认观感。

### 合并建议

可合并。

---

## 附：Diff Summary（Developer 交付）

### 修改文件列表

| 文件 | 修改原因 |
|---|---|
| `dsh-plugin/src/client/StockDetail.tsx` | 删除 5 分钟 K 线内最高/最低点标注（指向连线 + 圆圈 + 胶囊标签及两处调用）、删除图下 `verifyBar` 对账提示条（四种文案态）及其计算块、移除 `extremeMismatch` 导入、更新头注释 |
| `dsh-plugin/src/client/styles.module.css` | 删除随之失效的 `.verifyBar`、`.verifyBar.warn` 规则 |
| `specs/dsh-plugin-kline-hide-extremes.md` | 本 Spec 修订（对齐 V2 重新引入的元素）、Task Card / Review Report / Diff Summary |

### 验收标准核对

全部满足（见上"Spec 符合性"）。四个提示文案态（`⚠ 快照与 K 线极值不同（不补造影线）…`、`✓ 快照已提供的高低价与 K 线极值一致`、`行情快照极值或时间不足，暂不可对账`、`⚠ 行情日期…不一致，暂不可对账`）均已在源码与打包产物中移除。

### 未完成项

无。

### 建议验证命令

```bash
cd dsh-plugin
npm test
npx tsc --noEmit --skipLibCheck --module nodenext --moduleResolution nodenext \
  --target es2022 --lib es2022,dom --types node --jsx react-jsx \
  src/client/css.d.ts src/client/StockDetail.tsx
npx tsdown   # 重建 lib/client.js 供宿主加载
```

### 需人工确认事项

1. `DailyPanel`（「当日数据」视图）的「今日最高/最低」「阶段最高/最低」文案本次**保留**（用户需求仅针对 5 分钟图）；如需一并隐藏请另行提出。
2. 既有死变量 `digits`/`tickDigitsFor`（`StockDetail.tsx:236`，HEAD 已存在）是否顺带清理，由你决定。
