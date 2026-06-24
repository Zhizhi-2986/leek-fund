// 支持的股票类型
export const STOCK_TYPE = ['sh', 'sz', 'bj', 'hk', 'gb', 'us'];

export enum SortType {
  NORMAL = 0, // 默认顺序
  ASC = 1, // 涨跌升序
  DESC = -1, // 涨跌降序
}

export enum IconType {
  ARROW = 'arrow',
  ARROW1 = 'arrow1',
  NONE = 'none',
}

/** 提醒类型枚举 */
export enum RemindType {
  PRICE_ABOVE = 'price1', // 价格上涨到
  PRICE_BELOW = 'price0', // 价格下跌到
  PERCENT_RISE = 'percent1', // 日涨幅达
  PERCENT_FALL = 'percent0', // 日跌幅达
  VOLUME_RATIO = 'volume_ratio', // 成交量放大倍数
  PRICE_CHANGE = 'price_change', // 价格变动超过N元
  HIGH_BREAK = 'high_break', // 价格突破日内高点
  LOW_BREAK = 'low_break', // 价格跌破日内低点
}

/** 提醒条件配置 */
export interface StockRemindCondition {
  // 现有字段
  price1?: number; // 价格上涨到
  price0?: number; // 价格下跌到
  percent1?: number; // 日涨幅达（如 5 表示涨 5%）
  percent0?: number; // 日跌幅达（如 -5 表示跌 5%）

  // 新增字段
  volume_ratio?: number; // 成交量放大倍数（如 1.5 表示成交量是昨日的1.5倍）
  price_change?: number; // 价格变动超过N元（如 1.0 表示变动超过1元）
  high_break?: boolean; // 价格突破日内高点时提醒
  low_break?: boolean; // 价格跌破日内低点时提醒
}

/** 个股提醒配置（单个股票的完整提醒配置） */
export type StockRemindConfig = Partial<Record<string, StockRemindCondition>>;

/** Tree Item Type */
export enum TreeItemType {
  /** 股票 */
  STOCK = 'stock',
  /** 币安 */
  BINANCE = 'binance',
  /** 外汇 */
  FOREX = 'forex',
}
export interface IAmount {
  name: string;
  price: number | string;
  amount: number;
  shares?: number; // 持仓份额，新增字段
  priceDate: string;
  earnings: number;
  unitPrice: number;
  earningPercent: number;
  yestEarnings?: number;
}

export interface MarketItemInfo {
  percent: any;
  yestpercent?: string; // 净值涨跌幅度
  name: string;
  code: string;
  showLabel?: boolean;
  id?: string;
  contextValue?: string;
  symbol?: string;
  type?: string;
  yestclose?: string | number; // 昨日净值
  open?: string | number;
  highStop?: string | number;
  high?: string | number;
  lowStop?: string | number;
  low?: string | number;
  time?: string;
  updown?: string; // 涨跌值 price-yestclose
  priceDate?: string; // 价格日期
  yestPriceDate?: string; // 最新净值更新日期
  price?: string; // 当前价格
  volume?: string; // 成交量
  amount?: string | number; // 成交额
  afterPrice?: string; // 盘后价格
  afterPercent?: string; // 盘后涨跌幅
  isStop?: boolean; // 停牌
  t2?: boolean;
  isUpdated?: boolean;
  isStock?: boolean;
  _itemType?: TreeItemType;
  spotBuyPrice?: number; // 现汇买入价
  cashBuyPrice?: number; // 现钞买入价
  spotSellPrice?: number; // 现汇卖出价
  cashSellPrice?: number; // 现钞卖出价
  conversionPrice?: number; // 中行折算价
  publishDateTime?: string; // 发布日期：年月日 时分秒
  publishTime?: string; // 发布时间：时分秒
}

export const defaultMarketInfo: MarketItemInfo = {
  id: '',
  name: '',
  percent: '',
  code: '',
  showLabel: true,
};

export enum StockCategory {
  A = 'A Stock',
  US = 'US Stock',
  HK = 'HK Stock',
  NODATA = 'Not Support Stock',
}

export interface StockGroupConfig {
  id: string;
  name: string;
  category: StockCategory.A | StockCategory.HK | StockCategory.US;
  stockCodes: string[];
}

export type ForexData = {
  name: string;
  filter: ((code: string) => boolean) | RegExp;
  spotBuyPrice?: number; // 现汇买入价
  cashBuyPrice?: number; // 现钞买入价
  spotSellPrice?: number; // 现汇卖出价
  cashSellPrice?: number; // 现钞卖出价
  conversionPrice?: number; // 中行折算价
  publishDateTime?: string; // 发布日期：年月日 时分秒
  publishTime?: string; // 发布时间：时分秒
};

// 个股 AI 分析历史长度（A 股 / 港股）- 枚举与工具
export type AiStockHistoryRange = '1y' | '6m' | '3m' | '1m' | '1w';

export const AI_HISTORY_RANGE_LABEL: Record<AiStockHistoryRange, string> = {
  '1y': '1年',
  '6m': '6个月',
  '3m': '3个月',
  '1m': '1个月',
  '1w': '1周',
};

export function getAiHistoryRangeLabel(range: string): string {
  const key = range as AiStockHistoryRange;
  return AI_HISTORY_RANGE_LABEL[key] || AI_HISTORY_RANGE_LABEL['3m'];
}

export const AI_HISTORY_RANGE_OPTIONS: Array<{ value: AiStockHistoryRange; label: string }> = [
  { value: '1y', label: AI_HISTORY_RANGE_LABEL['1y'] },
  { value: '6m', label: AI_HISTORY_RANGE_LABEL['6m'] },
  { value: '3m', label: AI_HISTORY_RANGE_LABEL['3m'] },
  { value: '1m', label: AI_HISTORY_RANGE_LABEL['1m'] },
  { value: '1w', label: AI_HISTORY_RANGE_LABEL['1w'] },
];
