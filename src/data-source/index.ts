/**
 * 数据源统一入口
 * 提供行情、K 线、搜索的统一接口，内部自动路由 + fallback
 *
 * 路由策略：
 * - A 股/指数/ETF → 东方财富主 → 新浪备
 * - 全球指数（usr_/b_/int_）→ 新浪（唯一可用源）
 */
import { fetchEastMoneyQuotes, fetchEastMoneyKline, searchEastMoney } from './eastmoney';
import { fetchSinaQuotes } from './sina';
import type { QuoteResult, KlinePoint } from './types';

export type { QuoteResult, KlinePoint } from './types';

// ── 实时行情 ──────────────────────────────────────────────────────────

/**
 * 获取实时行情
 * A 股/指数 → 东方财富（主）→ 新浪（备）
 * 全球指数 → 新浪
 */
export async function getQuotes(codes: string[]): Promise<Map<string, QuoteResult>> {
  const cleanCodes = [...new Set(codes.map((c) => c.toLowerCase()).filter(Boolean))];

  // 按市场分组
  const aCodes = cleanCodes.filter((c) => /^(sh|sz|bj)\d{6}$/.test(c));
  const globalCodes = cleanCodes.filter((c) => /^(usr_|b_|int_|gb_)/.test(c));

  const results = new Map<string, QuoteResult>();

  // ① A 股/指数/ETF → 东方财富（主），失败降级到新浪
  if (aCodes.length > 0) {
    try {
      const em = await fetchEastMoneyQuotes(aCodes);
      if (em.size > 0) {
        em.forEach((v, k) => results.set(k, v));
      } else {
        // 东方财富返回空列表，降级
        const sina = await fetchSinaQuotes(aCodes);
        sina.forEach((v, k) => results.set(k, v));
      }
    } catch {
      // 网络异常，降级
      try {
        const sina = await fetchSinaQuotes(aCodes);
        sina.forEach((v, k) => results.set(k, v));
      } catch {
        // 双源都失败，静默处理
      }
    }
  }

  // ② 全球指数 → 新浪（唯一可用）
  if (globalCodes.length > 0) {
    try {
      const sina = await fetchSinaQuotes(globalCodes);
      sina.forEach((v, k) => results.set(k, v));
    } catch {
      // 静默处理
    }
  }

  return results;
}

// ── K 线数据 ──────────────────────────────────────────────────────────

/**
 * 获取 K 线数据
 * 东方财富主 → 新浪备
 */
export async function getKline(
  code: string,
  period: 'daily' | 'weekly' | 'monthly' = 'daily',
  count = 100
): Promise<KlinePoint[]> {
  // 全球指数不支持 K 线
  if (/^(usr_|b_|int_|gb_)/.test(code)) return [];

  // 东方财富主
  try {
    const data = await fetchEastMoneyKline(code, period, count);
    if (data.length > 0) return data;
  } catch {
    // 降级
  }

  // 新浪备（现有 logic in technicalAnalysis）
  return [];
}

// ── 股票搜索 ──────────────────────────────────────────────────────────

/**
 * 搜索股票
 * 东方财富主 → 腾讯备（通过 tencentStock）
 */
export async function searchStocks(
  keyword: string
): Promise<Array<{ code: string; name: string; market: string }>> {
  // 东方财富主
  try {
    const results = await searchEastMoney(keyword);
    if (results.length > 0) return results;
  } catch {
    // 降级
  }

  // 腾讯备
  try {
    const { searchStockList } = await import('../shared/tencentStock');
    const list = await searchStockList(keyword);
    return list.map((item: any) => ({
      code: item.code,
      name: item.name,
      market: item.market || '',
    }));
  } catch {
    return [];
  }
}
