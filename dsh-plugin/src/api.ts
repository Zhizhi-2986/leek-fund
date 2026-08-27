/**
 * Host HTTP API for the LeekFund sidebar tab: snapshot (quotes + state),
 * search, state mutations and drag-reorder. Registered by the host half on
 * the `/leek-fund/api` prefix; the client half fetches it from the browser.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fetchStockDetail, fetchMarketOverview } from './detail.js'
import { fetchQuotes } from './quote.js'
import { searchAStocks } from './search.js'
import {
  addStock,
  categoryOf,
  createGroup,
  deleteGroup,
  moveStockToGroup,
  removeStock,
  renameGroup,
  reorderGroup,
  reorderMark,
  reorderStock,
  setMark,
  type MutationResult,
  type StateStore,
} from './state.js'
import type { Quote, State } from './types.js'

/** Fixed indices pinned to the top ticker (Hermes parity). */
export const DEFAULT_INDEX_CODES = ['sh000001', 'sz399006', 'sh000680', 'b_NKY', 'b_KOSPI']

export interface ApiDeps {
  store: StateStore
  timeoutMs: number
}

/** Short-lived detail cache (intraday data is minute-granular). */
const DETAIL_CACHE_TTL_MS = 30_000
const detailCache = new Map<string, { at: number; detail: unknown }>()

async function fetchDetailCached(code: string, deps: ApiDeps): Promise<unknown> {
  const cached = detailCache.get(code)
  if (cached && Date.now() - cached.at < DETAIL_CACHE_TTL_MS) return cached.detail
  // Fetch the Sina live quote as a lightweight fallback for name / high/low
  // in case the primary Tencent minute API fails.  This is *not* required
  // for the Tencent path — fetchStockDetail uses it only as a last resort.
  let quote: Quote | undefined
  try {
    quote = (await fetchQuotes([code], deps.timeoutMs)).get(code)
  } catch {
    quote = undefined
  }
  const detail = await fetchStockDetail(code, quote, deps.timeoutMs)
  detailCache.set(code, { at: Date.now(), detail })
  return detail
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) throw new Error('payload must be an object')
    return value as Record<string, unknown>
  } catch (error) {
    throw new ApiError(400, `invalid JSON body: ${String(error)}`)
  }
}

export function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

export function writeOk(res: ServerResponse, value: unknown): void {
  writeJson(res, 200, value)
}

export function writeError(res: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    writeJson(res, error.status, { ok: false, error: error.message })
    return
  }
  writeJson(res, 500, { ok: false, error: String(error) })
}

/** Loopback-only trust fence (browser fetches arrive from the same host). */
export function isTrustedApiRequest(req: IncomingMessage): boolean {
  const host = req.headers.host ?? ''
  const hostname = host.split(':')[0].toLowerCase()
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(400, `${name} is required`)
  }
  return value
}

function mutateOp(state: State, op: string, args: Record<string, unknown>): MutationResult {
  switch (op) {
    case 'add':
      return addStock(state, requireString(args.code, 'code'), asOptionalString(args.groupId))
    case 'remove':
      return removeStock(state, requireString(args.code, 'code'))
    case 'groupCreate': {
      const category = asOptionalString(args.category) ?? 'A'
      if (category !== 'A' && category !== 'HK' && category !== 'US') {
        return { ok: false, error: `无效市场: ${category}`, state }
      }
      return createGroup(state, requireString(args.name, 'name'), category, asOptionalString(args.parentId))
    }
    case 'groupRename':
      return renameGroup(state, requireString(args.id, 'id'), requireString(args.name, 'name'))
    case 'groupDelete':
      return deleteGroup(state, requireString(args.id, 'id'))
    case 'groupMove':
      return moveStockToGroup(state, requireString(args.code, 'code'), asOptionalString(args.groupId))
    case 'mark': {
      const mark = asOptionalString(args.mark)
      if (mark !== 'holding' && mark !== 'watch' && mark !== 'focus') {
        return { ok: false, error: `无效标记: ${String(args.mark)}`, state }
      }
      return setMark(state, requireString(args.code, 'code'), mark, Boolean(args.value))
    }
    case 'statusBar': {
      const code = requireString(args.code, 'code')
      const normalized = code.toLowerCase().replace(/\$/g, '.')
      if (!state.stocks.includes(normalized)) {
        return { ok: false, error: `股票不在自选列表中: ${normalized}`, state }
      }
      if (args.value) {
        if (!state.statusBarStockCodes.includes(normalized)) state.statusBarStockCodes.push(normalized)
      } else {
        state.statusBarStockCodes = state.statusBarStockCodes.filter((item) => item !== normalized)
      }
      return { ok: true, state }
    }
    default:
      return { ok: false, error: `未知操作: ${op}`, state }
  }
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Snapshot for the sidebar: A-share quotes + top-ticker quotes + full state. */
export async function buildSnapshot(deps: ApiDeps): Promise<unknown> {
  const state = await deps.store.load()
  const aStocks = state.stocks.filter((code) => categoryOf(code) === 'A')
  const tickerCodes = [...DEFAULT_INDEX_CODES, ...state.statusBarStockCodes]
  const [quotes, indexQuotes] = await Promise.all([
    fetchQuotes(aStocks, deps.timeoutMs),
    fetchQuotes(tickerCodes, deps.timeoutMs),
  ])
  return {
    quotes: [...quotes.values()],
    indexQuotes: [...indexQuotes.values()],
    state: {
      stocks: state.stocks,
      groups: state.groups,
      holdingCodes: state.holdingCodes,
      watchCodes: state.watchCodes,
      focusCodes: state.focusCodes,
      statusBarStockCodes: state.statusBarStockCodes,
      strategyUpdatedAt: state.strategyUpdatedAt,
      strategyMatchCount: state.strategyMatchCount,
    },
  }
}

/** Route one request under `/leek-fund/api`. */
export async function handleApiRequest(
  deps: ApiDeps,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  const method = pathname.startsWith('/leek-fund/api/') ? pathname.slice('/leek-fund/api/'.length) : undefined
  if (method === undefined || method.includes('/')) {
    writeError(res, new ApiError(404, `unknown API method "${pathname}"`))
    return
  }
  if (req.method !== 'POST') {
    writeError(res, new ApiError(405, 'method not allowed'))
    return
  }
  try {
    const payload = await readJsonBody(req)
    switch (method) {
      case 'snapshot':
        writeOk(res, await buildSnapshot(deps))
        return
      case 'search':
        writeOk(res, {
          results: await searchAStocks(requireString(payload.keyword, 'keyword'), deps.timeoutMs),
        })
        return
      case 'quoteDetail':
        writeOk(res, await fetchDetailCached(requireString(payload.code, 'code').toLowerCase(), deps))
        return
      case 'marketOverview':
        writeOk(res, await fetchMarketOverview(deps.timeoutMs))
        return
      case 'mutate': {
        const op = requireString(payload.op, 'op')
        const args = (typeof payload.args === 'object' && payload.args !== null
          ? payload.args
          : {}) as Record<string, unknown>
        let outcome: MutationResult
        await deps.store.mutate((state) => {
          outcome = mutateOp(state, op, args)
        })
        if (!outcome!.ok) writeOk(res, { ok: false, error: outcome!.error })
        else {
          // groupCreate returns the new group id so the client can expand it.
          const data = op === 'groupCreate' ? { id: outcome!.state.groups.at(-1)?.id } : undefined
          writeOk(res, data ? { ok: true, data } : { ok: true })
        }
        return
      }
      case 'reorder': {
        const kind = requireString(payload.kind, 'kind')
        const args = (typeof payload.args === 'object' && payload.args !== null
          ? payload.args
          : {}) as Record<string, unknown>
        let outcome: MutationResult
        await deps.store.mutate((state) => {
          switch (kind) {
            case 'stock':
              outcome = reorderStock(
                state,
                requireString(args.code, 'code'),
                asOptionalString(args.targetGroupId),
                asOptionalString(args.beforeCode)
              )
              return outcome
            case 'group':
              outcome = reorderGroup(state, requireString(args.id, 'id'), asOptionalString(args.beforeId))
              return outcome
            case 'mark': {
              const mark = asOptionalString(args.mark)
              if (mark !== 'holding' && mark !== 'watch' && mark !== 'focus') {
                outcome = { ok: false, error: `无效标记: ${String(args.mark)}`, state }
                return outcome
              }
              outcome = reorderMark(
                state,
                mark,
                requireString(args.code, 'code'),
                asOptionalString(args.beforeCode)
              )
              return outcome
            }
            default:
              outcome = { ok: false, error: `未知重排类型: ${kind}`, state }
              return outcome
          }
        })
        if (!outcome!.ok) writeOk(res, { ok: false, error: outcome!.error })
        else writeOk(res, { ok: true })
        return
      }
      default:
        writeError(res, new ApiError(404, `unknown API method "${method}"`))
    }
  } catch (error) {
    writeError(res, error)
  }
}
