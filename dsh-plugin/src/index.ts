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
import { createStateStore } from './state.js'
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
