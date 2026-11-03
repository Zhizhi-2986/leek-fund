/**
 * Client half of dsh-leek-fund: registers the「行情」view at one of two places,
 * chosen by the plugin's `location` setting —
 *
 *   - `sidebar` (default): the official right Sidebar's tab type, registered
 *     into `ctx.sidebarRightTabs` with its body in the keyed
 *     `sidebar.right.pane.tab` seat.
 *   - `workspace`: a session workspace tab (`conversation.view`), the row that
 *     also hosts「对话」「上下文」「文件」.
 *
 * The choice is edited on the Plugins page (Settings → Plugins → dsh-leek-fund):
 * the host projects the plugin's volatile `location` config into the settings
 * document, and `ctx.get('configForms')` reads/writes it here. The mount follows
 * the form, so switching takes effect immediately.
 *
 * The browser bundle is built by tsdown and served by the DSH client-modules
 * runtime at /plugins/dsh-leek-fund/client.js.
 */
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { QuotesIcon } from './icons.js'
import { StockTreeView } from './StockTree.js'
import { notificationMonitor } from './notification.js'

/** This implementation's identity in the tab systems; also the body's registration key. */
const ID = 'dsh-leek-fund'

/** The kind a page of this type is opened as (`ctx.sidebarRight.openTab('leek-fund')`). */
const KIND = 'leek-fund'

/** Host settings namespace carrying the placement preference (the plugin's row id). */
const SETTINGS_NAMESPACE = 'leek-fund'

/** Namespace alias accepted when a build addresses the bundle by its package name. */
const SETTINGS_NAMESPACE_ALIAS = 'dsh-leek-fund'

/** The plugin's bundle name: the key its settings card registers under. */
const BUNDLE_NAME = 'dsh-leek-fund'

/** Tree state key for the workspace tab (its expansion set is parked per tab id). */
const WORKSPACE_TAB_ID = 'leek-fund-workspace'

/** Required browser services: the right-Sidebar tab registry and the extension seats. */
export const inject = ['slots', 'sidebarRightTabs']

/** Where the「行情」view is registered. */
type TabLocation = 'sidebar' | 'workspace'

interface SettingsSnapshot {
  status?: string
  writable?: boolean
  revision?: number
  value?: { location?: unknown }
}

/** The slice of the host config form this plugin uses (see @deepseek-ai/dsh-settings). */
interface SettingsForm {
  getSnapshot(): SettingsSnapshot
  set?(field: string, value: unknown): Promise<boolean>
  subscribe?(listener: () => void): () => void
}

interface ConfigFormsService {
  get(namespace: string): SettingsForm | undefined
}

/** Read the placement preference, tolerating absent or not-yet-ready forms. */
function readLocation(form: SettingsForm | undefined): TabLocation {
  const value = form?.getSnapshot().value
  return value?.location === 'workspace' ? 'workspace' : 'sidebar'
}

/** Locate this plugin's settings form (host row id first, bundle alias second). */
function findSettingsForm(ctx: Context): SettingsForm | undefined {
  const service = (ctx as unknown as { get?: (key: string) => ConfigFormsService | undefined }).get?.('configForms')
  if (service === undefined || typeof service.get !== 'function') return undefined
  return service.get(SETTINGS_NAMESPACE) ?? service.get(SETTINGS_NAMESPACE_ALIAS)
}

/**
 * The tab type's static face: a page type — no address patterns — with one guide
 * entry box, which is how a user opens it from the column's add control.
 * @returns the definition to register.
 */
function quotesDefinition(): SidebarRightTabDefinition {
  return {
    id: ID,
    kind: KIND,
    priority: 'extension',
    title: () => '行情',
    guide: [{
      order: 60,
      title: () => '行情',
      description: () => 'A 股自选、分组与实时行情',
      icon: QuotesIcon,
    }],
  }
}

/**
 * The body the seat dispatches this type's tabs to.
 * @param props - the framework's runtime share, carrying the slot-owned tab hook.
 * @returns the stock tree of the tab it was dispatched for.
 */
function QuotesBody({ useTabInfo }: PropsRuntime<'sidebar.right.pane.tab'>): ReactNode {
  const { tab } = useTabInfo()
  return <StockTreeView tabId={tab.id} visible={tab.visible} />
}

/**
 * The body a session workspace tab renders. The workspace view owns no tab
 * metadata, so it keeps one fixed tree state key and stays visible.
 * @returns the stock tree.
 */
function WorkspaceBody(): ReactNode {
  return <StockTreeView tabId={WORKSPACE_TAB_ID} visible />
}

/**
 * Plugins-page card: choose where the「行情」view is registered.
 * @param props - this plugin's settings form, captured when the card registers.
 * @returns the card content.
 */
function PlacementCard({ form }: { form?: SettingsForm | undefined }): ReactNode {
  const [location, setLocation] = useState<TabLocation>(() => readLocation(form))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (form === undefined) return
    setLocation(readLocation(form))
    const off = form.subscribe?.(() => setLocation(readLocation(form)))
    return () => {
      off?.()
    }
  }, [form])

  const choose = async (next: TabLocation): Promise<void> => {
    if (form?.set === undefined) return
    setBusy(true)
    setError(undefined)
    try {
      const accepted = await form.set('location', next)
      if (accepted) setLocation(next)
      else setError('保存失败，请重试')
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: '8px', fontSize: '13px', lineHeight: 1.6 }}>
      <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 600 }}>行情 Tab 注册位置</h3>
      {form === undefined ? (
        <p style={{ margin: 0, opacity: 0.8 }}>当前宿主未提供插件配置服务，行情保持注册在右侧栏。</p>
      ) : (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="radio"
              name="dsh-leek-fund-location"
              checked={location === 'sidebar'}
              disabled={busy}
              onChange={() => void choose('sidebar')}
            />
            侧边栏
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="radio"
              name="dsh-leek-fund-location"
              checked={location === 'workspace'}
              disabled={busy}
              onChange={() => void choose('workspace')}
            />
            工作区
          </label>
          <p style={{ margin: 0, opacity: 0.8 }}>
            侧边栏：右侧栏的「行情」Tab；工作区：会话顶部 Tab（与「对话」「文件」同排）。切换后立即生效。
          </p>
          {error === undefined ? null : (
            <p style={{ margin: 0, color: 'var(--dsw-alias-label-error, #c62828)' }}>{error}</p>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Client plugin body: register the settings card, mount the view at the
 * configured place (the right Sidebar by default), and follow the settings
 * form so a placement change remounts without a reload.
 * @param ctx - client root context carrying the registry and the slot seats.
 */
export function apply(ctx: Context): void {
  // The client plugin outlives any sidebar/workspace tab body. Never attach
  // notification delivery to StockTreeView: inactive tabs unmount their body.
  ctx.effect(() => notificationMonitor.start(), 'dsh-leek-fund: alert notifications')
  const form = findSettingsForm(ctx)
  let disposeView: (() => void) | undefined
  let mounted: TabLocation | undefined

  /** Tear the current mount down and register the view at `location`. */
  const mount = (location: TabLocation): void => {
    if (mounted === location) return
    mounted = location
    disposeView?.()
    disposeView = undefined
    if (location === 'workspace') {
      disposeView = ctx.slots.inject('conversation.view', () => ctx.slots.register(
        { name: 'conversation.view', id: ID, order: 40, label: () => '行情' },
        WorkspaceBody,
      ))
      return
    }
    const disposeType = ctx.effect(
      () => ctx.sidebarRightTabs.register(quotesDefinition()),
      'dsh-leek-fund: quotes tab type',
    )
    const disposeBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
      { name: 'sidebar.right.pane.tab', key: ID },
      QuotesBody,
    ))
    disposeView = () => {
      disposeType?.()
      disposeBody?.()
    }
  }

  mount('sidebar')
  if (form !== undefined) {
    const follow = (): void => mount(readLocation(form))
    const off = form.subscribe?.(follow)
    follow()
    ctx.effect(
      () => () => {
        off?.()
      },
      'dsh-leek-fund: settings subscription',
    )
  }

  ctx.effect(
    () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
      { name: 'plugins.bundle.config', key: BUNDLE_NAME },
      (props: { view?: string } | undefined) => (
        props?.view === 'summary' ? '行情 Tab 注册位置' : <PlacementCard form={form} />
      ),
    )),
    'dsh-leek-fund: settings card',
  )

  ctx.effect(
    () => () => {
      disposeView?.()
    },
    'dsh-leek-fund: view mount',
  )
}
