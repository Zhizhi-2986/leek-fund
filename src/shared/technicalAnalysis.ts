/**
 * 技术分析服务
 * 提供 K 线数据获取和技术指标计算
 */

import Axios from 'axios';
import { decode } from 'iconv-lite';
import { randHeader } from './utils';

/** K 线数据周期 */
export type KlinePeriod = 'daily' | 'weekly' | 'monthly';

/** K 线数据项 */
export interface KlineData {
  date: string; // 日期
  open: number; // 开盘价
  close: number; // 收盘价
  high: number; // 最高价
  low: number; // 最低价
  volume: number; // 成交量
  amount?: number; // 成交额
}

/** 均线数据 */
export interface MAData {
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
}

/** RSI 数据 */
export interface RSIData {
  rsi6: number | null; // 短期 RSI
  rsi12: number | null; // 中期 RSI
  rsi24: number | null; // 长期 RSI
}

/** MACD 数据 */
export interface MACDData {
  dif: number | null; // DIF 快线
  dea: number | null; // DEA 慢线
  bar: number | null; // MACD 柱
}

/** 布林带数据 */
export interface BOLLData {
  upper: number | null; // 上轨
  middle: number | null; // 中轨（20日均线）
  lower: number | null; // 下轨
}

/** 技术指标综合数据 */
export interface TechnicalIndicators {
  ma: MAData;
  rsi: RSIData;
  macd: MACDData;
  boll: BOLLData;
}

/** K 线数据 + 技术指标 */
export interface KlineWithIndicators extends KlineData {
  ma: MAData;
  rsi: RSIData;
  macd: MACDData;
  boll: BOLLData;
}

/**
 * 获取股票历史 K 线数据
 * 使用新浪财经 API
 */
export async function getKlineData(
  code: string,
  period: KlinePeriod = 'daily',
  count: number = 100
): Promise<KlineData[]> {
  try {
    // 转换代码格式
    let SinaCode = code;
    if (code.startsWith('sh')) {
      SinaCode = `sh${code.slice(2)}`;
    } else if (code.startsWith('sz')) {
      SinaCode = `sz${code.slice(2)}`;
    } else if (code.startsWith('hk')) {
      // 港股使用不同的 API
      return getHKKlineData(code, period, count);
    }

    // 周期参数映射
    const periodMap: Record<KlinePeriod, string> = {
      daily: 'D',
      weekly: 'W',
      monthly: 'M',
    };

    const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData`;
    const params = {
      symbol: SinaCode,
      scale: getScaleByPeriod(period),
      ma: 'no',
      datalen: count,
    };

    const resp = await Axios.get(url, {
      params,
      headers: {
        ...randHeader(),
        Referer: 'https://finance.sina.com.cn/',
      },
    });

    const data = resp.data;
    if (!Array.isArray(data)) {
      return [];
    }

    return data.map((item: any) => ({
      date: item.day,
      open: parseFloat(item.open) || 0,
      close: parseFloat(item.close) || 0,
      high: parseFloat(item.high) || 0,
      low: parseFloat(item.low) || 0,
      volume: parseFloat(item.volume) || 0,
      amount: parseFloat(item.amount) || 0,
    }));
  } catch (error) {
    console.error('Failed to get K-line data:', error);
    return [];
  }
}

/**
 * 获取港股 K 线数据
 */
async function getHKKlineData(
  code: string,
  period: KlinePeriod,
  count: number
): Promise<KlineData[]> {
  try {
    // 港股代码格式转换
    const hkCode = code.replace('hk', '');

    const periodMap: Record<KlinePeriod, string> = {
      daily: 'day',
      weekly: 'week',
      monthly: 'month',
    };

    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get`;
    const params = {
      _var: 'kline_dayhfq',
      param: `hk${hkCode},${periodMap[period]},,,,${count},qfq`,
    };

    const resp = await Axios.get(url, {
      params,
      headers: {
        ...randHeader(),
        Referer: 'https://gu.qq.com/',
      },
    });

    const text = resp.data as string;
    // 解析 JSONP 响应
    const jsonMatch = text.match(/=\s*(\{[\s\S]+\})/);
    if (!jsonMatch) {
      return [];
    }

    const data = JSON.parse(jsonMatch[1]);
    const items = data.data?.[`hk${hkCode}`]?.[periodMap[period]] || [];

    return items.map((item: any[]) => ({
      date: item[0],
      open: parseFloat(item[1]) || 0,
      close: parseFloat(item[2]) || 0,
      high: parseFloat(item[3]) || 0,
      low: parseFloat(item[4]) || 0,
      volume: parseFloat(item[5]) || 0,
    }));
  } catch (error) {
    console.error('Failed to get HK K-line data:', error);
    return [];
  }
}

/**
 * 根据周期获取数据粒度
 */
function getScaleByPeriod(period: KlinePeriod): number {
  const scaleMap: Record<KlinePeriod, number> = {
    daily: 240, // 日K
    weekly: 1200, // 周K（约等于月）
    monthly: 2400, // 月K
  };
  return scaleMap[period];
}

/**
 * 计算简单移动平均线 (SMA)
 * @param data 收盘价数组
 * @param period 周期
 * @returns 均线值数组（前面会有 null 填充）
 */
export function calculateSMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[i - j];
      }
      result.push(+(sum / period).toFixed(3));
    }
  }

  return result;
}

/**
 * 计算指数移动平均线 (EMA)
 * @param data 收盘价数组
 * @param period 周期
 * @returns EMA 值数组
 */
export function calculateEMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const multiplier = 2 / (period + 1);

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      result.push(null);
    } else if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      // 第一个 EMA 是前 N 个数的 SMA
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[j];
      }
      result.push(+(sum / period).toFixed(3));
    } else {
      // EMA = (收盘价 - 前一日 EMA) * 倍数 + 前一日 EMA
      const ema = (data[i] - (result[i - 1] as number)) * multiplier + (result[i - 1] as number);
      result.push(+ema.toFixed(3));
    }
  }

  return result;
}

/**
 * 计算 RSI (相对强弱指标)
 * @param data 收盘价数组
 * @param period 周期（默认14）
 * @returns RSI 值数组
 */
export function calculateRSI(data: number[], period: number = 14): (number | null)[] {
  const result: (number | null)[] = [];

  if (data.length < period + 1) {
    return data.map(() => null);
  }

  // 计算每日变化
  const changes: number[] = [];
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i] - data[i - 1]);
  }

  // 初始化
  for (let i = 0; i < period; i++) {
    result.push(null);
  }

  // 计算第一个 RSI
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) {
      avgGain += changes[i];
    } else {
      avgLoss += Math.abs(changes[i]);
    }
  }
  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) {
    result.push(100);
  } else {
    const rs = avgGain / avgLoss;
    result.push(+(100 - 100 / (1 + rs)).toFixed(2));
  }

  // 平滑计算后续 RSI
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;

    if (avgLoss === 0) {
      result.push(100);
    } else {
      const rs = avgGain / avgLoss;
      result.push(+(100 - 100 / (1 + rs)).toFixed(2));
    }
  }

  return result;
}

/**
 * 计算 MACD
 * @param data 收盘价数组
 * @param fastPeriod 快线周期（默认12）
 * @param slowPeriod 慢线周期（默认26）
 * @param signalPeriod 信号线周期（默认9）
 * @returns MACD 数据
 */
export function calculateMACD(
  data: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { dif: (number | null)[]; dea: (number | null)[]; bar: (number | null)[] } {
  // 计算快线和慢线的 EMA
  const emaFast = calculateEMA(data, fastPeriod);
  const emaSlow = calculateEMA(data, slowPeriod);

  // 计算 DIF = 快线 EMA - 慢线 EMA
  const dif: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (emaFast[i] === null || emaSlow[i] === null) {
      dif.push(null);
    } else {
      dif.push(+(emaFast[i]! - emaSlow[i]!).toFixed(3));
    }
  }

  // 计算 DEA（信号线）= DIF 的 EMA
  const difValues = dif.map((v) => v ?? 0);
  const deaSmooth = calculateEMA(difValues, signalPeriod);

  // 计算 MACD 柱 = (DIF - DEA) * 2
  const bar: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (dif[i] === null || deaSmooth[i] === null) {
      bar.push(null);
    } else {
      bar.push(+((dif[i]! - deaSmooth[i]!) * 2).toFixed(3));
    }
  }

  return {
    dif,
    dea: deaSmooth,
    bar,
  };
}

/**
 * 计算布林带
 * @param data 收盘价数组
 * @param period 周期（默认20）
 * @param stdDev 标准差倍数（默认2）
 * @returns 布林带数据
 */
export function calculateBOLL(
  data: number[],
  period: number = 20,
  stdDev: number = 2
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const middle = calculateSMA(data, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < data.length; i++) {
    if (middle[i] === null) {
      upper.push(null);
      lower.push(null);
    } else {
      // 计算标准差
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += Math.pow(data[i - j] - middle[i]!, 2);
      }
      const std = Math.sqrt(sum / period);

      upper.push(+(middle[i]! + stdDev * std).toFixed(3));
      lower.push(+(middle[i]! - stdDev * std).toFixed(3));
    }
  }

  return { upper, middle, lower };
}

/**
 * 计算 K 线数据的技术指标
 */
export function calculateIndicators(klines: KlineData[]): KlineWithIndicators[] {
  if (klines.length === 0) {
    return [];
  }

  const closes = klines.map((k) => k.close);

  // 计算各种指标
  const maData = {
    ma5: calculateSMA(closes, 5),
    ma10: calculateSMA(closes, 10),
    ma20: calculateSMA(closes, 20),
    ma60: calculateSMA(closes, 60),
  };

  const rsi6 = calculateRSI(closes, 6);
  const rsi12 = calculateRSI(closes, 12);
  const rsi24 = calculateRSI(closes, 24);

  const macd = calculateMACD(closes);
  const boll = calculateBOLL(closes);

  // 组合数据
  return klines.map((kline, index) => ({
    ...kline,
    ma: {
      ma5: maData.ma5[index],
      ma10: maData.ma10[index],
      ma20: maData.ma20[index],
      ma60: maData.ma60[index],
    },
    rsi: {
      rsi6: rsi6[index],
      rsi12: rsi12[index],
      rsi24: rsi24[index],
    },
    macd: {
      dif: macd.dif[index],
      dea: macd.dea[index],
      bar: macd.bar[index],
    },
    boll: {
      upper: boll.upper[index],
      middle: boll.middle[index],
      lower: boll.lower[index],
    },
  }));
}

/**
 * 获取完整的技术分析数据（K线 + 指标）
 */
export async function getTechnicalAnalysisData(
  code: string,
  period: KlinePeriod = 'daily',
  count: number = 100
): Promise<KlineWithIndicators[]> {
  const klines = await getKlineData(code, period, count);
  return calculateIndicators(klines);
}

/**
 * 获取实时技术指标（基于当前数据计算简化指标）
 */
export function getRealtimeIndicators(
  currentData: {
    open: string | number;
    high: string | number;
    low: string | number;
    close: string | number;
    price: string | number;
    volume: string | number;
    yestclose: string | number;
  },
  historyCloses: number[] = []
): TechnicalIndicators {
  const currentClose = parseFloat(String(currentData.price || currentData.close)) || 0;
  const prevClose = parseFloat(String(currentData.yestclose)) || currentClose;

  // 如果历史数据不足，返回简化指标
  if (historyCloses.length < 5) {
    return {
      ma: { ma5: null, ma10: null, ma20: null, ma60: null },
      rsi: { rsi6: null, rsi12: null, rsi24: null },
      macd: { dif: null, dea: null, bar: null },
      boll: { upper: null, middle: null, lower: null },
    };
  }

  // 加入当前价格到历史数据
  const allCloses = [...historyCloses, currentClose];

  // 计算均线
  const ma5 =
    allCloses.length >= 5
      ? +(allCloses.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, allCloses.length)).toFixed(2)
      : null;
  const ma10 =
    allCloses.length >= 10
      ? +(allCloses.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, allCloses.length)).toFixed(2)
      : null;
  const ma20 =
    allCloses.length >= 20
      ? +(allCloses.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, allCloses.length)).toFixed(2)
      : null;
  const ma60 =
    allCloses.length >= 60
      ? +(allCloses.slice(-60).reduce((a, b) => a + b, 0) / Math.min(60, allCloses.length)).toFixed(2)
      : null;

  // 计算 RSI
  const rsiValues = calculateRSI(allCloses, 14);
  const latestRSI = rsiValues[rsiValues.length - 1];

  return {
    ma: { ma5, ma10, ma20, ma60 },
    rsi: { rsi6: latestRSI, rsi12: latestRSI, rsi24: latestRSI },
    macd: { dif: null, dea: null, bar: null },
    boll: { upper: null, middle: ma20, lower: null },
  };
}
