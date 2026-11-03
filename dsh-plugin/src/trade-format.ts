/**
 * Human-readable formatting for daily trading data (A-shares).
 * Pure functions, unit-tested; used by the "当日数据" panel.
 */

/** 成交量（手）→ "123.99 万手" / "8,888 手"；非有限或非正数 → '--' */
export function formatVolumeHands(volume: number): string {
  if (!Number.isFinite(volume) || volume <= 0) return '--'
  if (volume >= 1e4) return `${(volume / 1e4).toFixed(2)} 万手`
  return `${Math.round(volume).toLocaleString('zh-CN')} 手`
}

/** 成交额（元）→ "24.40 亿" / "3,256.00 万" / "888 元"；非有限或非正数 → '--' */
export function formatYuanAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '--'
  if (amount >= 1e8) return `${(amount / 1e8).toFixed(2)} 亿`
  if (amount >= 1e4) {
    const fixed = (amount / 1e4).toFixed(2)
    const [intPart, fracPart] = fixed.split('.')
    return `${Number(intPart).toLocaleString('zh-CN')}.${fracPart} 万`
  }
  return `${Math.round(amount)} 元`
}
