# VibeSpec：当日数据面板补充日线均线 MA5–MA60

> 编写日期：2026-11-06
> 关联分支：dsh-plugin

## 1. Spec

### 目标

在「当日数据」视图（`DailyPanel`）中补充 5 / 10 / 20 / 30 / 60 日均线，label 采用「MA5」「MA10」「MA20」「MA30」「MA60」格式，数值为**日 K 线均线**（基于前复权日 K 收盘价，非 5 分钟均线）。

### 口径

- 均线基于 `fetchDailyKline` 已有的 60 根日 K 收盘序列（前复权），**不新增任何数据请求**。
- 与 `return5/return20` 共用同一「窗口」逻辑：
  - 盘中有同日快照报价时：序列 = 今日之前的已收盘日 K 收盘 + **现价**（行业惯例，盘中 MA 含今日实时值）；
  - 非盘中/周末/盘前：序列 = 最近 60 根已收盘日 K 收盘（最后一根即最新收盘）。
- 序列不足 N 根时对应 MA 为 `null`，面板显示 `--`（与 K 线视图 MA 行为一致）。

### 修改范围

- `dsh-plugin/src/detail.ts`：`StockDetail` 接口新增 `dailyMA` 字段；`fetchStockDetail` 组装时计算并返回；更新文件头注释。
- `dsh-plugin/src/client/StockDetail.tsx`：客户端 `StockDetailData` 接口新增 `dailyMA` 字段（仅类型）。
- `dsh-plugin/src/client/DailyPanel.tsx`：新增「均线（日线）」卡片（label `MA5` 等，样式复用 `.maRow`），置于「今日关键价格」卡片之后。
- `dsh-plugin/tests/detail.test.ts`：补充 `dailyMA` 组装断言。
- `specs/dsh-plugin-daily-ma-lines.md`：本 Spec / Task Card / Review Report。

### 非目标范围

- **不改** K 线视图（`5分钟K线` 顶部 `maRow`）——该处为 5 分钟口径 MA，与本次需求无关。
- **不改** 现有 `ma` 字段（5 分钟口径）与其计算逻辑。
- 不改数据源、不新增依赖、不自动提交/推送/合并。
- 不在当日数据视图绘制均线图/曲线，仅数字标签行。

### 验收标准

1. 「当日数据」视图在「今日关键价格」下方显示 MA5 / MA10 / MA20 / MA30 / MA60 五个标签与数值，label 格式为「MA5」这种。
2. 数值基于日 K 收盘价（盘中含现价）；历史不足 N 根时对应项显示 `--`。
3. K 线视图 5 分钟 MA 行与其余既有元素不受影响。
4. `npm test` 全绿（含新增 `dailyMA` 断言）；改动文件 `tsc` 独立校验零错误；`tsdown` 打包成功。

---

## 2. Task Card

### 当前任务

当日数据面板补充日线均线 MA5–MA60。

### 允许修改

- `dsh-plugin/src/detail.ts`
- `dsh-plugin/src/client/StockDetail.tsx`
- `dsh-plugin/src/client/DailyPanel.tsx`
- `dsh-plugin/tests/detail.test.ts`
- 本 spec 文件

### 禁止修改

- 不修改 `kline-math.ts`、`daily-math.ts`、数据源/API 地址。
- 不修改 K 线视图 `maRow` 及其 5 分钟口径。
- 不引入循环依赖（`DailyPanel.tsx` 不运行时导入 `StockDetail.tsx` 的常量/组件）。
- 不做无关重构与格式化。

### 执行步骤

1. `detail.ts`：`StockDetail.dailyMA` 字段 + 计算（复用 `previousDailyBars`/`periodPrice` 窗口，`calcMA` 纯函数）。
2. `StockDetail.tsx`：`StockDetailData.dailyMA` 类型字段。
3. `DailyPanel.tsx`：`MaCard` 组件（本地 `MA_PERIODS`/`MA_COLORS` 常量），渲染于关键价格卡片之后。
4. `detail.test.ts`：在现有 mock 测试中追加 `dailyMA` 数值断言。
5. 验证：`npm test`、独立 `tsc`、`npx tsdown` 重建 `lib/`。
6. 输出 Diff Summary 并填写 Review Report。

### Review 检查点

- 口径是否正确（日 K 收盘、盘中含现价、不足显示 null）？
- 是否误动 5 分钟口径 `ma` 或 K 线视图？
- 是否引入循环依赖？
- 测试是否覆盖盘中与非盘中两种窗口？

---

## 3. Review Report

> 开发完成后填写。

### Spec 符合性

结论：可合并。

说明：4 条验收标准全部满足——
1. 「当日数据」视图在「今日关键价格」卡片下方新增「均线（日线）」卡片，显示 MA5 / MA10 / MA20 / MA30 / MA60 五个色点 + 标签 + 数值，label 为「MA5」格式；
2. 数值基于 `fetchDailyKline` 的 60 根前复权日 K 收盘（零新增请求），与 `return5/return20` 共用窗口：盘中有同日快照时序列末端为现价（行业盘中 MA 惯例），否则末端为最近已收盘日 K 收盘；序列不足 N 根时对应值 `null`，面板显示 `--`；
3. K 线视图 5 分钟口径 `maRow`、`ma` 字段、极值隐藏等既有行为均未触碰；
4. `npm test` 146 项全绿（含新增 dailyMA 断言）；改动文件独立 `tsc` 零错误；`tsdown` 打包成功，产物含「均线（日线）」卡片与 `dailyMA` 字段。

### Task 完成情况

结论：已完成。

说明：`detail.ts`（接口字段 + 组装计算 + 头注释）、`StockDetail.tsx`（客户端类型字段）、`DailyPanel.tsx`（`MaCard` 组件 + 插入点）、`detail.test.ts`（3 处断言：无报价短序列全 null、盘中含现价、非盘中完整 60 日窗口）。改动仅限 Task Card 允许范围。

### Diff 范围检查

结论：通过。

说明：`kline-math.ts`、`daily-math.ts`、数据源/API 地址未改动；K 线视图 `maRow` 与其 5 分钟口径 `ma` 未改动；`DailyPanel.tsx` 未运行时导入 `StockDetail.tsx`（`MA_PERIODS`/`MA_COLORS` 本地定义，避免循环依赖）；无无关重构。CSS 直接复用既有 `.maRow`（通用 flex 布局），未新增样式规则。

### 风险检查

风险等级：低。

风险项：
- 口径差异：盘中 MA 末端用现价（而非最近收盘），与部分行情软件「日 K 均线仅用已收盘价」的做法略有差异，但符合主流看盘软件盘中 MA 行为；已在 Spec 口径节与接口注释中记录，如需改为纯收盘口径仅需删除 `periodPrice` 一行的拼接。
- 新股/短历史：日 K 不足 60 根时 MA60 等显示 `--`，与 K 线视图行为一致，无异常。
- 无数据迁移、无 schema 变更；回滚仅需还原 4 个改动文件。

### 测试与验证

已执行验证：
- `npm test`：146 pass / 0 fail（原 145 + 新增 1 例「非盘中完整窗口」；并扩充盘中、短序列两处断言）。
- 独立 `tsc`：`StockDetail.tsx` + `DailyPanel.tsx` + `css.d.ts` 0 错误；`detail.ts` 0 错误。
- `npx tsdown` 重建 `lib/client.js` / `lib/index.js`：产物确认含「均线（日线）」标题与 `dailyMA` 字段引用。
- 项目级 `npm run typecheck` 既有报错（`index.tsx` 缺宿主模块声明、`src/index.ts` schema 类型）发生在未改动文件，与本次无关。
- 未做浏览器端手工点验（本环境无法启动完整 DSH Web GUI 插件沙箱）。

未覆盖风险：真实数据下「均线（日线）」卡片在窄屏/盘中的数值观感，需人工打开详情页确认。

### 合并建议

可合并。

---

## 附：Diff Summary（Developer 交付）

### 修改文件列表

| 文件 | 修改原因 |
|---|---|
| `dsh-plugin/src/detail.ts` | `StockDetail` 接口新增 `dailyMA` 字段（含口径注释）；`fetchStockDetail` 复用 `return5/20` 窗口计算日线 MA（`dailyCloses = 已收盘日 K 收盘 + periodPrice`，`calcMA` 纯函数）；更新文件头注释 |
| `dsh-plugin/src/client/StockDetail.tsx` | `StockDetailData` 客户端接口新增 `dailyMA` 类型字段（仅类型，无逻辑改动） |
| `dsh-plugin/src/client/DailyPanel.tsx` | 新增 `MaCard` 组件（本地 `MA_PERIODS`/`MA_COLORS` 常量，label「MA5」格式，样式复用 `.maRow`），渲染于「今日关键价格」卡片之后 |
| `dsh-plugin/tests/detail.test.ts` | 三处断言：无同日快照 + 短序列 → 全 `null`；盘中（现价 33 + 21 根已收盘）→ ma5/10/20 具体数值、ma30/60 为 null；新增「非盘中 65 根已收盘」用例 → ma5..ma60 全数值 |
| `specs/dsh-plugin-daily-ma-lines.md` | 本 Spec / Task Card / Review Report |

### 验收标准核对

全部满足（见上"Spec 符合性"）。label 采用「MA5」格式；历史不足对应项显示 `--`。

### 未完成项

无。

### 建议验证命令

```bash
cd dsh-plugin
npm test
npx tsc --noEmit --skipLibCheck --module nodenext --moduleResolution nodenext \
  --target es2022 --lib es2022,dom --types node --jsx react-jsx \
  src/client/css.d.ts src/client/StockDetail.tsx src/client/DailyPanel.tsx
npx tsc --noEmit --skipLibCheck --module nodenext --moduleResolution nodenext \
  --target es2022 --lib es2022,dom --types node src/detail.ts
npx tsdown   # 重建 lib/client.js 与 lib/index.js 供宿主加载
```

### 需人工确认事项

1. 盘中 MA 口径为「已收盘日 K + 现价」（主流看盘软件惯例）；如你更希望只用已收盘价（基本面口径），改动一行即可，请告知。
2. 均线卡片标题暂用「均线（日线）」，与 5 分钟视图的「MA5…MA60」（5 分钟口径）区分；如需改名（如「日线均线」）可随时调整。
