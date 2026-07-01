const vscode = acquireVsCodeApi();

const state = {
  stockList: [],
  currentCode: '',
  requestId: 0,
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

  drawKlineChart(
    document.getElementById('dailyKChart'),
    detail.dailyKline || []
  );
  drawMinuteChart(
    document.getElementById('minuteChart'),
    detail.minuteLine || []
  );
  renderOrderBook(detail.orderBook || { asks: [], bids: [] });
  renderTrades(detail.trades || []);
  setMessage('');
}

function clearDetail() {
  document.getElementById('stockName').textContent = '股票详情';
  document.getElementById('stockCode').textContent =
    state.currentCode.toUpperCase();
  document.getElementById('lastUpdated').textContent = '';
  clearCanvas(document.getElementById('dailyKChart'));
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

function drawMinuteChart(canvas, data) {
  const ctx = setupCanvas(canvas);
  if (!data.length) {
    drawEmpty(ctx, canvas, '暂无分时数据');
    return;
  }

  const padding = { top: 18, right: 54, bottom: 24, left: 52 };
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const prices = data.map((item) => item.price).filter((value) => value > 0);
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  const range = max - min || 1;

  // 计算昨收价和涨跌幅
  const lastClose =
    data[0]?.price / (1 + (data[0]?.percentChange || 0) / 100) ||
    data[0]?.price;
  const currentPrice = data[data.length - 1]?.price;
  const currentPercent = data[data.length - 1]?.percentChange || 0;

  // 调整价格范围，确保昨收价线在图内
  const adjustedMin = Math.min(min, lastClose);
  const adjustedMax = Math.max(max, lastClose);
  const adjustedRange = adjustedMax - adjustedMin || 1;

  drawGridWithPercent(
    ctx,
    padding,
    width,
    height,
    adjustedMin,
    adjustedMax,
    currentPercent
  );

  // 绘制昨收价参考线
  if (lastClose > 0) {
    const lastCloseY = priceToY(
      lastClose,
      adjustedMin,
      adjustedRange,
      padding.top,
      chartHeight
    );
    ctx.strokeStyle = '#8993a1';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padding.left, lastCloseY);
    ctx.lineTo(width - padding.right, lastCloseY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#8993a1';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(
      formatNumber(lastClose, 2),
      width - padding.right + 8,
      lastCloseY + 4
    );
  }

  ctx.strokeStyle = '#61afef';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  data.forEach((item, index) => {
    const x =
      padding.left + (chartWidth * index) / Math.max(data.length - 1, 1);
    const y = priceToY(
      item.price,
      adjustedMin,
      adjustedRange,
      padding.top,
      chartHeight
    );
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 在右侧显示当前涨跌幅
  const lastPriceY = priceToY(
    currentPrice,
    adjustedMin,
    adjustedRange,
    padding.top,
    chartHeight
  );
  ctx.fillStyle = currentPercent >= 0 ? '#e06c75' : '#98c379';
  ctx.font =
    'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(
    `${currentPercent >= 0 ? '+' : ''}${formatNumber(currentPercent, 2)}%`,
    width - padding.right + 8,
    lastPriceY + 4
  );
}

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

function drawGridWithPercent(
  ctx,
  padding,
  width,
  height,
  min,
  max,
  currentPercent
) {
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
    // Y轴右侧显示价格
    ctx.fillText(formatNumber(value, 2), width - padding.right + 8, y + 4);
    // Y轴左侧显示涨跌幅
    const percentValue =
      ((value - min) / (max - min || 1) - 0.5) * 2 * currentPercent;
    ctx.fillText(
      `${percentValue >= 0 ? '+' : ''}${formatNumber(percentValue, 2)}%`,
      2,
      y + 4
    );
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
  }
});

post('pageReady');
