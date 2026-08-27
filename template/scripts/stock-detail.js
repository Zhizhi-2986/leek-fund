const vscode = acquireVsCodeApi();

const state = {
  stockList: [],
  currentCode: '',
  requestId: 0,
  marketOverviewTimer: null,
};

function post(command, payload) {
  vscode.postMessage(Object.assign({ command }, payload || {}));
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value, digits) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toFixed(digits);
}

/** 格式化金额：元 → 万/亿 */
function formatAmount(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return '--';
  if (num >= 1e8) return (num / 1e8).toFixed(2) + '亿';
  if (num >= 1e4) return (num / 1e4).toFixed(2) + '万';
  return num.toFixed(2);
}

function selectStock(code) {
  const normalizedCode = String(code || '').toLowerCase();
  if (!normalizedCode || normalizedCode === state.currentCode) return;

  state.currentCode = normalizedCode;
  state.requestId += 1;
  renderStockList();
  clearDetail();
  setMessage('加载行情详情...');
  post('getStockDetail', {
    code: normalizedCode,
    requestId: state.requestId,
  });
}

function renderStockList() {
  const target = document.getElementById('stockList');
  if (!state.stockList.length) {
    target.innerHTML = '<div class="empty">暂无 A 股自选</div>';
    return;
  }

  target.innerHTML = state.stockList
    .map((item) => {
      const info = item.info || {};
      const active = info.code === state.currentCode ? ' active' : '';
      return `<button class="stock-item${active}" type="button" data-code="${escapeHtml(
        info.code
      )}">
        <span>${escapeHtml(info.name || info.code)}</span>
        <strong>${formatNumber(info.price, 3)}</strong>
        <em>${escapeHtml(info.percent || '--')}%</em>
      </button>`;
    })
    .join('');
}

function renderDetail(detail) {
  document.getElementById('stockName').textContent = detail.name || detail.code;
  document.getElementById('stockCode').textContent = String(
    detail.code || ''
  ).toUpperCase();
  document.getElementById('lastUpdated').textContent = detail.time
    ? `更新时间：${detail.time}`
    : '';

  // 更新价格信息栏
  renderPriceBar(detail);

  drawKlineChart(
    document.getElementById('dailyKChart'),
    detail.dailyKline || []
  );
  renderMAValues(detail);
  drawMinuteChart(
    document.getElementById('minuteChart'),
    detail.minuteLine || [],
    detail
  );
  renderOrderBook(detail.orderBook || { asks: [], bids: [] });
  renderTrades(detail.trades || []);
  setMessage('');
}

function renderPriceBar(detail) {
  const pbPrice = document.getElementById('pbPrice');
  const pbPercent = document.getElementById('pbPercent');
  const pbUpdown = document.getElementById('pbUpdown');
  const pbLimitUp = document.getElementById('pbLimitUp');
  const pbLimitDown = document.getElementById('pbLimitDown');
  const pbMarketCap = document.getElementById('pbMarketCap');
  const pbVolumeRatio = document.getElementById('pbVolumeRatio');

  const price = detail.price || 0;
  const yestclose = detail.yestclose || 0;
  const updown = price - yestclose;
  const percent = yestclose > 0 ? (updown / yestclose) * 100 : 0;
  const isUp = percent >= 0;

  // 现价
  pbPrice.textContent = formatNumber(price, 2);
  pbPrice.style.color = isUp ? '#e06c75' : '#98c379';

  // 涨跌幅
  pbPercent.textContent = `${isUp ? '+' : ''}${formatNumber(percent, 2)}%`;
  pbPercent.style.color = isUp ? '#e06c75' : '#98c379';

  // 涨跌额
  pbUpdown.textContent = `${isUp ? '+' : ''}${formatNumber(updown, 2)}`;
  pbUpdown.style.color = isUp ? '#e06c75' : '#98c379';

  // 涨停
  pbLimitUp.textContent = detail.limitUp ? formatNumber(detail.limitUp, 2) : '--';

  // 跌停
  pbLimitDown.textContent = detail.limitDown ? formatNumber(detail.limitDown, 2) : '--';

  // 流通市值
  pbMarketCap.textContent = detail.circulatingMarketCap ? formatAmount(detail.circulatingMarketCap) : '--';

  // 量比
  pbVolumeRatio.textContent = detail.volumeRatio ? formatNumber(detail.volumeRatio, 2) : '--';
}

function renderMAValues(detail) {
  const items = [
    { label: 'MA5', value: detail.ma5, cls: 'ma5' },
    { label: 'MA10', value: detail.ma10, cls: 'ma10' },
    { label: 'MA20', value: detail.ma20, cls: 'ma20' },
  ];
  document.getElementById('maValues').innerHTML = items
    .map(
      (item) =>
        `<span class="ma-item">
          <span class="ma-label">${item.label}</span>
          <span class="ma-value ${item.cls}">${
          item.value != null ? formatNumber(item.value, 2) : '--'
        }</span>
        </span>`
    )
    .join('');
}

function clearDetail() {
  document.getElementById('stockName').textContent = '股票详情';
  document.getElementById('stockCode').textContent =
    state.currentCode.toUpperCase();
  document.getElementById('lastUpdated').textContent = '';
  // 重置价格栏
  document.getElementById('pbPrice').textContent = '--';
  document.getElementById('pbPrice').style.color = '';
  document.getElementById('pbPercent').textContent = '--';
  document.getElementById('pbPercent').style.color = '';
  document.getElementById('pbUpdown').textContent = '--';
  document.getElementById('pbUpdown').style.color = '';
  document.getElementById('pbLimitUp').textContent = '--';
  document.getElementById('pbLimitDown').textContent = '--';
  document.getElementById('pbMarketCap').textContent = '--';
  document.getElementById('pbVolumeRatio').textContent = '--';
  clearCanvas(document.getElementById('dailyKChart'));
  document.getElementById('maValues').innerHTML = '';
  clearCanvas(document.getElementById('minuteChart'));
  document.getElementById('orderBookBody').innerHTML = '';
  document.getElementById('tradeBody').innerHTML = '';
}

function setMessage(text) {
  const target = document.getElementById('message');
  target.textContent = text;
  target.style.display = text ? 'block' : 'none';
}

function renderOrderBook(orderBook) {
  const asks = (orderBook.asks || []).slice().reverse();
  const bids = orderBook.bids || [];
  const isEmpty = !asks.length && !bids.length;
  if (isEmpty) {
    document.getElementById('orderBookBody').innerHTML =
      '<tr><td colspan="3" class="empty-cell">指数无买卖五档</td></tr>';
    return;
  }
  const rows = [
    ...asks.map((item) => renderOrderBookRow(`卖${item.level}`, item, 'down')),
    ...bids.map((item) => renderOrderBookRow(`买${item.level}`, item, 'up')),
  ];
  document.getElementById('orderBookBody').innerHTML =
    rows.join('') ||
    '<tr><td colspan="3" class="empty-cell">暂无五档数据</td></tr>';
}

function renderOrderBookRow(label, item, status) {
  return `<tr class="${status}">
    <td>${escapeHtml(label)}</td>
    <td>${formatNumber(item.price, 3)}</td>
    <td>${formatNumber(item.volume, 0)}</td>
  </tr>`;
}

function renderTrades(trades) {
  document.getElementById('tradeBody').innerHTML =
    trades
      .map((item) => {
        const directionLabel =
          item.direction === 'up'
            ? '上行'
            : item.direction === 'down'
            ? '下行'
            : '持平';
        return `<tr class="${escapeHtml(item.direction)}">
          <td>${escapeHtml(item.time)}</td>
          <td>${formatNumber(item.price, 3)}</td>
          <td>${formatNumber(item.volume, 0)}</td>
          <td>${directionLabel}</td>
        </tr>`;
      })
      .join('') ||
    '<tr><td colspan="4" class="empty-cell">暂无成交明细</td></tr>';
}

// ── 大盘概览渲染 ────────────────────────────────────────────────────────

function renderMarketOverview(overview) {
  if (!overview) return;
  document.getElementById('moUpCount').textContent = overview.upCount ?? '--';
  document.getElementById('moDownCount').textContent = overview.downCount ?? '--';
  document.getElementById('moFlatCount').textContent = overview.flatCount ?? '--';
  document.getElementById('moShAmount').textContent = overview.shAmount ? formatAmount(overview.shAmount) : '--';
  document.getElementById('moSzAmount').textContent = overview.szAmount ? formatAmount(overview.szAmount) : '--';
  document.getElementById('moTotalAmount').textContent = overview.totalAmount ? formatAmount(overview.totalAmount) : '--';
  document.getElementById('moEstCloseAmount').textContent = overview.estimatedCloseAmount ? formatAmount(overview.estimatedCloseAmount) : '--';
  if (overview.time) {
    document.getElementById('marketOverviewTime').textContent = `更新于 ${overview.time}`;
  }
}

function startMarketOverviewRefresh() {
  // 立即刷新一次
  post('getMarketOverview');
  // 每 30 秒刷新一次
  if (state.marketOverviewTimer) {
    clearInterval(state.marketOverviewTimer);
  }
  state.marketOverviewTimer = setInterval(() => {
    post('getMarketOverview');
  }, 30000);
}

// ── 日 K 线图 ──────────────────────────────────────────────────────────

function drawKlineChart(canvas, data) {
  const ctx = setupCanvas(canvas);
  if (!data.length) {
    drawEmpty(ctx, canvas, '暂无日 K 数据');
    return;
  }

  const padding = { top: 18, right: 54, bottom: 24, left: 52 };
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const values = data
    .flatMap((item) => [item.high, item.low])
    .filter((value) => value > 0);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const gap = chartWidth / data.length;
  const candleWidth = Math.max(3, Math.min(9, gap * 0.62));

  drawGrid(ctx, padding, width, height, min, max);
  data.forEach((item, index) => {
    const x = padding.left + gap * index + gap / 2;
    const openY = priceToY(item.open, min, range, padding.top, chartHeight);
    const closeY = priceToY(item.close, min, range, padding.top, chartHeight);
    const highY = priceToY(item.high, min, range, padding.top, chartHeight);
    const lowY = priceToY(item.low, min, range, padding.top, chartHeight);
    const isUp = item.close >= item.open;
    ctx.strokeStyle = isUp ? '#e06c75' : '#98c379';
    ctx.fillStyle = isUp ? '#e06c75' : '#98c379';
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(Math.abs(closeY - openY), 1);
    ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
  });
}

// ── 分时图（重写）────────────────────────────────────────────────────────

function drawMinuteChart(canvas, data, detail) {
  const ctx = setupCanvas(canvas);
  if (!data.length) {
    drawEmpty(ctx, canvas, '暂无分时数据');
    return;
  }

  const padding = { top: 20, right: 58, bottom: 26, left: 56 };
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const yestclose = detail.yestclose || 0;
  if (yestclose <= 0) {
    drawEmpty(ctx, canvas, '缺少昨收数据，无法绘制分时图');
    return;
  }

  // 计算每条数据的涨跌幅
  const points = data.map((p) => ({
    ...p,
    percent: yestclose > 0 ? ((p.price - yestclose) / yestclose) * 100 : 0,
  }));

  // 找最大/最小涨跌幅
  let maxPercent = 0;
  let minPercent = 0;
  for (const p of points) {
    if (p.percent > maxPercent) maxPercent = p.percent;
    if (p.percent < minPercent) minPercent = p.percent;
  }

  // 确定 Y 轴百分比范围：默认 ±10%，超限自动切换 ±20%
  const absMax = Math.max(Math.abs(maxPercent), Math.abs(minPercent));
  let yRange = 10;
  if (absMax > 10) {
    yRange = 20;
  }
  const halfRange = yRange;

  // ── 直接在 canvas 上绘制图表 ──

  // 1. 背景网格与坐标轴
  drawMinuteGrid(ctx, padding, width, height, yestclose, halfRange, chartHeight);

  // 2. 绘制均价线
  const avgPrice = detail.avgPrice || 0;
  if (avgPrice > 0) {
    const avgPercent = ((avgPrice - yestclose) / yestclose) * 100;
    const avgY =
      padding.top +
      chartHeight / 2 -
      (avgPercent / halfRange) * (chartHeight / 2);
    ctx.strokeStyle = 'rgba(230, 126, 34, 0.7)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padding.left, avgY);
    ctx.lineTo(width - padding.right, avgY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 均价标签（右侧）
    ctx.fillStyle = '#e67e22';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('均价 ' + formatNumber(avgPrice, 2), width - padding.right + 6, avgY - 4);
  }

  // 3. 绘制价格线
  ctx.strokeStyle = '#61afef';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const x =
      padding.left + (chartWidth * i) / Math.max(points.length - 1, 1);
    const p = points[i];
    const y =
      padding.top +
      chartHeight / 2 -
      (p.percent / halfRange) * (chartHeight / 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // 4. 绘制 0 轴（昨收线）— 加粗实线
  const zeroY = padding.top + chartHeight / 2;
  ctx.strokeStyle = '#8993a1';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(padding.left, zeroY);
  ctx.lineTo(width - padding.right, zeroY);
  ctx.stroke();

  // 5. 标注当日最高/最低点
  let highPoint = points[0];
  let lowPoint = points[0];
  for (const p of points) {
    if (p.percent > highPoint.percent) highPoint = p;
    if (p.percent < lowPoint.percent) lowPoint = p;
  }

  // 最高点标注
  if (highPoint.percent > 0) {
    const hx =
      padding.left +
      (chartWidth * points.indexOf(highPoint)) / Math.max(points.length - 1, 1);
    const hy =
      padding.top +
      chartHeight / 2 -
      (highPoint.percent / halfRange) * (chartHeight / 2);
    // 小圆点
    ctx.fillStyle = '#e06c75';
    ctx.beginPath();
    ctx.arc(hx, hy, 3, 0, Math.PI * 2);
    ctx.fill();
    // 标注文本框
    const hLabel = `高 ${formatNumber(highPoint.price, 2)}`;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const hTextWidth = ctx.measureText(hLabel).width;
    const hLabelX = Math.min(hx + 6, width - padding.right - hTextWidth - 4);
    const hLabelY = hy - 8;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(hLabelX - 2, hLabelY - 10, hTextWidth + 8, 16);
    ctx.fillStyle = '#e06c75';
    ctx.fillText(hLabel, hLabelX + 2, hLabelY + 1);
  }

  // 最低点标注
  if (lowPoint.percent < 0) {
    const lx =
      padding.left +
      (chartWidth * points.indexOf(lowPoint)) / Math.max(points.length - 1, 1);
    const ly =
      padding.top +
      chartHeight / 2 -
      (lowPoint.percent / halfRange) * (chartHeight / 2);
    ctx.fillStyle = '#98c379';
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fill();
    const lLabel = `低 ${formatNumber(lowPoint.price, 2)}`;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const lTextWidth = ctx.measureText(lLabel).width;
    const lLabelX = Math.min(lx + 6, width - padding.right - lTextWidth - 4);
    const lLabelY = ly + 18;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(lLabelX - 2, lLabelY - 10, lTextWidth + 8, 16);
    ctx.fillStyle = '#98c379';
    ctx.fillText(lLabel, lLabelX + 2, lLabelY + 1);
  }

  // 6. 右侧显示当前涨跌幅
  const lastPoint = points[points.length - 1];
  if (lastPoint) {
    const lastY =
      padding.top +
      chartHeight / 2 -
      (lastPoint.percent / halfRange) * (chartHeight / 2);
    ctx.fillStyle = lastPoint.percent >= 0 ? '#e06c75' : '#98c379';
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(
      `${lastPoint.percent >= 0 ? '+' : ''}${formatNumber(lastPoint.percent, 2)}%`,
      width - padding.right + 6,
      lastY + 4
    );
  }

  // 更新图例信息
  document.getElementById('minuteChartInfo').textContent =
    `1 分钟粒度 · ${yRange === 10 ? '±10%' : '±20%'} 坐标轴`;
}

/** 绘制分时图的百分比网格 */
function drawMinuteGrid(ctx, padding, width, height, yestclose, halfRange, chartHeight) {
  const leftLabels = [];
  const rightLabels = [];
  // 从 -halfRange 到 +halfRange，步长 halfRange/2
  const steps = 4; // 4 个区间 → 5 条线（-100%, -50%, 0%, +50%, +100% of range）
  for (let i = 0; i <= steps; i++) {
    const ratio = (i / steps) * 2 - 1; // -1 ~ +1
    const percentValue = ratio * halfRange;
    const y =
      padding.top + chartHeight / 2 - ratio * (chartHeight / 2);

    // 网格线
    ctx.strokeStyle = i === steps / 2 ? '#4a5260' : '#303743';
    ctx.lineWidth = i === steps / 2 ? 1.2 : 0.8;
    ctx.setLineDash(i === steps / 2 ? [] : [3, 3]);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 左侧百分比标签
    const pctLabel = `${percentValue >= 0 ? '+' : ''}${formatNumber(percentValue, 1)}%`;
    leftLabels.push({ y, label: pctLabel, isZero: i === steps / 2 });

    // 右侧价格标签
    const priceValue = yestclose * (1 + percentValue / 100);
    const priceLabel = formatNumber(priceValue, 2);
    rightLabels.push({ y, label: priceLabel, isZero: i === steps / 2 });
  }

  // 绘制左侧标签
  ctx.textAlign = 'right';
  ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  for (const item of leftLabels) {
    ctx.fillStyle = item.isZero ? '#8993a1' : '#5c6673';
    ctx.fillText(item.label, padding.left - 8, item.y + 4);
  }

  // 绘制右侧标签
  ctx.textAlign = 'left';
  for (const item of rightLabels) {
    ctx.fillStyle = item.isZero ? '#8993a1' : '#5c6673';
    ctx.fillText(item.label, width - padding.right + 6, item.y + 4);
  }

  // 绘制 0轴 特殊标注
  const zeroY = padding.top + chartHeight / 2;
  ctx.fillStyle = '#8993a1';
  ctx.textAlign = 'center';
  ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('0.00%', padding.left + 30, zeroY - 6);
}

// ── Canvas 工具函数 ─────────────────────────────────────────────────────

function setupCanvas(canvas) {
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

function clearCanvas(canvas) {
  const ctx = setupCanvas(canvas);
  drawEmpty(ctx, canvas, '');
}

function drawGrid(ctx, padding, width, height, min, max) {
  ctx.strokeStyle = '#3a414d';
  ctx.fillStyle = '#8993a1';
  ctx.lineWidth = 1;
  ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  for (let i = 0; i <= 4; i++) {
    const y = padding.top + ((height - padding.top - padding.bottom) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    const value = max - ((max - min) * i) / 4;
    ctx.fillText(formatNumber(value, 2), width - padding.right + 8, y + 4);
  }
}

function drawEmpty(ctx, canvas, text) {
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  ctx.fillStyle = '#8993a1';
  ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  if (text) {
    ctx.fillText(text, width / 2 - 42, height / 2);
  }
}

function priceToY(price, min, range, top, height) {
  return top + height - ((price - min) / range) * height;
}

// ── 事件绑定 ────────────────────────────────────────────────────────────

document.getElementById('stockList').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-code]');
  if (!button) return;
  selectStock(button.dataset.code);
});

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.command === 'stockListReady') {
    state.stockList = msg.data.stockList || [];
    const selectedCode =
      msg.data.selectedCode ||
      state.currentCode ||
      state.stockList[0]?.info?.code ||
      '';
    state.currentCode = '';
    renderStockList();
    selectStock(selectedCode);
  } else if (msg.command === 'stockDetailReady') {
    if (msg.requestId !== state.requestId || msg.code !== state.currentCode)
      return;
    renderDetail(msg.data);
  } else if (msg.command === 'stockDetailError') {
    if (msg.requestId !== state.requestId || msg.code !== state.currentCode)
      return;
    setMessage(msg.message || '行情详情加载失败');
  } else if (msg.command === 'marketOverviewReady') {
    renderMarketOverview(msg.data);
  }
});

post('pageReady');

// 启动大盘概览定时刷新
startMarketOverviewRefresh();
