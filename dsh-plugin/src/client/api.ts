/**
 * Client fetch wrapper for the host `/leek-fund/api` routes.
 */
import type { Group, Quote, StockCandidate } from './types.js'

const API_BASE = '/leek-fund/api'

export interface SnapshotState {
  stocks: string[]
  groups: Group[]
  holdingCodes: string[]
  watchCodes: string[]
  focusCodes?: string[]
  statusBarStockCodes: string[]
  strategyUpdatedAt?: string
  strategyMatchCount?: number
}

export interface Snapshot {
  quotes: Quote[]
  indexQuotes: Quote[]
  state: SnapshotState
}

interface ApiEnvelope {
  ok?: boolean
  error?: string
}

async function call<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  const json = (await res.json()) as T & ApiEnvelope
  if (!res.ok || json.ok === false) {
    throw new Error(json.error ?? `leek-fund API ${method} failed (HTTP ${res.status})`)
  }
  return json as T
}

export function fetchSnapshot(signal?: AbortSignal): Promise<Snapshot> {
  return call<Snapshot>('snapshot', {}, signal)
}

export function searchStocks(keyword: string): Promise<{ results: StockCandidate[] }> {
  return call('search', { keyword })
}

export function mutate(
  op: string,
  args: Record<string, unknown>
): Promise<{ ok: true; data?: { id?: string } }> {
  return call('mutate', { op, args })
}

export function reorder(kind: string, args: Record<string, unknown>): Promise<{ ok: true }> {
  return call('reorder', { kind, args })
}

/** Market category of a code (client-side mirror; keeps the tree A-only). */
export function categoryOf(code: string): 'A' | 'HK' | 'US' | undefined {
  if (/^(sh|sz|bj)/.test(code)) return 'A'
  if (code.startsWith('hk')) return 'HK'
  if (code.startsWith('usr_') || code.startsWith('gb_')) return 'US'
  return undefined
}

/** 大盘实时概览 */
export interface MarketOverview {
  upCount: number
  downCount: number
  flatCount: number
  shAmount: number
  szAmount: number
  totalAmount: number
  estimatedCloseAmount: number
  time: string
}

export function fetchMarketOverview(signal?: AbortSignal): Promise<MarketOverview> {
  return call<MarketOverview>('marketOverview', {}, signal)
}
