export type MarketPhase = 'trading' | 'lunch' | 'closed' | 'stale' | 'unknown'
export interface MarketStatus { phase: MarketPhase; fresh: boolean; label: string; quoteTime: string }

const CHINA_OFFSET_MS = 8 * 60 * 60_000
const MAX_AGE_MS = 5 * 60_000
const TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/

/** Interpret upstream A-share timestamps as Asia/Shanghai, not the OS locale. */
function parseChinaTime(time: string): number | undefined {
  const match = TIME_PATTERN.exec(time)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = match[6] === undefined ? 0 : Number(match[6])
  const utc = Date.UTC(year, month - 1, day, hour, minute, second ?? 0)
  const value = new Date(utc)
  if (value.getUTCFullYear() !== year || value.getUTCMonth() + 1 !== month || value.getUTCDate() !== day ||
      value.getUTCHours() !== hour || value.getUTCMinutes() !== minute || value.getUTCSeconds() !== (second ?? 0)) return undefined
  return utc - CHINA_OFFSET_MS
}

/** Classify the exchange clock without treating cached prices as live prices. */
export function marketStatus(time: string, now = new Date()): MarketStatus {
  const quoteAt = parseChinaTime(time)
  if (quoteAt === undefined) return { phase: 'unknown', fresh: false, label: '时间未知', quoteTime: time }
  const chinaNow = new Date(now.getTime() + CHINA_OFFSET_MS)
  const weekday = chinaNow.getUTCDay()
  const seconds = chinaNow.getUTCHours() * 3600 + chinaNow.getUTCMinutes() * 60 + chinaNow.getUTCSeconds()
  const age = now.getTime() - quoteAt
  const sameDay = new Date(quoteAt + CHINA_OFFSET_MS).toISOString().slice(0, 10) === chinaNow.toISOString().slice(0, 10)
  if (weekday === 0 || weekday === 6) return { phase: 'closed', fresh: false, label: '休市', quoteTime: time }
  if (!sameDay || age < 0 || age > 24 * 60 * 60_000) return { phase: 'stale', fresh: false, label: '行情已过期', quoteTime: time }
  if (seconds < 570 * 60) return { phase: 'closed', fresh: false, label: '未开盘', quoteTime: time }
  if (seconds > 690 * 60 && seconds < 780 * 60) return { phase: 'lunch', fresh: false, label: '午间休市', quoteTime: time }
  if (seconds > 900 * 60) return { phase: 'closed', fresh: false, label: '已收盘', quoteTime: time }
  if (age > MAX_AGE_MS) return { phase: 'stale', fresh: false, label: '行情已过期', quoteTime: time }
  return { phase: 'trading', fresh: true, label: '交易中', quoteTime: time }
}
