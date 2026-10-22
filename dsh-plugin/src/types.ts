/** Shared types for the dsh-leek-fund plugin. */

/** Stock market category used for grouping constraints (A-share only). */
export type Category = 'A'

/** A user-defined watchlist group. At most two levels: a group with
 * `parentId` is a second-level group and must not have children. */
export interface Group {
  id: string
  name: string
  category: Category
  stockCodes: string[]
  parentId?: string
}

/** Durable plugin state, persisted as JSON under the plugin data directory. */
export interface State {
  schemaVersion: number
  /** All watchlist stock codes (source of truth). */
  stocks: string[]
  /** User-defined groups; groups reference codes that exist in `stocks`. */
  groups: Group[]
  /** Subset of `stocks` marked as holdings. */
  holdingCodes: string[]
  /** Subset of `stocks` marked as watch. */
  watchCodes: string[]
  /** Subset of `stocks` pinned as key focus (may overlap groups). */
  focusCodes: string[]
  /** Subset of `stocks` pinned to the status bar (kept for VSCode parity). */
  statusBarStockCodes: string[]
}

/** One normalized market quote. */
export interface Quote {
  code: string
  name: string
  /** Latest price (raw numeric value). */
  price: number
  /** Previous close. */
  yestclose: number
  open: number
  high: number
  low: number
  /** price - yestclose. */
  updown: number
  /** updown / yestclose * 100. */
  percent: number
  time: string
  available: boolean
}

/** One real-time A-share speed-ranking item from the market feed. */
export interface SpeedRankingItem extends Quote {
  /** Five-minute price speed, in percent, from the upstream f22 field. */
  speed: number
  /** Industry sector from Eastmoney's stock metadata. */
  sector: string
}

/** One A-share search candidate. */
export interface StockCandidate {
  code: string
  name: string
}
