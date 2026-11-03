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
import { alertPath, createAlertStore, startAlertMonitor } from './alerts.js'
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
  /** Timeout for market data / search requests, in milliseconds. */
  timeoutMs?: number
  /**
   * Where the「行情」tab is registered: the official right Sidebar (default) or
   * the session workspace tab bar (the row with「对话」「上下文」「文件」).
   */
  location?: 'sidebar' | 'workspace'
}

export const Config: Schema<Config> = Schema.object({
  timeoutMs: Schema.number().default(8000),
  location: Schema.union([
    Schema.const('sidebar').description('侧边栏（右侧栏 Tab）'),
    Schema.const('workspace').description('工作区（会话顶部 Tab）'),
  ])
    .default('sidebar')
    .volatile()
    .description('行情 Tab 注册位置'),
})

export const inject = ['tools', 'webServer']

export function apply(ctx: Context, config: Config) {
  const store = createStateStore()
  const alerts = createAlertStore(alertPath(store))
  const timeoutMs = config.timeoutMs ?? 8000
  registerTools(ctx, { store, timeoutMs, alerts })

  // Owned by the host plugin lifecycle; one timer serves all connected windows.
  ctx.effect(() => startAlertMonitor(alerts, timeoutMs, (error) => {
    ctx.logger.error('[leek-fund] alert monitor failed: %s', String(error))
  }), 'dsh-leek-fund: alert monitor')

  const deps: ApiDeps = { store, timeoutMs, alerts }
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

  // Project this plugin's `Config` (the live-editable `location` field) into the
  // host settings document, so Settings → Plugins → dsh-leek-fund can edit the
  // tab placement. `auto: false` keeps the value out of the static profile
  // config and in the user settings document instead.
  const settingsHost = ctx as unknown as {
    fiber?: unknown
    inject?: (
      deps: string[],
      callback: (child: {
        effect: (setup: () => unknown, name?: string) => unknown
        settings: { configure: (presentation: { auto: boolean }, owner: unknown) => unknown }
      }) => void
    ) => void
  }
  settingsHost.inject?.(['settings'], (child) => {
    child.effect(
      () => child.settings.configure({ auto: false }, settingsHost.fiber),
      'dsh-leek-fund: settings projection'
    )
  })
}
