import { window } from 'vscode';
import momentTz = require('moment-timezone');
import StockService from '../explorer/stockService';
import { LeekFundConfig } from './leekConfig';
import { notifyHoldingStrategyRisks, refreshRecommendedAStocks } from './tradingStrategy';
import { SortType } from './typed';

let recommendationTimer: NodeJS.Timeout | null = null;
let holdingMonitorTimer: NodeJS.Timeout | null = null;

export function startStrategyScheduler(stockService: StockService): void {
  stopStrategyScheduler();
  scheduleNextRecommendation(stockService);
  holdingMonitorTimer = setInterval(() => {
    notifyHoldingStrategyRisks(stockService.stockList || []);
  }, 60 * 1000);
}

export function stopStrategyScheduler(): void {
  if (recommendationTimer) {
    clearTimeout(recommendationTimer);
    recommendationTimer = null;
  }
  if (holdingMonitorTimer) {
    clearInterval(holdingMonitorTimer);
    holdingMonitorTimer = null;
  }
}

async function runScheduledRecommendation(stockService: StockService): Promise<void> {
  try {
    await ensureStockSnapshot(stockService);
    const cache = await refreshRecommendedAStocks(stockService.stockList || [], 'schedule');
    window.showInformationMessage(
      `策略选股已更新：${cache.items.length} 只候选，范围 ${cache.universeSize} 只 A 股。`
    );
  } catch (err) {
    console.error('Strategy recommendation schedule failed:', err);
    window.showWarningMessage(`策略选股执行失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

async function ensureStockSnapshot(stockService: StockService): Promise<void> {
  if (stockService.stockList && stockService.stockList.length) {
    return;
  }

  const codes = LeekFundConfig.getConfig('leek-fund.stocks');
  if (!Array.isArray(codes) || !codes.length) {
    return;
  }
  await stockService.getData(codes, SortType.NORMAL);
}

function scheduleNextRecommendation(stockService: StockService): void {
  const delay = getNextRecommendationDelay();
  recommendationTimer = setTimeout(() => {
    runScheduledRecommendation(stockService).finally(() => {
      scheduleNextRecommendation(stockService);
    });
  }, delay);
}

function getNextRecommendationDelay(): number {
  const now = momentTz().tz('Asia/Shanghai');
  const slots = [
    now.clone().hour(10).minute(0).second(0).millisecond(0),
    now.clone().hour(15).minute(0).second(0).millisecond(0),
  ];
  const nextToday = slots.find((slot) => slot.isAfter(now));
  const next = nextToday || now.clone().add(1, 'day').hour(10).minute(0).second(0).millisecond(0);
  return Math.max(next.diff(now), 1000);
}
