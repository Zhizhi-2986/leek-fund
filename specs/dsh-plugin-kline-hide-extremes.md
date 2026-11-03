# VibeSpec：5 分钟 K 线隐藏极值标注与图下提示条

> 编写日期：2026-11-03
> 关联分支：dsh-plugin（叠加在已评审的「详情页价格参考字段」工作之上）

## 1. Spec

### 目标

精简 5 分钟 K 线视图：

1. 图表内不再绘制**最高点 / 最低点**标注（白色圆圈描边 + 「最高 xx / 最低 xx」胶囊标签，以及「最高 = 最低」特例标签）；
2. 图表下方不再展示**提示条**（`VerifyBar`：常态文案「当日 K 线最高 x / 最低 y · 行情时间」，以及「快照与 K 线口径不一致」警告态）。

### 修改范围

- `dsh-plugin/src/client/StockDetail.tsx`：删除极值标注渲染段、`VerifyBar` 组件及其调用、`extremeMismatch` 导入；同步更新文件头注释。
- `dsh-plugin/src/client/styles.module.css`：删除随之失效的 `.verifyBar`、`.verifyBar.warn` 规则。
- `specs/dsh-plugin-kline-hide-extremes.md`：本 Spec / Task Card / Review Report。

### 非目标范围

- **保留**：K 线坐标与刻度（刻度集仍以本日 K 线极值为范围，蜡烛本体影线天然展示高低）、MA 线、昨收/涨停/跌停参考线、「进行中」标记、悬停十字线、悬停 OHLC 信息条与「悬停蜡烛查看分时 OHLC」提示（交互反馈，与最高/最低展示无关）。
- 不改 `kline-math.ts`（`barExtremes` 仍用于坐标范围；`extremeMismatch` 保留导出，其单测不动）。
- 不改数据层，不新增依赖，不自动提交/推送/合并。

### 验收标准

1. K 线图内无任何「最高/最低」文字标签或对应圆圈标注；「最高 = 最低」特例标签也不再出现。
2. 图下方无 `verifyBar`（常态或警告态）渲染；页面不再引用 `extremeMismatch`。
3. 悬停十字线、OHLC 信息条、MA 线、参考线、「进行中」标记等既有交互与元素不受影响。
4. `npm test` 全绿；改动文件 `tsc` 独立校验零错误；`tsdown` 打包成功。

---

## 2. Task Card

### 当前任务

删除 5 分钟 K 线的最高/最低点标注与图下提示条。

### 允许修改

- `dsh-plugin/src/client/StockDetail.tsx`
- `dsh-plugin/src/client/styles.module.css`
- 本 spec 文件

### 禁止修改

- 不修改 `kline-math.ts` / `detail.ts` / 数据源。
- 不修改悬停交互、OHLC 信息条与其余 K 线元素。
- 不做无关重构与格式化。

### 执行步骤

1. `StockDetail.tsx`：删除「Extremum labels」整段与蜡烛循环内 `extremeMarkers` 累加；删除 `VerifyBar` 调用与函数；删除 `extremeMismatch` 导入；更新文件头注释。
2. `styles.module.css`：删除 `.verifyBar`、`.verifyBar.warn`。
3. 验证：`npm test`、独立 `tsc`、`npx tsdown` 重建 `lib/`。
4. 输出 Diff Summary 并填写 Review Report。

### Review 检查点

- 是否满足 Spec 目标与验收标准？
- 是否误删坐标范围计算 / 悬停 / OHLC 等依赖？
- CSS 死规则是否清理干净？
- 是否有残留未使用导入？

---

## 3. Review Report

> 开发完成后填写。

### Spec 符合性

结论：可合并。

说明：4 条验收标准全部满足——
1. K 线图中「最高/最低」胶囊标签、白色圆圈标注及「最高 = 最低」特例标签全部删除，仅保留蜡烛本体影线作为高低表达；
2. `VerifyBar` 组件与其调用、`extremeMismatch` 导入全部移除；CSS 中 `.verifyBar`、`.verifyBar.warn` 死规则已清理；
3. 坐标范围仍由 `barExtremes` 驱动（`extremes.low/high` 仅用于刻度域与空数据守卫），MA 线、昨收/涨停/跌停参考线、「进行中」标记、悬停十字线、悬停 OHLC 信息条与「悬停蜡烛查看分时 OHLC」提示不受影响；
4. `npm test` 135 项全绿；`StockDetail.tsx` 独立 `tsc` 零错误；`tsdown` 打包成功且产物中已无标注与提示条文本。

### Task 完成情况

结论：已完成。

说明：`StockDetail.tsx` 三处删除（蜡烛循环极值标注累加、「Extremum labels」整段、`VerifyBar` 组件及调用）+ 头注释与导入更新；`styles.module.css` 删除两条死规则。改动仅限 Task Card 允许范围。

### Diff 范围检查

结论：通过。

说明：`kline-math.ts`、`detail.ts`、数据层、悬停交互、OHLC 信息条均未改动；无误删坐标计算（`extremes` 仍在 300/302/328-329 行使用）；`GRAY`、`tick` 变量仍被刻度着色与坐标构建使用，保留正确。

### 风险检查

风险等级：低。

风险项：
- 图表信息密度下降：删除标注后，最高/最低价只能通过右轴刻度和悬停 OHLC 读取——悬停信息条恰好补位，属于有意取舍。
- `barExtremes` 返回的 `highIndex/lowIndex` 字段客户端不再使用，但 `kline-math.ts` 与其单测保持不变（供坐标/未来功能复用），无死代码风险。
- 无数据迁移、无 schema 变更；回滚仅需还原 `StockDetail.tsx` 与 `styles.module.css`。

### 测试与验证

已执行验证：
- `npm test`：135 pass / 0 fail。
- 独立 `tsc`（`StockDetail.tsx` + `css.d.ts`）：0 错误。
- `npx tsdown` 重建 `lib/client.js` / `lib/index.js`：产物已确认不含「最高 = 最低 / 最低 …」标注与「当日 K 线最高 / 快照与 K 线口径不一致」提示条文本，「悬停蜡烛查看分时 OHLC」保留。
- 未做浏览器端手工点验（本环境无法启动完整 DSH Web GUI 插件沙箱）。

未覆盖风险：真实数据下图表视觉密度/可读性回归，需人工打开详情页确认观感。

### 合并建议

可合并。

---

## 附：Diff Summary（Developer 交付）

### 修改文件列表

| 文件 | 修改原因 |
|---|---|
| `dsh-plugin/src/client/StockDetail.tsx` | 删除 5 分钟 K 线内最高/最低点标注（圆圈 + 胶囊标签 + 「最高=最低」特例）、删除图下 `VerifyBar` 提示条及其调用、移除 `extremeMismatch` 导入、更新头注释 |
| `dsh-plugin/src/client/styles.module.css` | 删除随之失效的 `.verifyBar`、`.verifyBar.warn` 规则 |
| `specs/dsh-plugin-kline-hide-extremes.md` | 本 Spec / Task Card / Review Report |

### 验收标准核对

全部满足（见上"Spec 符合性"）。

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

「悬停蜡烛查看分时 OHLC」提示与悬停时出现的 OHLC 信息条属于交互反馈（悬停可见），本次**保留**；如需一并隐藏，改 `KlineChart` 底部 5 行即可。
