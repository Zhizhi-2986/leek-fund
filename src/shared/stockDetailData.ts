import Axios from 'axios';
import { decode } from 'iconv-lite';
import { getKlineData, KlineData, calculateSMA } from './technicalAnalysis';
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
  yestclose: number;
  high: number;
  low: number;
  time: string;
  dailyKline: KlineData[];
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  minuteLine: MinutePoint[];
  trades: TradeDetail[];
  orderBook: OrderBook;
  /** 涨停价 */
  limitUp: number;
  /** 跌停价 */
  limitDown: number;
  /** 流通市值（元） */
  circulatingMarketCap: number;
  /** 量比 */
  volumeRatio: number;
  /** 均价（VWAP，从分时数据计算） */
  avgPrice: number;
}

/** 大盘实时概览数据 */
export interface MarketOverview {
  /** 上涨家数 */
  upCount: number;
  /** 下跌家数 */
  downCount: number;
  /** 平盘家数 */
  flatCount: number;
  /** 沪市成交额（元） */
  shAmount: number;
  /** 深市成交额（元） */
  szAmount: number;
  /** 总成交额（元） */
  totalAmount: number;
  /** 预计收盘总成交额（元） */
  estimatedCloseAmount: number;
  /** 更新时间 */
  time: string;
}

export async function getAStockDetailData(code: string): Promise<StockDetailData> {
  const normalizedCode = normalizeAStockCode(code);
  const [dailyKline, minuteLine, quote, emExtra] = await Promise.all([
    getKlineData(normalizedCode, 'daily', 100),
    getAStockMinuteLine(normalizedCode, 240),
    getAStockQuoteDetail(normalizedCode),
    getAStockExtraQuotes(normalizedCode),
  ]);

  // 计算均线
  const closes = dailyKline.map((k) => k.close);
  const ma5Arr = calculateSMA(closes, 5);
  const ma10Arr = calculateSMA(closes, 10);
  const ma20Arr = calculateSMA(closes, 20);
  const ma5 = ma5Arr.length > 0 ? ma5Arr[ma5Arr.length - 1] : null;
  const ma10 = ma10Arr.length > 0 ? ma10Arr[ma10Arr.length - 1] : null;
  const ma20 = ma20Arr.length > 0 ? ma20Arr[ma20Arr.length - 1] : null;

  // 计算均价（VWAP）：总成交额 / 总成交量
  let avgPrice = 0;
  const validPoints = minuteLine.filter((p) => p.price > 0 && p.volume > 0);
  if (validPoints.length > 0) {
    const totalTurnover = validPoints.reduce((sum, p) => sum + p.price * p.volume, 0);
    const totalVolume = validPoints.reduce((sum, p) => sum + p.volume, 0);
    avgPrice = totalVolume > 0 ? totalTurnover / totalVolume : quote.price;
  } else {
    avgPrice = quote.price;
  }

  return {
    code: normalizedCode,
    name: quote.name,
    price: quote.price,
    yestclose: quote.yestclose,
    high: quote.high,
    low: quote.low,
    time: quote.time,
    dailyKline,
    ma5,
    ma10,
    ma20,
    minuteLine,
    trades: buildTradeDetails(minuteLine),
    orderBook: quote.orderBook,
    limitUp: emExtra.limitUp,
    limitDown: emExtra.limitDown,
    circulatingMarketCap: emExtra.circulatingMarketCap,
    volumeRatio: emExtra.volumeRatio,
    avgPrice,
  };
}

export async function getAStockMinuteLine(code: string, count = 240): Promise<MinutePoint[]> {
  const normalizedCode = normalizeAStockCode(code);
  // 转换代码格式，适配东方财富 secid 参数
  // 沪市（sh）：1.{6位代码}；深市（sz/创业板等）：0.{6位代码}
  // 指数与个股共用同一规则：sh000001 -> 1.000001，sz399001 -> 0.399001
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

  // 获取昨收价 - 优先从 API 响应中解析
  // 对个股，东方财富返回 qfq.prevclose；指数可能不返回此字段
  const dataObj = resp.data?.data || resp.data || {};
  let prevClose = dataObj.qfq?.prevclose || dataObj.data?.qfq?.prevclose || 0;

  // 如果东方财富没返回昨收，尝试从第一根 K 线数据推算：
  // 第一根 K 线是开盘第一分钟，parts[7] 是涨跌额，parts[2] 是收盘价
  if (prevClose <= 0 && klines.length > 0) {
    const firstParts = klines[0].split(',');
    if (firstParts.length >= 8) {
      const firstPrice = parseFloat(firstParts[2]) || 0;
      const firstChange = parseFloat(firstParts[7]) || 0;
      prevClose = firstPrice - firstChange;
    }
  }

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
  yestclose: number;
  high: number;
  low: number;
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
  if (fields.length < 3 || !fields[0]) {
    throw new Error(`股票实时行情字段不完整：${normalizedCode}`);
  }

  // 判断是否为指数（前 6 位为 000/001/002/003/399/688 等指数代码）
  const isIndex = /^(sh|sz)000\d{3}$/.test(normalizedCode) ||
                  /^(sh|sz)001\d{3}$/.test(normalizedCode) ||
                  /^(sh|sz)002\d{3}$/.test(normalizedCode) ||
                  /^(sh|sz)003\d{3}$/.test(normalizedCode) ||
                  /^(sh|sz)399\d{3}$/.test(normalizedCode) ||
                  /^sh000688$/.test(normalizedCode);

  // 新浪指数行情：fields[1]=今开, fields[2]=昨收, fields[3]=现价
  // 新浪个股行情：fields[1]=今开, fields[2]=昨收, fields[3]=现价（相同）
  // 但指数字段数较少，没有买卖五档
  const name = fields[0];
  const yestclose = parseFloat(fields[2]) || 0;
  const price = parseFloat(fields[3]) || parseFloat(fields[1]) || 0;
  const high = parseFloat(fields[4]) || 0;
  const low = parseFloat(fields[5]) || 0;
  const time = isIndex
    ? `${fields[29] || ''} ${fields[30] || ''}`.trim()
    : `${fields[30] || ''} ${fields[31] || ''}`.trim();

  return {
    code: normalizedCode,
    name,
    price,
    yestclose,
    high,
    low,
    time,
    orderBook: isIndex
      ? { asks: [], bids: [] }
      : fields.length >= 32
        ? {
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
          }
        : { asks: [], bids: [] },
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

// ── 东方财富个股补充行情 ──────────────────────────────────────────────────

/**
 * 从东方财富获取流通市值、量比、涨停价、跌停价
 */
async function getAStockExtraQuotes(code: string): Promise<{
  limitUp: number;
  limitDown: number;
  circulatingMarketCap: number;
  volumeRatio: number;
}> {
  const defaultResult = { limitUp: 0, limitDown: 0, circulatingMarketCap: 0, volumeRatio: 0 };
  try {
    const marketCode = code.startsWith('sh')
      ? `1.${code.slice(2)}`
      : `0.${code.slice(2)}`;
    const url = 'https://push2.eastmoney.com/api/qt/stock/get';
    const resp = await Axios.get(url, {
      params: {
        secid: marketCode,
        fields: 'f41,f42,f20,f21,f37,f10',
        invt: 2,
        fltt: 2,
      },
      headers: { ...randHeader(), Referer: 'http://quote.eastmoney.com/' },
    });
    const data = resp.data?.data;
    if (!data) return defaultResult;

    return {
      limitUp: data.f41 ?? 0,
      limitDown: data.f42 ?? 0,
      circulatingMarketCap: data.f21 ?? data.f20 ?? 0,
      volumeRatio: data.f10 ?? 0,
    };
  } catch {
    return defaultResult;
  }
}

// ── 大盘实时概览 ─────────────────────────────────────────────────────────

/**
 * 获取大盘实时涨跌家数、量能数据
 */
export async function getMarketOverview(): Promise<MarketOverview> {
  const defaults: MarketOverview = {
    upCount: 0,
    downCount: 0,
    flatCount: 0,
    shAmount: 0,
    szAmount: 0,
    totalAmount: 0,
    estimatedCloseAmount: 0,
    time: '',
  };

  try {
    // 批量获取上证指数与深证成指行情（含成交额）
    const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
    const resp = await Axios.get(url, {
      params: {
        fltt: 2,
        invt: 2,
        fields: 'f2,f3,f4,f5,f6,f12,f14,f62,f64,f65,f66,f170,f169',
        secids: '1.000001,0.399001',
      },
      headers: { ...randHeader(), Referer: 'http://quote.eastmoney.com/' },
    });

    const list = resp.data?.data?.diff || resp.data?.data?.list || [];
    if (!Array.isArray(list)) return defaults;

    let shAmount = 0;
    let szAmount = 0;
    let totalUp = 0;
    let totalDown = 0;
    let totalFlat = 0;
    let timeStr = '';

    for (const item of list) {
      const code = String(item.f12 || '').toLowerCase();
      const amount = item.f6 ?? 0;
      if (code === 'sh000001' || code === '1.000001') {
        shAmount = amount;
        // f170=上涨家数, f169=下跌家数, f62/f64/f65/f66 可能包含相关统计
        totalUp += item.f170 ?? 0;
        totalDown += item.f169 ?? 0;
        totalFlat += item.f164 ?? 0;
      }
      if (code === 'sz399001' || code === '0.399001') {
        szAmount = amount;
        totalUp += item.f170 ?? 0;
        totalDown += item.f169 ?? 0;
        totalFlat += item.f164 ?? 0;
      }
    }

    const totalAmount = shAmount + szAmount;

    // 计算预计收盘量能
    const now = new Date();
    const tradingMinutes = getElapsedTradingMinutes(now);
    const totalTradingMinutes = 240; // 9:30-11:30 (120min) + 13:00-15:00 (120min)
    const estimatedCloseAmount =
      tradingMinutes > 0
        ? totalAmount * (totalTradingMinutes / tradingMinutes)
        : totalAmount;

    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');

    return {
      upCount: totalUp,
      downCount: totalDown,
      flatCount: totalFlat,
      shAmount,
      szAmount,
      totalAmount,
      estimatedCloseAmount,
      time: `${hh}:${mm}:${ss}`,
    };
  } catch {
    return defaults;
  }
}

/**
 * 计算当日已过去的交易分钟数（A 股：9:30-11:30, 13:00-15:00）
 */
function getElapsedTradingMinutes(now: Date): number {
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const totalMinutes = hours * 60 + minutes;
  const open1 = 9 * 60 + 30;  // 9:30
  const close1 = 11 * 60 + 30; // 11:30
  const open2 = 13 * 60;       // 13:00
  const close2 = 15 * 60;      // 15:00

  if (totalMinutes < open1 || totalMinutes >= close2) {
    // 盘前或盘后
    return totalMinutes < open1 ? 0 : 240;
  }
  if (totalMinutes <= close1) {
    return totalMinutes - open1;
  }
  if (totalMinutes < open2) {
    return close1 - open1; // 午间休市
  }
  return (close1 - open1) + (totalMinutes - open2);
}

function normalizeAStockCode(code: string): string {
  const normalized = String(code || '')
    .trim()
    .toLowerCase();
  if (!/^(sh|sz|bj)\d{6}$/.test(normalized)) {
    throw new Error(`仅支持 A 股股票代码：${code}（格式示例：sh600519 / sh000001）`);
  }
  return normalized;
}
