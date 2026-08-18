/**
 * Durable state for dsh-leek-fund: watchlist stocks, two-level groups,
 * holding/watch marks and the status-bar stock subset.
 *
 * The schema and normalization rules are ported from the Hermes plugin backend
 * (dashboard/plugin_api.py, STATE_VERSION = 2) so the data stays semantically
 * compatible with the VSCode LeekFund extension.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Category, Group, State } from './types.js'

export const STATE_VERSION = 2

export const DEFAULT_STOCKS = [
  'sh000001',
  'sh000300',
  'sh000016',
  'sh000688',
  'hk03690',
  'hk00700',
  'usr_ixic',
  'usr_dji',
  'usr_inx',
]

export const CATEGORY_ORDER: Category[] = ['A', 'HK', 'US']

const CODE_PATTERN = /^(?:(?:sh|sz|bj)\d{6}|hk\d{5}|(?:usr_|gb_)[a-z0-9._-]+)$/i

export function defaultState(): State {
  return {
    schemaVersion: STATE_VERSION,
    stocks: [...DEFAULT_STOCKS],
    groups: [],
    holdingCodes: [],
    watchCodes: [],
    focusCodes: [],
    statusBarStockCodes: [],
  }
}

/** Normalize one code to the canonical lowercase form; empty when invalid. */
export function normalizeCode(value: unknown): string {
  const code = String(value ?? '')
    .trim()
    .replace(/\$/g, '.')
    .toLowerCase()
  if (!code) return ''
  if (!CODE_PATTERN.test(code)) return ''
  return code
}

/** Market category of one normalized code; undefined for unrecognized codes. */
export function categoryOf(code: string): Category | undefined {
  if (/^(sh|sz|bj)/.test(code)) return 'A'
  if (code.startsWith('hk')) return 'HK'
  if (code.startsWith('usr_') || code.startsWith('gb_')) return 'US'
  return undefined
}

function dedupe(values: Iterable<string>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value)
      result.push(value)
    }
  }
  return result
}

function normalizeGroup(raw: unknown, stocks: Set<string>): Group | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const source = raw as Record<string, unknown>
  const id = String(source.id ?? '').trim()
  const name = String(source.name ?? '').trim()
  const category = String(source.category ?? '').toUpperCase()
  if (!id || !name || !CATEGORY_ORDER.includes(category as Category)) {
    return undefined
  }
  // Accept both the snake_case disk format and the camelCase in-memory shape.
  const rawCodes: unknown[] = Array.isArray(source.stock_codes)
    ? (source.stock_codes as unknown[])
    : Array.isArray(source.stockCodes)
      ? (source.stockCodes as unknown[])
      : []
  const codes = dedupe(
    rawCodes
      .map(normalizeCode)
      .filter((code) => code && stocks.has(code) && categoryOf(code) === category)
  )
  const parentId = String(source.parent_id ?? source.parentId ?? '').trim()
  const group: Group = { id, name, category: category as Category, stockCodes: codes }
  if (parentId && parentId !== id) group.parentId = parentId
  return group
}

/** Keep only valid groups: unique ids, same-category membership, and a parent
 * chain of at most two levels (a parent group must itself be a top-level group). */
function normalizeGroups(raw: unknown, stocks: Set<string>): Group[] {
  if (!Array.isArray(raw)) return []
  const candidates: Group[] = []
  const seenIds = new Set<string>()
  for (const item of raw) {
    const group = normalizeGroup(item, stocks)
    if (!group || seenIds.has(group.id)) continue
    seenIds.add(group.id)
    candidates.push(group)
  }
  const byId = new Map(candidates.map((group) => [group.id, group]))
  const result: Group[] = []
  for (const group of candidates) {
    const parentId = group.parentId
    if (!parentId) {
      result.push(group)
      continue
    }
    const parent = byId.get(parentId)
    if (!parent || parent.parentId || parent.category !== group.category) continue
    result.push(group)
  }
  return result
}

/** Clean an arbitrary parsed value into a valid State. Accepts both the
 * snake_case disk format and the camelCase in-memory shape. */
export function normalizeState(raw: unknown): State {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const pick = (snake: string, camel: string): unknown =>
    source[snake] !== undefined ? source[snake] : source[camel]

  const rawStocks = pick('stocks', 'stocks')
  const stocks = dedupe(
    (Array.isArray(rawStocks) ? rawStocks : DEFAULT_STOCKS)
      .map(normalizeCode)
      .filter(Boolean)
  )
  const stockSet = new Set(stocks)

  const normalizeSubset = (snake: string, camel: string): string[] => {
    const raw = pick(snake, camel)
    return dedupe(
      (Array.isArray(raw) ? raw : [])
        .map(normalizeCode)
        .filter((code: string) => code && stockSet.has(code))
    )
  }

  const groups = normalizeGroups(pick('groups', 'groups'), stockSet)
  const normalized: State = {
    schemaVersion: STATE_VERSION,
    stocks,
    groups,
    holdingCodes: normalizeSubset('holding_codes', 'holdingCodes'),
    watchCodes: normalizeSubset('watch_codes', 'watchCodes'),
    focusCodes: normalizeSubset('focus_codes', 'focusCodes'),
    statusBarStockCodes: normalizeSubset('status_bar_stock_codes', 'statusBarStockCodes'),
  }

  // A-share stocks that belong to no group and carry no mark are surfaced in
  // the watch list by default (parity with the Hermes backend).
  const covered = new Set<string>()
  for (const group of groups) for (const code of group.stockCodes) covered.add(code)
  for (const code of normalized.holdingCodes) covered.add(code)
  for (const code of normalized.watchCodes) covered.add(code)
  const orphans = stocks.filter((code) => !covered.has(code) && categoryOf(code) === 'A')
  if (orphans.length > 0) {
    normalized.watchCodes = dedupe([...normalized.watchCodes, ...orphans])
  }
  return normalized
}

async function readJson(path: string, fallback: () => State): Promise<State> {
  try {
    return normalizeState(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return fallback()
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
    await rename(temporary, path)
  } catch (error) {
    await rmQuiet(temporary)
    throw error
  }
}

async function rmQuiet(path: string): Promise<void> {
  try {
    await import('node:fs/promises').then(({ rm }) => rm(path, { force: true }))
  } catch {
    // Best-effort cleanup only.
  }
}

/** Resolve the state file path: explicit `dataPath` wins, then
 * `$DSH_HOME/leek-fund/state.json`, then a local fallback directory. */
export function resolveStatePath(dataPath?: string): string {
  if (dataPath) return dataPath
  const home = process.env.DSH_HOME
  if (home) return join(home, 'leek-fund', 'state.json')
  return join(process.cwd(), '.dsh-leek-fund', 'state.json')
}

export interface StateStore {
  load(): Promise<State>
  save(state: State): Promise<State>
  /** Run `mutator` on the loaded state and persist the result. When the
   * mutator returns a failed `MutationResult`, the state is left untouched
   * and nothing is written. */
  mutate(mutator: (state: State) => void | MutationResult): Promise<State>
  /** Absolute path of the state file. */
  readonly path: string
}

export function createStateStore(dataPath?: string): StateStore {
  const path = resolveStatePath(dataPath)
  return {
    path,
    async load() {
      return readJson(path, defaultState)
    },
    async save(state: State) {
      const normalized = normalizeState(state)
      await writeJsonAtomic(path, normalized)
      return normalized
    },
    async mutate(mutator: (state: State) => void | MutationResult) {
      const state = normalizeState(await readJson(path, defaultState))
      const outcome = mutator(state)
      if (outcome && !outcome.ok) return state
      return this.save(state)
    },
  }
}

/** Find the group that currently owns `code` (first match wins). */
export function groupOf(state: State, code: string): Group | undefined {
  return state.groups.find((group) => group.stockCodes.includes(code))
}

export interface MutationResult {
  ok: boolean
  error?: string
  state: State
}

export function createGroup(state: State, name: string, category: Category, parentId?: string): MutationResult {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: '分组名称不能为空', state }
  const parent = parentId ? state.groups.find((group) => group.id === parentId) : undefined
  if (parentId && !parent) return { ok: false, error: `父分组不存在: ${parentId}`, state }
  if (parentId && parent!.parentId) return { ok: false, error: '二级分组不能包含子分组', state }
  if (parentId && parent!.category !== category) {
    return { ok: false, error: '子分组必须与父分组同市场', state }
  }
  const siblingNames = state.groups
    .filter((group) => (group.parentId ?? '') === (parentId ?? ''))
    .map((group) => group.name)
  if (siblingNames.includes(trimmed)) {
    return { ok: false, error: `同级已存在同名分组: ${trimmed}`, state }
  }
  const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  const group: Group = { id, name: trimmed, category, stockCodes: [] }
  if (parentId) group.parentId = parentId
  state.groups.push(group)
  return { ok: true, state }
}

export function renameGroup(state: State, id: string, name: string): MutationResult {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: '分组名称不能为空', state }
  const group = state.groups.find((item) => item.id === id)
  if (!group) return { ok: false, error: `分组不存在: ${id}`, state }
  const siblingNames = state.groups
    .filter((item) => item.id !== id && (item.parentId ?? '') === (group.parentId ?? ''))
    .map((item) => item.name)
  if (siblingNames.includes(trimmed)) {
    return { ok: false, error: `同级已存在同名分组: ${trimmed}`, state }
  }
  group.name = trimmed
  return { ok: true, state }
}

/** Delete a group and all of its second-level children; stocks are kept in the
 * watchlist and return to the ungroupped bucket. */
export function deleteGroup(state: State, id: string): MutationResult {
  const target = state.groups.find((group) => group.id === id)
  if (!target) return { ok: false, error: `分组不存在: ${id}`, state }
  state.groups = state.groups.filter((group) => {
    if (group.id === id) return false
    if (group.parentId === id) return false
    return true
  })
  return { ok: true, state }
}

/** Move `code` into `groupId`, or back to ungroupped when `groupId` is omitted.
 * The target group must exist and belong to the same market as the stock. */
export function moveStockToGroup(state: State, code: string, groupId?: string): MutationResult {
  const normalized = normalizeCode(code)
  if (!normalized) return { ok: false, error: `无效股票代码: ${code}`, state }
  if (!state.stocks.includes(normalized)) {
    return { ok: false, error: `股票不在自选列表中: ${normalized}`, state }
  }
  for (const group of state.groups) {
    group.stockCodes = group.stockCodes.filter((item) => item !== normalized)
  }
  if (groupId) {
    const target = state.groups.find((group) => group.id === groupId)
    if (!target) return { ok: false, error: `分组不存在: ${groupId}`, state }
    const category = categoryOf(normalized)
    if (category !== target.category) {
      return { ok: false, error: `股票与目标分组市场不一致`, state }
    }
    target.stockCodes.push(normalized)
  }
  return { ok: true, state }
}

/** Set or clear one holding/watch/focus mark for a watchlist stock. */
export function setMark(
  state: State,
  code: string,
  mark: 'holding' | 'watch' | 'focus',
  value: boolean
): MutationResult {
  const normalized = normalizeCode(code)
  if (!normalized) return { ok: false, error: `无效股票代码: ${code}`, state }
  if (!state.stocks.includes(normalized)) {
    return { ok: false, error: `股票不在自选列表中: ${normalized}`, state }
  }
  const list = mark === 'holding' ? state.holdingCodes : mark === 'watch' ? state.watchCodes : state.focusCodes
  const index = list.indexOf(normalized)
  if (value && index < 0) list.push(normalized)
  if (!value && index >= 0) list.splice(index, 1)
  return { ok: true, state }
}

/** Add a stock to the watchlist (deduplicated); optional immediate group move. */
export function addStock(state: State, code: string, groupId?: string): MutationResult {
  const normalized = normalizeCode(code)
  if (!normalized) return { ok: false, error: `无效股票代码: ${code}`, state }
  if (!state.stocks.includes(normalized)) state.stocks.push(normalized)
  if (groupId) return moveStockToGroup(state, normalized, groupId)
  return { ok: true, state }
}

/** Remove a stock from the watchlist, its groups and all marks. */
export function removeStock(state: State, code: string): MutationResult {
  const normalized = normalizeCode(code)
  if (!normalized) return { ok: false, error: `无效股票代码: ${code}`, state }
  state.stocks = state.stocks.filter((item) => item !== normalized)
  state.holdingCodes = state.holdingCodes.filter((item) => item !== normalized)
  state.watchCodes = state.watchCodes.filter((item) => item !== normalized)
  state.focusCodes = state.focusCodes.filter((item) => item !== normalized)
  state.statusBarStockCodes = state.statusBarStockCodes.filter((item) => item !== normalized)
  for (const group of state.groups) {
    group.stockCodes = group.stockCodes.filter((item) => item !== normalized)
  }
  return { ok: true, state }
}

function moveWithin<T>(list: T[], item: T, before?: T): T[] {
  const rest = list.filter((entry) => entry !== item)
  if (before === undefined) return [...rest, item]
  const index = rest.indexOf(before)
  if (index < 0) return [...rest, item]
  rest.splice(index, 0, item)
  return rest
}

/** Ungroupped stock codes of a state, in watchlist order. */
function ungrouppedStocks(state: State): string[] {
  const grouped = new Set<string>()
  for (const group of state.groups) for (const code of group.stockCodes) grouped.add(code)
  return state.stocks.filter((code) => !grouped.has(code))
}

/**
 * Reorder a stock: within its current group, across groups (when
 * `targetGroupId` differs), or within the ungroupped bucket (no group).
 * `beforeCode` is the anchor the stock is inserted in front of (within the
 * same target scope); omit to append at the end. The stock must already be
 * in the watchlist and the target group must belong to the same market.
 */
export function reorderStock(
  state: State,
  code: string,
  targetGroupId?: string,
  beforeCode?: string
): MutationResult {
  const normalized = normalizeCode(code)
  if (!normalized) return { ok: false, error: `无效股票代码: ${code}`, state }
  if (!state.stocks.includes(normalized)) {
    return { ok: false, error: `股票不在自选列表中: ${normalized}`, state }
  }
  const before = beforeCode ? normalizeCode(beforeCode) : undefined
  if (targetGroupId) {
    const target = state.groups.find((group) => group.id === targetGroupId)
    if (!target) return { ok: false, error: `分组不存在: ${targetGroupId}`, state }
    if (categoryOf(normalized) !== target.category) {
      return { ok: false, error: '股票与目标分组市场不一致', state }
    }
    for (const group of state.groups) {
      group.stockCodes = group.stockCodes.filter((item) => item !== normalized)
    }
    if (before && !target.stockCodes.includes(before)) {
      return { ok: false, error: `目标位置不在目标分组: ${before}`, state }
    }
    target.stockCodes = moveWithin(target.stockCodes, normalized, before)
    return { ok: true, state }
  }
  const current = groupOf(state, normalized)
  if (current) {
    if (before && !current.stockCodes.includes(before)) {
      return { ok: false, error: `目标位置不在同一分组: ${before}`, state }
    }
    current.stockCodes = moveWithin(current.stockCodes, normalized, before)
    return { ok: true, state }
  }
  // Reorder within the ungroupped bucket: rewrite the watchlist array so
  // ungroupped stocks keep their relative order (grouped stocks' absolute
  // positions do not affect group display order).
  const ungroupped = ungrouppedStocks(state)
  if (before && !ungroupped.includes(before)) {
    return { ok: false, error: `目标位置不在未分组列表: ${before}`, state }
  }
  const reordered = moveWithin(ungroupped, normalized, before)
  const grouped = new Set<string>()
  for (const group of state.groups) for (const item of group.stockCodes) grouped.add(item)
  const head = state.stocks.filter((item) => grouped.has(item))
  state.stocks = [...head, ...reordered]
  return { ok: true, state }
}

/** Reorder a group among its siblings (same parent level). */
export function reorderGroup(state: State, id: string, beforeId?: string): MutationResult {
  const target = state.groups.find((group) => group.id === id)
  if (!target) return { ok: false, error: `分组不存在: ${id}`, state }
  const parentKey = target.parentId ?? ''
  const siblings = state.groups.filter((group) => (group.parentId ?? '') === parentKey)
  const before = beforeId ? state.groups.find((group) => group.id === beforeId) : undefined
  if (before && (before.parentId ?? '') !== parentKey) {
    return { ok: false, error: '只能与同级分组排序', state }
  }
  const reordered = moveWithin(siblings, target, before)
  const reorderedIds = new Set(reordered.map((group) => group.id))
  const others = state.groups.filter((group) => !reorderedIds.has(group.id))
  state.groups = [...others, ...reordered]
  return { ok: true, state }
}

/** Reorder a holding/watch/focus mark within its own list. */
export function reorderMark(
  state: State,
  mark: 'holding' | 'watch' | 'focus',
  code: string,
  beforeCode?: string
): MutationResult {
  const normalized = normalizeCode(code)
  if (!normalized) return { ok: false, error: `无效股票代码: ${code}`, state }
  const list = mark === 'holding' ? state.holdingCodes : mark === 'watch' ? state.watchCodes : state.focusCodes
  if (!list.includes(normalized)) {
    return { ok: false, error: `股票不在${mark === 'holding' ? '持仓' : mark === 'watch' ? '关注' : '重点关注'}列表中: ${normalized}`, state }
  }
  const before = beforeCode ? normalizeCode(beforeCode) : undefined
  if (before && before !== normalized && !list.includes(before)) {
    return { ok: false, error: '目标位置不在同一列表中', state }
  }
  const reordered = moveWithin(list, normalized, before)
  if (mark === 'holding') state.holdingCodes = reordered
  else if (mark === 'watch') state.watchCodes = reordered
  else state.focusCodes = reordered
  return { ok: true, state }
}
