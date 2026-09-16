/**
 * Client half of dsh-leek-fund: registers the「行情」tab type on the official
 * right Sidebar, not on the third-party dsh-sidebar plugin.
 *
 * The path is the public two-stage one the built-in files/text types take: the
 * static type definition into `ctx.sidebarRightTabs`, its body into the keyed
 * `sidebar.right.pane.tab` seat under that definition's `id`. The body reads its
 * live tab record through the slot-injected `useTabInfo()` hook, so it needs no
 * prop passed down from the seat.
 *
 * The browser bundle is built by tsdown and served by the DSH client-modules
 * runtime at /plugins/dsh-leek-fund/client.js.
 */
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { QuotesIcon } from './icons.js'
import { StockTreeView } from './StockTree.js'

/** This implementation's identity in the tab system; also the body's registration key. */
const ID = 'dsh-leek-fund'

/** The kind a page of this type is opened as (`ctx.sidebarRight.openTab('leek-fund')`). */
const KIND = 'leek-fund'

/** Required browser services: the right-Sidebar tab registry and the keyed extension seats. */
export const inject = ['slots', 'sidebarRightTabs']

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
 * Client plugin body: register the type, then the body under the same `id`.
 * @param ctx - client root context carrying the registry and the slot seats.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.sidebarRightTabs.register(quotesDefinition()), 'dsh-leek-fund: quotes tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: ID },
    QuotesBody,
  )), 'dsh-leek-fund: quotes tab body')
}
