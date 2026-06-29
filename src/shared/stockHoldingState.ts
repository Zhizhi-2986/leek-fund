import globalState from '../globalState';
import { uniq } from './utils';

const STOCK_TREE_HOLDING_CODES_STATE_KEY = 'leek-fund.stockTreeHoldingCodes';

export function getStockTreeHoldingCodes(): string[] {
  const raw = globalState.context?.globalState.get<string[]>(
    STOCK_TREE_HOLDING_CODES_STATE_KEY,
    []
  );
  if (!Array.isArray(raw)) {
    return [];
  }
  return uniq(
    raw
      .map(normalizeStockCode)
      .filter((code) => isSupportedStockCode(code))
  ) as string[];
}

export function getStockTreeHoldingCodeSet(): Set<string> {
  return new Set(getStockTreeHoldingCodes());
}

export function isStockTreeHolding(code: string): boolean {
  const normalizedCode = normalizeStockCode(code);
  return Boolean(normalizedCode) && getStockTreeHoldingCodeSet().has(normalizedCode);
}

export async function setStockTreeHolding(
  code: string,
  holding: boolean
): Promise<string[]> {
  const normalizedCode = normalizeStockCode(code);
  if (!isSupportedStockCode(normalizedCode)) {
    throw new Error('仅支持股票树中的 A 股、港股、美股标的标记持仓。');
  }
  if (!globalState.context?.globalState) {
    throw new Error('扩展状态尚未初始化，无法保存持仓标记。');
  }

  const currentCodes = getStockTreeHoldingCodes();
  const nextCodes = holding
    ? (uniq([...currentCodes, normalizedCode]) as string[])
    : currentCodes.filter((item) => item !== normalizedCode);
  await globalState.context.globalState.update(STOCK_TREE_HOLDING_CODES_STATE_KEY, nextCodes);
  return nextCodes;
}

function normalizeStockCode(code: unknown): string {
  if (typeof code !== 'string') {
    return '';
  }
  return code.trim().toLowerCase().replace(/^bj_/, 'bj');
}

function isSupportedStockCode(code: string): boolean {
  return /^(sh|sz|bj)\d{6}$/.test(code) || /^hk\d+$/i.test(code) || /^usr_[a-z0-9._-]+$/i.test(code);
}
