/**
 * 新浪数据源
 * 用于全球指数（usr_dji, b_NKY 等）+ 东方财富降级备用
 */
import Axios from 'axios';
import { decode } from 'iconv-lite';
import { randHeader } from '../shared/utils';
import type { QuoteResult } from './types';

const SINA_QUOTE_URL = 'https://hq.sinajs.cn/list=';

/** 判断是否为全球指数代码 */
function isGlobalIndex(code: string): boolean {
  return /^(usr_|b_|int_|gb_)/.test(code);
}

/**
 * 从新浪接口获取行情
 * 支持 A 股（sh/sz/bj）、全球指数（usr_/b_/int_/gb_）
 */
export async function fetchSinaQuotes(codes: string[]): Promise<Map<string, QuoteResult>> {
  const result = new Map<string, QuoteResult>();
  if (!codes.length) return result;

  const url = `${SINA_QUOTE_URL}${codes.map((c) => c.replace('.', '$')).join(',')}`;
  const resp = await Axios.get(url, {
    responseType: 'arraybuffer',
    transformResponse: [(data) => decode(data, 'GB18030')],
    headers: { ...randHeader(), Referer: 'http://finance.sina.com.cn/' },
  });

  if (/FAILED/.test(resp.data)) return result;

  const lines = String(resp.data).split('";\n');
  for (const line of lines) {
    if (!line.includes('="')) continue;
    const rawCode = line.split('="')[0].split('var hq_str_')[1]?.replace(/\$/g, '.');
    const params = line.split('="')[1]?.split(',');
    if (!rawCode || !params || params.length < 3) continue;

    const code = rawCode.toLowerCase();
    let quote: QuoteResult | undefined;

    if (/^(sh|sz|bj)\d{6}$/.test(code)) {
      // A 股格式：name, open, yestclose, price, high, low, ...
      quote = parseSinaAStock(code, params);
    } else if (isGlobalIndex(code)) {
      quote = parseSinaGlobalIndex(code, params);
    }

    if (quote) result.set(quote.code, quote);
  }

  return result;
}

/** 解析 A 股行情 */
function parseSinaAStock(code: string, params: string[]): QuoteResult | undefined {
  if (params.length < 5) return undefined;
  const name = params[0];
  if (!name) return undefined;

  const open = parseFloat(params[1]) || 0;
  const yestclose = parseFloat(params[2]) || 0;
  let price = parseFloat(params[3]) || 0;
  if (price === 0 && params.length > 6) {
    price = parseFloat(params[6]) || yestclose || 0;
  }
  const high = parseFloat(params[4]) || 0;
  const low = parseFloat(params[5]) || 0;
  const volume = parseFloat(params[8]) || 0;
  const amount = parseFloat(params[9]) || 0;
  const time = params.length > 31 ? `${params[30]} ${params[31]}`.trim() : '';

  // 全零判断为无数据
  if (price === 0 && high === 0 && low === 0 && yestclose === 0) {
    return undefined;
  }

  const updown = price - yestclose;
  const percent = yestclose > 0 ? (updown / yestclose) * 100 : 0;

  return { code, name, price, yestclose, open, high, low, volume, amount, time, updown, percent };
}

/** 解析全球指数行情 */
function parseSinaGlobalIndex(code: string, params: string[]): QuoteResult | undefined {
  const name = params[0];
  if (!name) return undefined;

  // 全球指数格式：name, price, yestclose, ...
  // 或 name, , , price, yestclose, ...（字段位置因指数而异）
  let price = 0;
  let yestclose = 0;

  if (code.startsWith('usr_') || code.startsWith('int_')) {
    // 美股指数/全球指数：name, price, percent?, ... yestclose 在末尾
    price = parseFloat(params[1]) || 0;
    // 尝试多个可能的昨收位置
    yestclose = parseFloat(params[26]) || parseFloat(params[2]) || 0;
  } else if (code.startsWith('b_')) {
    // 其他国际市场指数
    price = parseFloat(params[1]) || 0;
    yestclose = parseFloat(params[2]) || 0;
  } else {
    price = parseFloat(params[1]) || 0;
    yestclose = parseFloat(params[2]) || 0;
  }

  if (price <= 0 && yestclose <= 0) return undefined;

  const open = parseFloat(params[5]) || 0;
  const high = parseFloat(params[6]) || 0;
  const low = parseFloat(params[7]) || 0;
  const volume = parseFloat(params[10]) || 0;
  const time = params[3] || '';

  const updown = price - yestclose;
  const percent = yestclose > 0 ? (updown / yestclose) * 100 : 0;

  return { code, name, price, yestclose, open, high, low, volume, amount: 0, time, updown, percent };
}
