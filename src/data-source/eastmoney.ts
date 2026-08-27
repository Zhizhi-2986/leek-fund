/**
 * 东方财富数据源
 * 提供 A 股（含指数、ETF）的实时行情、K 线、搜索
 */
import Axios from 'axios';
import { randHeader } from '../shared/utils';
import type { QuoteResult, KlinePoint } from './types';

const BATCH_QUOTE_URL = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
const KLINE_URL = 'http://push2his.eastmoney.com/api/qt/stock/kline/get';

/** 东方财富行情响应中的单条数据 */
interface EMQuoteItem {
  f2?: number  // 最新价
  f3?: number  // 涨跌幅%
  f4?: number  // 涨跌额
  f12?: string // 代码
  f14?: string // 名称
  f15?: number // 最高
  f16?: number // 最低
  f17?: number // 今开
  f18?: number // 昨收
  f5?: number  // 成交量
  f6?: number  // 成交额
}

/**
 * 构建东方财富 secid
 * sh600519 → 1.600519, sz000001 → 0.000001, sh000001 → 1.000001
 */
export function toSecid(code: string): string | null {
  if (/^sh\d{6}$/.test(code)) return `1.${code.slice(2)}`;
  if (/^sz\d{6}$/.test(code)) return `0.${code.slice(2)}`;
  if (/^bj\d{6}$/.test(code)) return `0.${code.slice(2)}`;
  return null; // 全球指数不支持
}

/**
 * 批量获取 A 股/指数实时行情
 * 返回 code → QuoteResult 的 Map
 */
export async function fetchEastMoneyQuotes(codes: string[]): Promise<Map<string, QuoteResult>> {
  const result = new Map<string, QuoteResult>();
  if (!codes.length) return result;

  // 过滤并转换 secid
  const validCodes = codes.filter((c) => toSecid(c) !== null);
  if (!validCodes.length) return result;

  const secids = validCodes.map((c) => toSecid(c)!).join(',');

  try {
    const resp = await Axios.get(BATCH_QUOTE_URL, {
      params: {
        fltt: 2,
        invt: 2,
        fields: 'f2,f3,f4,f12,f14,f15,f16,f17,f18,f5,f6',
        secids,
      },
      headers: { ...randHeader(), Referer: 'http://quote.eastmoney.com/' },
    });

    const list = resp.data?.data?.diff || resp.data?.data?.list || [];
    if (!Array.isArray(list)) return result;

    for (const item of list) {
      const em = item as EMQuoteItem;
      const code = String(em.f12 || '').toLowerCase();
      if (!code) continue;

      const price = em.f2 ?? 0;
      const yestclose = em.f18 ?? 0;
      const updown = em.f4 ?? (price - yestclose);

      result.set(code, {
        code,
        name: em.f14 || '',
        price,
        yestclose,
        open: em.f17 ?? 0,
        high: em.f15 ?? 0,
        low: em.f16 ?? 0,
        volume: em.f5 ?? 0,
        amount: em.f6 ?? 0,
        time: '', // 批量接口不返回时间
        updown,
        percent: em.f3 ?? (yestclose > 0 ? (updown / yestclose) * 100 : 0),
      });
    }
  } catch (err) {
    console.error('EastMoney quote fetch failed:', err);
  }

  return result;
}

/**
 * 获取 K 线数据（日/周/月）
 * @param code A 股代码（sh600519）
 * @param period daily | weekly | monthly
 * @param count 条数
 */
export async function fetchEastMoneyKline(
  code: string,
  period: 'daily' | 'weekly' | 'monthly' = 'daily',
  count = 100
): Promise<KlinePoint[]> {
  const secid = toSecid(code);
  if (!secid || !/^(sh|sz|bj)\d{6}$/.test(code)) return [];

  const kltMap = { daily: 101, weekly: 102, monthly: 103 };
  const klt = kltMap[period];

  try {
    const resp = await Axios.get(KLINE_URL, {
      params: {
        secid,
        fields1: 'f1,f2,f3,f4,f5,f6',
        fields2: 'f51,f52,f53,f54,f55,f56,f57,f58',
        klt,
        fqt: 1,
        beg: 0,
        end: 20500101,
        lmt: count,
      },
      headers: { ...randHeader(), Referer: 'http://quote.eastmoney.com/' },
    });

    const klines: string[] = resp.data?.data?.klines ?? [];
    if (!Array.isArray(klines)) return [];

    return klines
      .map((line: string) => {
        const parts = line.split(',');
        if (parts.length < 6) return null;
        return {
          date: parts[0],
          open: parseFloat(parts[1]) || 0,
          close: parseFloat(parts[2]) || 0,
          high: parseFloat(parts[3]) || 0,
          low: parseFloat(parts[4]) || 0,
          volume: parseFloat(parts[5]) || 0,
          amount: parseFloat(parts[6]) || 0,
        };
      })
      .filter(Boolean) as KlinePoint[];
  } catch (err) {
    console.error('EastMoney kline fetch failed:', err);
    return [];
  }
}

/** 东方财富搜索建议返回条目 */
interface EMSuggestItem {
  Code?: string
  Name?: string
  Market?: string
  Type?: number
}

/**
 * 搜索股票
 */
export async function searchEastMoney(keyword: string): Promise<Array<{ code: string; name: string; market: string }>> {
  if (!keyword.trim()) return [];

  try {
    const resp = await Axios.get('https://searchadapter.eastmoney.com/api/suggest/get', {
      params: {
        input: keyword.trim(),
        count: 10,
        type: 14, // 全市场
      },
      headers: { ...randHeader(), Referer: 'http://quote.eastmoney.com/' },
    });

    const list: EMSuggestItem[] = resp.data?.QuotationCode ?? resp.data?.Data ?? [];
    if (!Array.isArray(list)) return [];

    return list
      .filter((item) => item.Code && item.Name)
      .map((item) => ({
        code: (item.Market === '1' ? 'sh' : item.Market === '0' ? 'sz' : '') + String(item.Code).toLowerCase(),
        name: item.Name || '',
        market: item.Market === '1' ? '沪市' : item.Market === '0' ? '深市' : '未知',
      }));
  } catch (err) {
    console.error('EastMoney search failed:', err);
    return [];
  }
}
