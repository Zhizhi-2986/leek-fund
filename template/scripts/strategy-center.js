const vscode = acquireVsCodeApi();

const state = {
  strategy: null,
  holdings: [],
  account: {},
  monitor: null,
  recommendations: null,
};

function post(command, data) {
  vscode.postMessage({ command, data });
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

function normalizeCode(code) {
  return String(code || '').trim().toLowerCase();
}

function statusLabel(status) {
  if (status === 'risk') return '风险';
  if (status === 'watch') return '观察';
  return '正常';
}

function renderSnapshot(data) {
  state.strategy = data.strategy;
  state.holdings = Array.isArray(data.holdings) ? data.holdings : [];
  state.account = data.account || {};
  state.monitor = data.monitor;
  state.recommendations = data.recommendations;

  renderSummary();
  renderStrategy();
  renderHoldings();
  renderAccount();
  renderMonitor();
  renderRecommendations();
}

function renderSummary() {
  const recommendations = state.recommendations || {};
  const monitor = state.monitor || {};
  const text = [
    `持仓 ${state.holdings.length} 只`,
    `推荐 ${recommendations.items ? recommendations.items.length : 0} 只`,
    monitor.accountStatus === 'risk' ? '账户触发风险' : '账户未触发熔断',
  ].join(' / ');
  document.getElementById('summaryText').textContent = text;
}

function renderStrategy() {
  const strategy = state.strategy;
  const target = document.getElementById('strategyDescription');
  if (!strategy) {
    target.innerHTML = '<div class="empty">暂无策略描述</div>';
    return;
  }

  const sections = [];
  sections.push('<div class="strategy-grid">');
  sections.push(renderStrategyGroup('持仓管理纪律', strategy.positionRules));
  sections.push(renderStrategyGroup('选股逻辑框架', strategy.selectionRules));
  sections.push('</div>');
  sections.push('<h3>交易决策清单</h3>');
  sections.push('<ol class="checklist">');
  (strategy.checklist || []).forEach((item) => {
    sections.push(`<li>${escapeHtml(item)}</li>`);
  });
  sections.push('</ol>');
  target.innerHTML = sections.join('');
}

function renderStrategyGroup(title, groups) {
  const html = [`<div class="strategy-column"><h3>${escapeHtml(title)}</h3>`];
  (groups || []).forEach((group) => {
    html.push(`<div class="rule-block"><h4>${escapeHtml(group.title)}</h4><ul>`);
    (group.items || []).forEach((item) => {
      html.push(`<li>${escapeHtml(item)}</li>`);
    });
    html.push('</ul></div>');
  });
  html.push('</div>');
  return html.join('');
}

function renderHoldings() {
  const body = document.getElementById('holdingTableBody');
  if (!state.holdings.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty-cell">暂无持仓股</td></tr>';
    return;
  }

  body.innerHTML = state.holdings
    .map((item) => {
      return `<tr>
        <td>${escapeHtml(item.code)}</td>
        <td>${escapeHtml(item.name || '--')}</td>
        <td>${formatNumber(item.costPrice, 3)}</td>
        <td>${formatNumber(item.shares, 0)}</td>
        <td>${escapeHtml(item.buyDate || '--')}</td>
        <td>${item.stopLossPrice ? formatNumber(item.stopLossPrice, 3) : '--'}</td>
        <td>${item.targetPrice ? formatNumber(item.targetPrice, 3) : '--'}</td>
        <td><button class="link-btn" data-delete-holding="${escapeHtml(item.code)}" type="button">删除</button></td>
      </tr>`;
    })
    .join('');
}

function renderAccount() {
  const form = document.getElementById('accountForm');
  const fields = form.elements;
  fields.totalAsset.value = state.account.totalAsset || '';
  fields.monthLossPercent.value =
    state.account.monthLossPercent === undefined ? '' : state.account.monthLossPercent;
}

function renderMonitor() {
  const monitor = state.monitor;
  const updatedAt = document.getElementById('monitorUpdatedAt');
  const accountTarget = document.getElementById('accountMonitor');
  const listTarget = document.getElementById('holdingMonitorList');

  if (!monitor) {
    updatedAt.textContent = '';
    accountTarget.textContent = '暂无监控结果';
    listTarget.innerHTML = '';
    return;
  }

  updatedAt.textContent = monitor.updatedAt ? `更新时间：${monitor.updatedAt}` : '';
  accountTarget.className = `notice notice--${monitor.accountStatus || 'ok'}`;
  accountTarget.innerHTML = [
    `<strong>${statusLabel(monitor.accountStatus)}</strong>`,
    `总资产：${monitor.totalAsset ? formatNumber(monitor.totalAsset, 2) : '--'}`,
    `当日收益率：${monitor.dayLossPercent === undefined ? '--' : formatNumber(monitor.dayLossPercent, 2) + '%'}`,
    (monitor.accountMessages || []).map(escapeHtml).join('；'),
  ].join(' ｜ ');

  const items = monitor.holdings || [];
  if (!items.length) {
    listTarget.innerHTML = '<div class="empty">暂无持仓监控项</div>';
    return;
  }

  listTarget.innerHTML = items
    .map((item) => {
      return `<article class="monitor-item monitor-item--${escapeHtml(item.status)}">
        <div class="monitor-item__head">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.code)}</span>
          <em>${statusLabel(item.status)}</em>
        </div>
        <div class="monitor-item__metrics">
          <span>现价 ${item.currentPrice === undefined ? '--' : formatNumber(item.currentPrice, 3)}</span>
          <span>仓位 ${item.positionPercent === undefined ? '--' : formatNumber(item.positionPercent, 2) + '%'}</span>
          <span>浮盈亏 ${item.earningPercent === undefined ? '--' : formatNumber(item.earningPercent, 2) + '%'}</span>
          <span>市值 ${item.marketValue === undefined ? '--' : formatNumber(item.marketValue, 2)}</span>
        </div>
        <ul>${(item.messages || []).map((msg) => `<li>${escapeHtml(msg)}</li>`).join('')}</ul>
      </article>`;
    })
    .join('');
}

function renderRecommendations() {
  const recommendations = state.recommendations || {};
  const updatedAt = document.getElementById('recommendUpdatedAt');
  const marketReason = document.getElementById('marketReason');
  const body = document.getElementById('recommendTableBody');

  updatedAt.textContent = recommendations.updatedAt
    ? `更新时间：${recommendations.updatedAt}，范围 ${recommendations.universeSize || 0} 只`
    : '';
  marketReason.className = `notice notice--${recommendations.marketPass ? 'ok' : 'watch'}`;
  marketReason.textContent = recommendations.marketReason || '尚未执行策略选股。';

  const items = recommendations.items || [];
  if (!items.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty-cell">暂无命中策略的推荐 A 股</td></tr>';
    return;
  }

  body.innerHTML = items
    .map((item) => {
      return `<tr>
        <td>${escapeHtml(item.code)}</td>
        <td>${escapeHtml(item.name)}</td>
        <td>${formatNumber(item.price, 3)}</td>
        <td>${formatNumber(item.stopLossPrice, 3)}</td>
        <td>${formatNumber(item.targetPrice, 3)}</td>
        <td>${formatNumber(item.riskRewardRatio, 2)}:1</td>
        <td><ul class="compact-list">${(item.reasons || []).map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul></td>
        <td><ul class="compact-list">${(item.manualChecks || []).map((check) => `<li>${escapeHtml(check)}</li>`).join('')}</ul></td>
      </tr>`;
    })
    .join('');
}

function saveHoldings() {
  post('saveHoldings', state.holdings);
}

document.getElementById('holdingForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = form.elements;
  const code = normalizeCode(fields.code.value);
  if (!/^(sh|sz|bj)\d{6}$/.test(code)) {
    post('alert', null);
    return;
  }

  const next = {
    code,
    name: fields.name.value.trim() || undefined,
    costPrice: Number(fields.costPrice.value),
    shares: Number(fields.shares.value),
    buyDate: fields.buyDate.value || undefined,
    stopLossPrice: fields.stopLossPrice.value ? Number(fields.stopLossPrice.value) : undefined,
    targetPrice: fields.targetPrice.value ? Number(fields.targetPrice.value) : undefined,
  };

  if (!(next.costPrice > 0) || !(next.shares > 0)) {
    post('alert', null);
    return;
  }

  const rest = state.holdings.filter((item) => item.code !== code);
  state.holdings = [...rest, next];
  form.reset();
  renderHoldings();
  saveHoldings();
});

document.getElementById('holdingTableBody').addEventListener('click', (event) => {
  const target = event.target;
  const code = target && target.dataset ? target.dataset.deleteHolding : '';
  if (!code) return;
  state.holdings = state.holdings.filter((item) => item.code !== code);
  renderHoldings();
  saveHoldings();
});

document.getElementById('accountForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = form.elements;
  post('saveAccount', {
    totalAsset: fields.totalAsset.value ? Number(fields.totalAsset.value) : undefined,
    monthLossPercent: fields.monthLossPercent.value ? Number(fields.monthLossPercent.value) : undefined,
  });
});

document.getElementById('runSelectionBtn').addEventListener('click', (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = '选股中...';
  post('runSelection');
});

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.command === 'strategySnapshot') {
    document.getElementById('runSelectionBtn').disabled = false;
    document.getElementById('runSelectionBtn').textContent = '立即选股';
    renderSnapshot(msg.data);
  } else if (msg.command === 'operationFailed') {
    document.getElementById('runSelectionBtn').disabled = false;
    document.getElementById('runSelectionBtn').textContent = '立即选股';
  }
});

post('pageReady');
