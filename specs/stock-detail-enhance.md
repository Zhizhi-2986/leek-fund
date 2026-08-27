# VibeSpec：stock-detail-enhance

## 1. Spec

### 目标

优化股票详情页的分时图、价格信息布局，并增加大盘实时概览数据，提升看盘信息密度与便利性。

### 修改范围

- **数据层**：扩展 `StockDetailData` 接口，补充流通市值、量比、涨停价、跌停价、均价、昨收字段；从东方财富 API 获取这些字段；新增大盘涨跌家数、量能数据获取函数。
- **后端**：`stockDetailView.ts` 透传新字段；新增大盘数据消息通道。
- **前端**：重写分时图渲染；新增价格信息栏；新增大盘概览面板；更新 CSS 样式。

### 非目标范围

- 不修改自选股树（stockProvider）、状态栏（statusBar）、策略中心等其他功能。
- 不修改现有的日 K 图渲染逻辑。
- 不新增外部 npm 依赖。
- 不修改 DSH plugin 代码。
- 不修改数据源层（sina.ts、eastmoney.ts）的通用接口定义（`QuoteResult`、`KlinePoint`），仅扩展个股详情获取函数。
- 不自动 commit、push、merge。

### 验收标准

1. 分时图 Y 轴以昨收为 0 轴，默认展示 ±10%，盘中最大涨跌幅超过 10% 时自动切换到 ±20%。
2. 分时图中绘制均价线（VWAP），标注当日最高/最低价位置。
3. 不再在信息栏单独展示昨收信息，昨收作为 0 轴在分时图中标注。
4. 信息栏重新排版：现价、涨停价、跌停价、流通市值、量比。
5. 新增"大盘概况"面板，显示实时上涨/下跌家数、大盘实际量能、预计收盘量能。
6. TypeScript 编译通过，WebView 渲染无报错。

---

## 2. Task Card

### 当前任务

优化股票详情页的分时图、价格信息排布，新增大盘实时概览。

### 允许修改

- `src/shared/stockDetailData.ts` — 扩展接口、补充数据字段、新增大盘数据函数
- `src/webview/stockDetailView.ts` — 透传新字段、新增消息处理
- `template/stock-detail.html` — 调整布局
- `template/scripts/stock-detail.js` — 重写分时图、更新渲染逻辑
- `template/styles/stock-detail.css` — 新增样式

### 禁止修改

- 不修改 `src/explorer/`、`src/statusbar/`、`src/registerCommand.ts`、`src/extension.ts`、`src/shared/typed.ts` 等无关文件
- 不修改 `dsh-plugin/` 目录下的任何文件
- 不修改 `src/data-source/` 的通用接口定义（`QuoteResult`、`KlinePoint`）
- 不修改 `package.json` 或新增 npm 依赖

### 执行步骤

1. 扩展 `StockDetailData` 类型，补充新字段。
2. 修改 `getAStockDetailData()`，从东方财富获取流通市值、量比、涨停跌停价；计算均价。
3. 修改 `stockDetailView.ts` 透传新字段；新增大盘数据请求/响应消息处理。
4. 修改 `stock-detail.html` 布局：价格信息栏、大盘概况面板。
5. 重写 `stock-detail.js` 的 `drawMinuteChart()`；更新 `renderDetail()`；新增大盘数据渲染。
6. 更新 `stock-detail.css` 样式。
7. 运行 `npm run compile` 验证 TypeScript 编译。
8. 检查 git diff 确认修改范围正确。

### Review 检查点

- 分时图坐标轴百分比范围逻辑是否正确（±10%/±20% 自动切换）
- 均价线计算是否正确（VWAP = 成交额/成交量）
- 价格信息栏数据是否与东方财富 API 返回一致
- 大盘数据是否获取正确
- 是否引入无关修改
- 是否修改了禁止修改的文件

---

## 3. Review Report

> 开发完成后填写。
