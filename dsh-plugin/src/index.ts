/**
 * dsh-leek-fund: LeekFund stock tools for DeepSeek Harness.
 *
 * Host half: registers a model-facing tool set (quotes, A-share search,
 * watchlist, two-level groups, holding/watch marks) and the `/leek-fund/api`
 * HTTP routes consumed by the sidebar client tab, backed by a durable JSON
 * state file.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { handleApiRequest, isTrustedApiRequest, writeJson, type ApiDeps } from './api.js'
import { categoryOf, createStateStore, updateStrategyGroup } from './state.js'
import { evaluateBatch, isInTradingHours } from './strategy.js'
import { registerTools } from './tools.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Named HTTP route registry of the web GUI host (dsh-host-webserver). */
    webServer: {
      register(route: {
        kind: 'exact' | 'prefix'
        path: string
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
      }): () => void
    }
  }
}

export const name = 'leek-fund'

export interface Config {
  /** Absolute path of the JSON state file. Defaults to
   * `$DSH_HOME/leek-fund/state.json` (or `./.dsh-leek-fund/state.json`). */
  dataPath?: string
  /** Timeout for market data / search requests, in milliseconds. */
  timeoutMs?: number
}

export const Config: Schema<Config> = Schema.object({
  dataPath: Schema.string(),
  timeoutMs: Schema.number().default(8000),
})

export const inject = ['tools', 'webServer']

export function apply(ctx: Context, config: Config) {
  const store = createStateStore(config.dataPath)
  const timeoutMs = config.timeoutMs ?? 8000
  registerTools(ctx, { store, timeoutMs })

  const deps: ApiDeps = { store, timeoutMs }
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/leek-fund/api',
        handler: async (req, res) => {
          if (!isTrustedApiRequest(req)) {
            writeJson(res, 403, { ok: false, error: 'forbidden' })
            return
          }
          const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
          await handleApiRequest(deps, req, res, pathname)
        },
      }),
    'dsh-leek-fund: /leek-fund/api routes'
  )

  // ── Strategy evaluation scheduler (every 30 min during trading hours) ──
  const STRATEGY_INTERVAL_MS = 30 * 60 * 1000
  let strategyTimer: ReturnType<typeof setInterval> | undefined

  async function runStrategyEvaluation(): Promise<void> {
    if (!isInTradingHours()) return

    try {
      const state = await store.load()
      const aStockCodes = state.stocks.filter((code) => categoryOf(code) === 'A')
      if (aStockCodes.length === 0) return

      // Build a name map from the state (we don't have names here,
      // but they're not critical for evaluation)
      const result = await evaluateBatch(aStockCodes, undefined, timeoutMs)

      if (result.matched.length > 0 || result.failed.length > 0) {
        await store.mutate((state) => {
          updateStrategyGroup(state, result.matched)
          ctx.logger.info(
            '[leek-fund] 策略选股完成: %d 匹配, %d 失败, %d 跳过',
            result.matched.length,
            result.failed.length,
            result.skipped.length,
          )
        })
      }
    } catch (error) {
      ctx.logger.error('[leek-fund] 策略选股调度异常: %s', String(error))
    }
  }

  // Run once shortly after startup (with a delay to let the plugin settle),
  // then every 30 minutes.
  const startupTimer = setTimeout(() => {
    void runStrategyEvaluation()
    strategyTimer = setInterval(() => void runStrategyEvaluation(), STRATEGY_INTERVAL_MS)
  }, 15_000)

  ctx.effect(
    () => {
      // The effect disposal is registered immediately; cleanup runs on unload.
      return () => {
        clearTimeout(startupTimer)
        if (strategyTimer) {
          clearInterval(strategyTimer)
          strategyTimer = undefined
        }
      }
    },
    'dsh-leek-fund: strategy scheduler',
  )

  // Warm up the state file on load so a broken/absent data directory fails
  // early with an actionable error instead of on the first call.
  void store
    .load()
    .then(() => {
      ctx.logger.info('[leek-fund] loaded, state: %s', store.path)
    })
    .catch((error: unknown) => {
      ctx.logger.error('[leek-fund] failed to load state: %s', String(error))
    })
}
