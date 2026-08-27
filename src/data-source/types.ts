/**
 * 数据源层统一类型
 */

/** 统一行情结果 */
export interface QuoteResult {
  code: string
  name: string
  /** 当前价 */
  price: number
  /** 昨收 */
  yestclose: number
  /** 今开 */
  open: number
  /** 最高 */
  high: number
  /** 最低 */
  low: number
  /** 成交量（股） */
  volume: number
  /** 成交额（元） */
  amount: number
  /** 涨跌额 */
  updown: number
  /** 涨跌幅（如 2.35 表示 +2.35%，-1.20 表示 -1.20%） */
  percent: number
  /** 行情时间 */
  time: string
  /** 是否停牌 */
  isStop?: boolean
  /** 盘后价（仅美股） */
  afterPrice?: number
  /** 盘后涨跌幅（仅美股） */
  afterPercent?: number
}

/** 东方财富批量行情原始条目 */
export interface EastMoneyQuoteItem {
  code: string
  name: string
  price: number
  percent: number
  updown: number
  open: number
  yestclose: number
  high: number
  low: number
  volume: number
  amount: number
}

/** K 线数据点（与 technicalAnalysis 中的 KlineData 一致） */
export interface KlinePoint {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  amount?: number
}

/** 数据源标识 */
export type DataSource = 'eastmoney' | 'sina'
