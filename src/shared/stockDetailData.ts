import Axios from 'axios';
import { decode } from 'iconv-lite';
import { getKlineData, KlineData } from './technicalAnalysis';
import { randHeader } from './utils';

export interface MinutePoint {
  time: string;
  price: number;
  volume: number;
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
  const url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData';
  const resp = await Axios.get(url, {
    params: {
      symbol: normalizedCode,
      scale: 1,
      ma: 'no',
      datalen: count,
    },
    headers: {
      ...randHeader(),
      Referer: 'https://finance.sina.com.cn/',
    },
  });

  if (!Array.isArray(resp.data)) {
    return [];
  }

  const rawPoints = resp.data
    .map((item: any) => {
      const rawDate = String(item.day || item.date || item.time || '');
      const datePart = rawDate.slice(0, 10);
      const timePart = rawDate.length >= 16 ? rawDate.slice(11, 16) : rawDate.slice(-5);
      return {
        date: datePart,
        time: timePart,
        price: parseFloat(item.close || item.price || '0') || 0,
        volume: parseFloat(item.volume || '0') || 0,
      };
    })
    .filter((item: any) => item.time && item.price > 0);

  if (!rawPoints.length) {
    return [];
  }

  const latestDate = rawPoints[rawPoints.length - 1].date;
  return rawPoints
    .filter((item: any) => item.date === latestDate)
    .map((item: any) => ({
      time: item.time,
      price: item.price,
      volume: item.volume,
    }));
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
  const normalized = String(code || '').trim().toLowerCase();
  if (!/^(sh|sz|bj)\d{6}$/.test(normalized)) {
    throw new Error(`仅支持 A 股股票详情：${code}`);
  }
  return normalized;
}
