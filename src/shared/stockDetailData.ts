import Axios from 'axios';
import { decode } from 'iconv-lite';
import { getKlineData, KlineData } from './technicalAnalysis';
import { randHeader } from './utils';

export interface MinutePoint {
  time: string;
  price: number;
  volume: number;
  percentChange?: number; // 涨跌幅百分比
}

export interface TradeDetail {
  time: string;
  price: number;
  volume: number;
  direction: 'up' | 'down' | 'flat';
}

export interface OrderBookLevel {
  level: number;
  price: number;
  volume: number;
}

export interface OrderBook {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
}

export interface StockDetailData {
  code: string;
  name: string;
  price: number;
  time: string;
  dailyKline: KlineData[];
  minuteLine: MinutePoint[];
  trades: TradeDetail[];
  orderBook: OrderBook;
}

export async function getAStockDetailData(code: string): Promise<StockDetailData> {
  const normalizedCode = normalizeAStockCode(code);
  const [dailyKline, minuteLine, quote] = await Promise.all([
    getKlineData(normalizedCode, 'daily', 100),
    getAStockMinuteLine(normalizedCode, 240),
    getAStockQuoteDetail(normalizedCode),
  ]);

  return {
    code: normalizedCode,
    name: quote.name,
    price: quote.price,
    time: quote.time,
    dailyKline,
    minuteLine,
    trades: buildTradeDetails(minuteLine),
    orderBook: quote.orderBook,
  };
}

export async function getAStockMinuteLine(code: string, count = 240): Promise<MinutePoint[]> {
  const normalizedCode = normalizeAStockCode(code);
  // 转换代码格式：sh600519 -> 1.600519
  const marketCode = normalizedCode.startsWith('sh')
    ? `1.${normalizedCode.slice(2)}`
    : `0.${normalizedCode.slice(2)}`;
  const url = 'http://push2his.eastmoney.com/api/qt/stock/kline/get';
  const resp = await Axios.get(url, {
    params: {
      secid: marketCode,
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58',
      klt: 1, // 1分钟K线
      fqt: 1,
      beg: 0,
      end: 20500101,
      smplmt: count,
      lmt: 1000000,
    },
    headers: {
      ...randHeader(),
      Referer: 'http://quote.eastmoney.com/',
    },
  });

  if (!resp.data?.data?.klines || !Array.isArray(resp.data.data.klines)) {
    return [];
  }

  const klines = resp.data.data.klines;
  if (!klines.length) {
    return [];
  }

  // 获取昨收价 - 从 API 响应中解析
  // 响应结构: { data: { qfq: { prevclose: number }, klines: [...] } } 或其他格式
  const dataObj = resp.data?.data || resp.data || {};
  const prevClose = dataObj.qfq?.prevclose || dataObj.data?.qfq?.prevclose || 0;

  // 解析东方财富API返回的分钟数据
  // 格式: "2026-06-29 09:31,开盘,收盘,最高,最低,成交量,成交额,涨跌额"
  const rawPoints = klines
    .map((item: string) => {
      const parts = item.split(',');
      if (parts.length < 6) return null;
      const dateTimePart = parts[0]; // "2026-06-29 09:31"
      const timePart = dateTimePart.split(' ')[1] || ''; // "09:31"
      const price = parseFloat(parts[2]) || 0; // 收盘价
      // 计算涨跌幅百分比 (parts[7] 是涨跌额，parts[2] 是当前价格)
      const changeAmount = parseFloat(parts[7]) || 0;
      const percentChange = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
      return {
        time: timePart,
        price,
        volume: parseInt(parts[5]) || 0, // 成交量
        percentChange,
      };
    })
    .filter((item: any) => item && item.time && item.price > 0);

  if (!rawPoints.length) {
    return [];
  }

  return rawPoints;
}

export async function getAStockQuoteDetail(code: string): Promise<{
  code: string;
  name: string;
  price: number;
  time: string;
  orderBook: OrderBook;
}> {
  const normalizedCode = normalizeAStockCode(code);
  const url = `https://hq.sinajs.cn/list=${normalizedCode}`;
  const resp = await Axios.get(url, {
    responseType: 'arraybuffer',
    transformResponse: [
      (data) => {
        return decode(data, 'GB18030');
      },
    ],
    headers: {
      ...randHeader(),
      Referer: 'https://finance.sina.com.cn/',
    },
  });

  const match = String(resp.data).match(/="(.*)";?/);
  if (!match) {
    throw new Error(`无法解析股票实时行情：${normalizedCode}`);
  }

  const fields = match[1].split(',');
  if (fields.length < 32 || !fields[0]) {
    throw new Error(`股票实时行情字段不完整：${normalizedCode}`);
  }

  return {
    code: normalizedCode,
    name: fields[0],
    price: parseFloat(fields[3]) || parseFloat(fields[2]) || 0,
    time: `${fields[30] || ''} ${fields[31] || ''}`.trim(),
    orderBook: {
      bids: [
        buildOrderBookLevel(1, fields[11], fields[10]),
        buildOrderBookLevel(2, fields[13], fields[12]),
        buildOrderBookLevel(3, fields[15], fields[14]),
        buildOrderBookLevel(4, fields[17], fields[16]),
        buildOrderBookLevel(5, fields[19], fields[18]),
      ],
      asks: [
        buildOrderBookLevel(1, fields[21], fields[20]),
        buildOrderBookLevel(2, fields[23], fields[22]),
        buildOrderBookLevel(3, fields[25], fields[24]),
        buildOrderBookLevel(4, fields[27], fields[26]),
        buildOrderBookLevel(5, fields[29], fields[28]),
      ],
    },
  };
}

function buildTradeDetails(minuteLine: MinutePoint[]): TradeDetail[] {
  return minuteLine
    .map((point, index) => {
      const prev = minuteLine[index - 1];
      const direction: TradeDetail['direction'] = !prev
        ? 'flat'
        : point.price > prev.price
        ? 'up'
        : point.price < prev.price
        ? 'down'
        : 'flat';
      return {
        time: point.time,
        price: point.price,
        volume: point.volume,
        direction,
      };
    })
    .slice(-30)
    .reverse();
}

function buildOrderBookLevel(level: number, price: string, volume: string): OrderBookLevel {
  return {
    level,
    price: parseFloat(price) || 0,
    volume: parseFloat(volume) || 0,
  };
}

function normalizeAStockCode(code: string): string {
  const normalized = String(code || '')
    .trim()
    .toLowerCase();
  if (!/^(sh|sz|bj)\d{6}$/.test(normalized)) {
    throw new Error(`仅支持 A 股股票详情：${code}`);
  }
  return normalized;
}
