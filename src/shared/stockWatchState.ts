import globalState from '../globalState';
import { uniq } from './utils';

const STOCK_TREE_WATCH_CODES_STATE_KEY = 'leek-fund.stockTreeWatchCodes';

export function getStockTreeWatchCodes(): string[] {
  const raw = globalState.context?.globalState.get<string[]>(
    STOCK_TREE_WATCH_CODES_STATE_KEY,
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

export function getStockTreeWatchCodeSet(): Set<string> {
  return new Set(getStockTreeWatchCodes());
}

export function isStockTreeWatch(code: string): boolean {
  const normalizedCode = normalizeStockCode(code);
  return Boolean(normalizedCode) && getStockTreeWatchCodeSet().has(normalizedCode);
}

export async function setStockTreeWatch(
  code: string,
  watch: boolean
): Promise<string[]> {
  const normalizedCode = normalizeStockCode(code);
  if (!isSupportedStockCode(normalizedCode)) {
    throw new Error('仅支持股票树中的 A 股、港股、美股标的关注。');
  }
  if (!globalState.context?.globalState) {
    throw new Error('扩展状态尚未初始化，无法保存关注标记。');
  }

  const currentCodes = getStockTreeWatchCodes();
  const nextCodes = watch
    ? (uniq([...currentCodes, normalizedCode]) as string[])
    : currentCodes.filter((item) => item !== normalizedCode);
  await globalState.context.globalState.update(STOCK_TREE_WATCH_CODES_STATE_KEY, nextCodes);
  return nextCodes;
}

export async function moveStockTreeWatchCodes(
  codes: string[],
  targetCode?: string
): Promise<string[]> {
  if (!globalState.context?.globalState) {
    throw new Error('扩展状态尚未初始化，无法调整关注顺序。');
  }

  const currentCodes = getStockTreeWatchCodes();
  const requestedCodeSet = new Set(
    codes
      .map(normalizeStockCode)
      .filter((code) => isSupportedStockCode(code))
  );
  const movingCodes = currentCodes.filter((code) => requestedCodeSet.has(code));
  if (!movingCodes.length) {
    return currentCodes;
  }

  const movingCodeSet = new Set(movingCodes);
  const normalizedTargetCode = normalizeStockCode(targetCode);
  if (normalizedTargetCode && movingCodeSet.has(normalizedTargetCode)) {
    return currentCodes;
  }

  const remainingCodes = currentCodes.filter((code) => !movingCodeSet.has(code));
  let insertIndex = remainingCodes.length;
  if (normalizedTargetCode) {
    const remainingTargetIndex = remainingCodes.indexOf(normalizedTargetCode);
    const originalMovingIndex = currentCodes.findIndex((code) => movingCodeSet.has(code));
    const originalTargetIndex = currentCodes.indexOf(normalizedTargetCode);
    if (remainingTargetIndex < 0 || originalMovingIndex < 0 || originalTargetIndex < 0) {
      return currentCodes;
    }
    insertIndex =
      originalMovingIndex < originalTargetIndex
        ? remainingTargetIndex + 1
        : remainingTargetIndex;
  }

  const nextCodes = [
    ...remainingCodes.slice(0, insertIndex),
    ...movingCodes,
    ...remainingCodes.slice(insertIndex),
  ];
  if (nextCodes.join(',') === currentCodes.join(',')) {
    return currentCodes;
  }
  await globalState.context.globalState.update(STOCK_TREE_WATCH_CODES_STATE_KEY, nextCodes);
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
