import { commands, window } from 'vscode';
import globalState from '../globalState';
import { LeekTreeItem } from './leekTreeItem';
import { LeekFundConfig } from './leekConfig';
import { KlineData, calculateIndicators, getKlineData } from './technicalAnalysis';
import { MarketItemInfo } from './typed';
import { formatDateTime, uniq } from './utils';

export const HOLDING_STOCKS_CONFIG_KEY = 'leek-fund.holdingStocks';
export const STRATEGY_ACCOUNT_CONFIG_KEY = 'leek-fund.strategyAccount';
export const RECOMMENDED_A_STOCKS_CONFIG_KEY = 'leek-fund.recommendedAStocks';

const A_STOCK_INDEX_CODES = ['sh000001', 'sh000300', 'sh000016', 'sh000688'];
const MANUAL_SELECTION_CHECKS = [
  '板块是否为近期主流热点',
  '是否为板块内公认龙头',
  '是否存在政策或事件持续催化',
  '流通市值是否处于个人策略区间',
  'PE 是否显著高于行业均值',
  '是否存在减持、问询、高溢价并购等负面公告',
];

type MonitorStatus = 'ok' | 'watch' | 'risk';

export interface HoldingStock {
  code: string;
  name?: string;
  costPrice: number;
  shares: number;
  buyDate?: string;
  stopLossPrice?: number;
  targetPrice?: number;
}

export interface StrategyAccountConfig {
  totalAsset?: number;
  monthLossPercent?: number;
}

export interface StrategyDescriptionSection {
  title: string;
  items: string[];
}

export interface TradingStrategyDescription {
  title: string;
  positionRules: StrategyDescriptionSection[];
  selectionRules: StrategyDescriptionSection[];
  checklist: string[];
}

export interface HoldingMonitorItem {
  code: string;
  name: string;
  status: MonitorStatus;
  currentPrice?: number;
  marketValue?: number;
  earningPercent?: number;
  positionPercent?: number;
  messages: string[];
}

export interface HoldingMonitorSnapshot {
  accountStatus: MonitorStatus;
  accountMessages: string[];
  dayLossPercent?: number;
  totalAsset?: number;
  holdings: HoldingMonitorItem[];
  updatedAt: string;
}

export interface RecommendedAStock {
  code: string;
  name: string;
  price: number;
  stopLossPrice: number;
  targetPrice: number;
  riskRewardRatio: number;
  reasons: string[];
  manualChecks: string[];
}

export interface RecommendationCache {
  updatedAt: string;
  trigger: 'manual' | 'schedule';
  universeSize: number;
  marketPass: boolean;
  marketReason: string;
  items: RecommendedAStock[];
}

export interface StrategySnapshot {
  strategy: TradingStrategyDescription;
  holdings: HoldingStock[];
  account: StrategyAccountConfig;
  monitor: HoldingMonitorSnapshot;
  recommendations: RecommendationCache;
}

const riskNoticeCache: Record<string, number> = {};

export const TRADING_STRATEGY_DESCRIPTION: TradingStrategyDescription = {
  title: '持仓管理 + 选股逻辑',
  positionRules: [
    {
      title: '单票仓位上限',
      items: [
        '单只股票总仓位不超过 20%，新手不超过 10%。',
        '首次买入不超过总仓位 5%-10%，趋势确认后才允许金字塔加仓。',
        '亏损状态下禁止摊平成本式加仓。',
      ],
    },
    {
      title: '硬止损铁律',
      items: [
        '买入前必须确定止损方式。',
        '固定比例止损：亏损达到 -5% 至 -7% 离场。',
        '技术位止损：跌破关键支撑位立即离场。',
        '时间止损：3-5 个交易日未按预期上涨，先离场观察。',
      ],
    },
    {
      title: '账户熔断',
      items: [
        '单日账户亏损达到 -2%，当天停止新开仓。',
        '单月账户亏损达到 -10%，当月空仓，次月再战。',
      ],
    },
  ],
  selectionRules: [
    {
      title: '趋势与方向',
      items: [
        '上证指数在 20 日均线之上，才允许积极选股。',
        '只做上升趋势且有持续催化的板块。',
        '个股需处于上升通道，短中长期均线保持多头结构。',
      ],
    },
    {
      title: '龙头与地位',
      items: [
        '优先选择板块内最强者，而非跟风弱势股。',
        '偏好适合个人风格的流通市值区间。',
        '近 3 个月需体现活跃股性。',
      ],
    },
    {
      title: '基本面排雷',
      items: [
        '回避估值显著高于行业且缺少增速支撑的股票。',
        '回避连续亏损且无明确拐点的股票。',
        '近期存在减持、问询、争议并购等负面事项的一票否决。',
      ],
    },
    {
      title: '买点与赔率',
      items: [
        '只做右侧交易，不抄底。',
        '买点需站稳 5 日均线，MACD 金叉或红柱放大。',
        '买入前盈亏比必须不低于 3:1。',
      ],
    },
  ],
  checklist: [
    '大盘指数在 20 日均线之上',
    '所属板块是近期主流热点',
    '该股是板块内公认龙头',
    '流通市值在适合自己的区间',
    '股价处于上升通道',
    '无重大负面公告',
    '买点符合右侧启动信号',
    '盈亏比 >= 3:1',
    '首次买入金额 <= 总仓位 10%',
    '当日账户未触发熔断',
  ],
};

export function getHoldingStocks(): HoldingStock[] {
  const raw = getStrategyState(HOLDING_STOCKS_CONFIG_KEY, []);
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map(normalizeHolding).filter((item): item is HoldingStock => Boolean(item));
}

export async function saveHoldingStocks(holdings: HoldingStock[]): Promise<HoldingStock[]> {
  const normalized = holdings
    .map(normalizeHolding)
    .filter((item): item is HoldingStock => Boolean(item));
  await setStrategyState(HOLDING_STOCKS_CONFIG_KEY, normalized);
  await syncHoldingCodesToStockConfig(normalized);
  return normalized;
}

export function getStrategyAccountConfig(): StrategyAccountConfig {
  const raw = getStrategyState<any>(STRATEGY_ACCOUNT_CONFIG_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  return {
    totalAsset: toPositiveNumber(raw.totalAsset),
    monthLossPercent: toNumberOrUndefined(raw.monthLossPercent),
  };
}

export async function saveStrategyAccountConfig(
  account: StrategyAccountConfig
): Promise<StrategyAccountConfig> {
  const normalized = {
    totalAsset: toPositiveNumber(account.totalAsset),
    monthLossPercent: toNumberOrUndefined(account.monthLossPercent),
  };
  await setStrategyState(STRATEGY_ACCOUNT_CONFIG_KEY, normalized);
  return normalized;
}

export function getRecommendationCache(): RecommendationCache {
  const raw = getStrategyState<any>(RECOMMENDED_A_STOCKS_CONFIG_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyRecommendationCache();
  }

  return {
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    trigger: raw.trigger === 'manual' ? 'manual' : 'schedule',
    universeSize: toNumber(raw.universeSize),
    marketPass: Boolean(raw.marketPass),
    marketReason: typeof raw.marketReason === 'string' ? raw.marketReason : '',
    items: Array.isArray(raw.items) ? raw.items.map(normalizeRecommendation).filter(Boolean) : [],
  } as RecommendationCache;
}

export function buildStrategySnapshot(stockList: LeekTreeItem[]): StrategySnapshot {
  const holdings = getHoldingStocks();
  const account = getStrategyAccountConfig();
  return {
    strategy: TRADING_STRATEGY_DESCRIPTION,
    holdings,
    account,
    monitor: evaluateHoldingStrategy(stockList, holdings, account),
    recommendations: getRecommendationCache(),
  };
}

export function evaluateHoldingStrategy(
  stockList: LeekTreeItem[],
  holdings: HoldingStock[] = getHoldingStocks(),
  account: StrategyAccountConfig = getStrategyAccountConfig()
): HoldingMonitorSnapshot {
  const stockMap = buildStockInfoMap(stockList);
  const holdingValues = holdings.map((holding) => {
    const info = stockMap.get(holding.code);
    const price = toNumber(info?.price);
    const yestclose = toNumber(info?.yestclose);
    return {
      holding,
      info,
      price,
      marketValue: price > 0 ? price * holding.shares : 0,
      dayProfit: price > 0 && yestclose > 0 ? (price - yestclose) * holding.shares : 0,
    };
  });

  const marketValueTotal = holdingValues.reduce((sum, item) => sum + item.marketValue, 0);
  const totalAsset = account.totalAsset && account.totalAsset > 0 ? account.totalAsset : marketValueTotal;
  const dayProfit = holdingValues.reduce((sum, item) => sum + item.dayProfit, 0);
  const dayLossPercent = totalAsset > 0 ? round((dayProfit / totalAsset) * 100, 2) : undefined;
  const accountMessages: string[] = [];

  if (dayLossPercent !== undefined && dayLossPercent <= -2) {
    accountMessages.push(`单日账户亏损 ${dayLossPercent}% 已触发 -2% 熔断线，停止新开仓。`);
  }
  if (account.monthLossPercent !== undefined && account.monthLossPercent <= -10) {
    accountMessages.push(`单月账户亏损 ${account.monthLossPercent}% 已触发 -10% 熔断线，当月应空仓。`);
  }

  const items = holdingValues.map(({ holding, info, price, marketValue }) => {
    const messages: string[] = [];
    const name = holding.name || info?.name || holding.code;
    const earningPercent = holding.costPrice > 0 ? round(((price - holding.costPrice) / holding.costPrice) * 100, 2) : undefined;
    const positionPercent = totalAsset > 0 ? round((marketValue / totalAsset) * 100, 2) : undefined;

    if (!info || price <= 0) {
      messages.push('暂无可用实时行情，无法完成持仓监控。');
      return buildHoldingMonitorItem(holding, name, 'watch', price, marketValue, earningPercent, positionPercent, messages);
    }

    if (positionPercent !== undefined && positionPercent > 20) {
      messages.push(`单票仓位 ${positionPercent}% 超过 20% 上限。`);
    } else if (positionPercent !== undefined && positionPercent > 10) {
      messages.push(`单票仓位 ${positionPercent}% 已超过新手 10% 建议线。`);
    }

    if (holding.stopLossPrice && price <= holding.stopLossPrice) {
      messages.push(`现价 ${price} 已跌破预设止损价 ${holding.stopLossPrice}。`);
    }
    if (earningPercent !== undefined && earningPercent <= -7) {
      messages.push(`持仓浮亏 ${earningPercent}% 已触发 -7% 硬止损线。`);
    } else if (earningPercent !== undefined && earningPercent <= -5) {
      messages.push(`持仓浮亏 ${earningPercent}% 已进入 -5% 止损观察区。`);
    }

    const holdingDays = countWeekdaysFrom(holding.buyDate);
    if (holdingDays !== undefined && holdingDays >= 5 && earningPercent !== undefined && earningPercent <= 0) {
      messages.push(`买入后已过 ${holdingDays} 个工作日且未盈利，触发时间止损观察。`);
    }

    if (!messages.length) {
      messages.push('当前未触发持仓纪律风险。');
    }

    const status = messages.some((msg) => /超过 20%|跌破预设止损价|触发 -7%|触发 -2%|触发 -10%/.test(msg))
      ? 'risk'
      : messages.some((msg) => /10% 建议线|止损观察|时间止损观察|暂无可用/.test(msg))
        ? 'watch'
        : 'ok';

    return buildHoldingMonitorItem(holding, name, status, price, marketValue, earningPercent, positionPercent, messages);
  });

  return {
    accountStatus: accountMessages.length ? 'risk' : 'ok',
    accountMessages: accountMessages.length ? accountMessages : ['账户层面未触发熔断。'],
    dayLossPercent,
    totalAsset: totalAsset > 0 ? round(totalAsset, 2) : undefined,
    holdings: items,
    updatedAt: formatDateTime(new Date()),
  };
}

export function notifyHoldingStrategyRisks(stockList: LeekTreeItem[]): void {
  const monitor = evaluateHoldingStrategy(stockList);
  const riskItems = monitor.holdings.filter((item) => item.status === 'risk');
  const accountRisk = monitor.accountStatus === 'risk' ? monitor.accountMessages : [];
  const messages = [
    ...accountRisk,
    ...riskItems.map((item) => `${item.name}：${item.messages.filter((msg) => !msg.includes('未触发')).join('；')}`),
  ].filter(Boolean);

  if (!messages.length) {
    return;
  }

  const key = messages.join('|');
  const lastNoticeAt = riskNoticeCache[key] || 0;
  if (Date.now() - lastNoticeAt < 30 * 60 * 1000) {
    return;
  }
  riskNoticeCache[key] = Date.now();

  window.showWarningMessage(`持仓策略风险：${messages[0]}`, '查看策略中心').then((res) => {
    if (res === '查看策略中心') {
      commands.executeCommand('leek-fund.stockWindVane');
    }
  });
}

export async function refreshRecommendedAStocks(
  stockList: LeekTreeItem[],
  trigger: 'manual' | 'schedule'
): Promise<RecommendationCache> {
  const candidates = getAStockCandidates(stockList);
  const market = await evaluateMarketTrend();
  const items: RecommendedAStock[] = [];

  if (market.pass) {
    for (const candidate of candidates) {
      const result = await evaluateStockCandidate(candidate);
      if (result) {
        items.push(result);
      }
    }
  }

  const cache: RecommendationCache = {
    updatedAt: formatDateTime(new Date()),
    trigger,
    universeSize: candidates.length,
    marketPass: market.pass,
    marketReason: market.reason,
    items: items.sort((a, b) => b.riskRewardRatio - a.riskRewardRatio),
  };
  await setStrategyState(RECOMMENDED_A_STOCKS_CONFIG_KEY, cache);
  return cache;
}

function getStrategyState<T>(key: string, defaultValue: T): T {
  return globalState.context?.globalState.get<T>(key, defaultValue) ?? defaultValue;
}

async function setStrategyState(key: string, value: unknown): Promise<void> {
  if (!globalState.context?.globalState) {
    throw new Error('扩展状态尚未初始化，无法保存策略中心数据。');
  }
  await globalState.context.globalState.update(key, value);
}

function buildHoldingMonitorItem(
  holding: HoldingStock,
  name: string,
  status: MonitorStatus,
  currentPrice: number,
  marketValue: number,
  earningPercent: number | undefined,
  positionPercent: number | undefined,
  messages: string[]
): HoldingMonitorItem {
  return {
    code: holding.code,
    name,
    status,
    currentPrice: currentPrice > 0 ? round(currentPrice, 3) : undefined,
    marketValue: marketValue > 0 ? round(marketValue, 2) : undefined,
    earningPercent,
    positionPercent,
    messages,
  };
}

function normalizeHolding(raw: any): HoldingStock | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const code = normalizeStockCode(raw.code);
  const costPrice = toPositiveNumber(raw.costPrice);
  const shares = toPositiveNumber(raw.shares);
  if (!code || !isAStockCode(code) || !costPrice || !shares) {
    return null;
  }

  return {
    code,
    name: typeof raw.name === 'string' ? raw.name.trim() : undefined,
    costPrice,
    shares,
    buyDate: typeof raw.buyDate === 'string' ? raw.buyDate.slice(0, 10) : undefined,
    stopLossPrice: toPositiveNumber(raw.stopLossPrice),
    targetPrice: toPositiveNumber(raw.targetPrice),
  };
}

function normalizeRecommendation(raw: any): RecommendedAStock | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const code = normalizeStockCode(raw.code);
  if (!code || !isAStockCode(code)) {
    return null;
  }

  return {
    code,
    name: typeof raw.name === 'string' ? raw.name : code,
    price: toNumber(raw.price),
    stopLossPrice: toNumber(raw.stopLossPrice),
    targetPrice: toNumber(raw.targetPrice),
    riskRewardRatio: toNumber(raw.riskRewardRatio),
    reasons: Array.isArray(raw.reasons) ? raw.reasons.map(String) : [],
    manualChecks: Array.isArray(raw.manualChecks) ? raw.manualChecks.map(String) : MANUAL_SELECTION_CHECKS,
  };
}

async function syncHoldingCodesToStockConfig(holdings: HoldingStock[]): Promise<void> {
  const current = LeekFundConfig.getConfig('leek-fund.stocks');
  const currentStocks = Array.isArray(current) ? current.filter((item) => typeof item === 'string') : [];
  const holdingCodes = holdings.map((item) => item.code);
  const nextStocks = uniq([...currentStocks, ...holdingCodes]) as string[];
  if (nextStocks.join(',') !== currentStocks.join(',')) {
    await LeekFundConfig.setConfig('leek-fund.stocks', nextStocks);
  }
}

function buildStockInfoMap(stockList: LeekTreeItem[]): Map<string, MarketItemInfo> {
  const result = new Map<string, MarketItemInfo>();
  stockList.forEach((item) => {
    const code = normalizeStockCode(item.info?.code);
    if (code) {
      result.set(code, item.info);
    }
  });
  return result;
}

function getAStockCandidates(stockList: LeekTreeItem[]): MarketItemInfo[] {
  return stockList
    .map((item) => item.info)
    .filter((info) => {
      const code = normalizeStockCode(info?.code);
      return code && isAStockCode(code) && !A_STOCK_INDEX_CODES.includes(code) && info?.type !== 'nodata';
    });
}

async function evaluateMarketTrend(): Promise<{ pass: boolean; reason: string }> {
  const klines = await getKlineData('sh000001', 'daily', 30);
  if (klines.length < 20) {
    return {
      pass: false,
      reason: '上证指数 20 日均线数据不足，本轮不生成推荐列表。',
    };
  }

  const latest = klines[klines.length - 1];
  const ma20 = movingAverage(klines, 20);
  const pass = ma20 !== null && latest.close >= ma20;
  return {
    pass,
    reason: pass
      ? `上证指数 ${latest.close} 位于 20 日均线 ${ma20} 之上。`
      : `上证指数 ${latest.close} 未站上 20 日均线 ${ma20}，按策略不推荐新标的。`,
  };
}

async function evaluateStockCandidate(info: MarketItemInfo): Promise<RecommendedAStock | null> {
  const code = normalizeStockCode(info.code);
  if (!code) {
    return null;
  }

  const klines = await getKlineData(code, 'daily', 260);
  if (klines.length < 250) {
    return null;
  }

  const indicators = calculateIndicators(klines);
  const latest = indicators[indicators.length - 1];
  const previous = indicators[indicators.length - 2];
  const ma5 = movingAverage(klines, 5);
  const ma10 = movingAverage(klines, 10);
  const ma20 = movingAverage(klines, 20);
  const ma120 = movingAverage(klines, 120);
  const ma250 = movingAverage(klines, 250);
  if (!ma5 || !ma10 || !ma20 || !ma120 || !ma250) {
    return null;
  }

  const currentPrice = toNumber(info.price) || latest.close;
  const trendPass = currentPrice > ma120 && currentPrice > ma250 && ma5 > ma10 && ma10 > ma20;
  const rightSidePass =
    currentPrice >= ma5 &&
    latest.macd.bar !== null &&
    latest.macd.bar > 0 &&
    (previous.macd.bar === null || latest.macd.bar >= previous.macd.bar);
  const activePass = hasActiveStockNature(klines);
  const stopLossPrice = calculateStopLossPrice(klines, currentPrice);
  const targetPrice = calculateTargetPrice(klines, currentPrice);
  const riskRewardRatio = stopLossPrice < currentPrice
    ? round((targetPrice - currentPrice) / (currentPrice - stopLossPrice), 2)
    : 0;

  if (!trendPass || !rightSidePass || !activePass || riskRewardRatio < 3) {
    return null;
  }

  return {
    code,
    name: info.name || code,
    price: round(currentPrice, 3),
    stopLossPrice,
    targetPrice,
    riskRewardRatio,
    reasons: [
      '大盘趋势条件通过',
      '个股站在 120/250 日均线之上',
      '5/10/20 日均线多头排列',
      '现价站稳 5 日均线且 MACD 红柱未走弱',
      '近 3 个月存在活跃股性信号',
      `按技术止损与阶段目标测算盈亏比 ${riskRewardRatio}:1`,
    ],
    manualChecks: MANUAL_SELECTION_CHECKS,
  };
}

function calculateStopLossPrice(klines: KlineData[], currentPrice: number): number {
  const recent20Low = Math.min(...klines.slice(-20).map((item) => item.low).filter((item) => item > 0));
  let stopLoss = Math.max(currentPrice * 0.93, recent20Low);
  if (!Number.isFinite(stopLoss) || stopLoss >= currentPrice) {
    stopLoss = currentPrice * 0.93;
  }
  return round(stopLoss, 3);
}

function calculateTargetPrice(klines: KlineData[], currentPrice: number): number {
  const recent120High = Math.max(...klines.slice(-120).map((item) => item.high).filter((item) => item > 0));
  if (!Number.isFinite(recent120High) || recent120High <= currentPrice) {
    return round(currentPrice, 3);
  }
  return round(recent120High, 3);
}

function hasActiveStockNature(klines: KlineData[]): boolean {
  const recent = klines.slice(-60);
  return recent.some((item, index) => {
    const previous = recent[index - 1];
    const intradayRise = item.open > 0 ? (item.close - item.open) / item.open : 0;
    const dayRise = previous?.close ? (item.close - previous.close) / previous.close : 0;
    return intradayRise >= 0.07 || dayRise >= 0.09;
  });
}

function movingAverage(klines: KlineData[], period: number): number | null {
  if (klines.length < period) {
    return null;
  }
  const recent = klines.slice(-period);
  return round(recent.reduce((sum, item) => sum + item.close, 0) / period, 3);
}

function countWeekdaysFrom(dateValue?: string): number | undefined {
  if (!dateValue) {
    return undefined;
  }
  const start = new Date(`${dateValue.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime())) {
    return undefined;
  }

  const end = new Date();
  let count = 0;
  const cursor = new Date(start.getTime());
  while (cursor < end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      count += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function emptyRecommendationCache(): RecommendationCache {
  return {
    updatedAt: '',
    trigger: 'schedule',
    universeSize: 0,
    marketPass: false,
    marketReason: '尚未执行策略选股。',
    items: [],
  };
}

function normalizeStockCode(code: unknown): string {
  if (typeof code !== 'string') {
    return '';
  }
  return code.trim().toLowerCase().replace(/^bj_/, 'bj');
}

function isAStockCode(code: string): boolean {
  return /^(sh|sz|bj)\d{6}$/.test(code);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').replace(/亿|万/g, '');
    const num = Number(normalized);
    return Number.isFinite(num) ? num : 0;
  }
  return 0;
}

function toPositiveNumber(value: unknown): number | undefined {
  const num = toNumber(value);
  return num > 0 ? num : undefined;
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const num = toNumber(value);
  return Number.isFinite(num) ? num : undefined;
}

function round(value: number, digits: number): number {
  const scale = Math.pow(10, digits);
  return Math.round(value * scale) / scale;
}
