# 指数分时图支持

## Spec

### 目标
在股票详情 Webview 中，A 股指数（如 sh000001 上证指数、sz399006 创业板指等）点击后能正常查看当日分时图、日 K 线图。不需要五档盘口（指数无此数据）。

### 修改范围
- `src/shared/stockDetailData.ts` — 放宽正则限制、修正指数 secid 映射
- `src/webview/stockDetailView.ts` — 放宽侧栏与详情校验
- `template/stock-detail.html` — 分时图面板文案适配指数
- `template/scripts/stock-detail.js` — 五档数据容错显示

### 非目标范围
- 不涉及港股/美股指数分时图
- 不涉及状态栏已有指数行情的修改
- 不涉及 TreeView 中指数的展示方式

### 验收标准
1. 点击自选列表中的 sh000001（上证指数）能打开详情 Webview
2. 能看到当日分时走势图
3. 能看到日 K 线图
4. 五档区域显示"指数无买卖五档"提示，不报错
5. 现有个股详情不受影响

## Task Card

### 当前任务
实现指数分时图支持

### 允许修改
- `src/shared/stockDetailData.ts`
- `src/webview/stockDetailView.ts`
- `template/stock-detail.html`
- `template/scripts/stock-detail.js`

### 禁止修改
- 其他文件

### 执行步骤
1. 修改 `stockDetailData.ts`：放宽 `normalizeAStockCode` 正则；修正 `getAStockMinuteLine` 的 secid 映射以支持指数
2. 修改 `stockDetailView.ts`：放宽侧栏股票列表过滤和详情校验
3. 修改 `stock-detail.html`：调整分时图面板说明
4. 修改 `stock-detail.js`：五档数据空时显示友好提示

### Review 检查点
- 指数代码 sh000001 → secid 为 `1.000001`（市场码 1）；sz399006 → secid 为 `0.399006`（市场码 0）
- 个股分时图不受影响
- 无五档时不抛异常
