/**
 * Client half of dsh-leek-fund: registers the「行情」tab on the
 * dsh-sidebar service. The browser bundle is built by tsdown and
 * served by the DSH client-modules runtime at /plugins/dsh-leek-fund/client.js.
 */
import type {} from 'dsh-sidebar/client/service'
import type { Context } from 'cordis'
import { QuotesIcon } from './icons.js'
import { StockTreeView } from './StockTree.js'

export const inject = ['betterSidebar']

export function apply(ctx: Context): void {
  ctx.effect(() =>
    ctx.betterSidebar.registerTab({
      id: 'leek-fund:quotes',
      title: '行情',
      icon: <QuotesIcon />,
      order: 60,
      single: true,
      component: ({ scope, visible, tab, ctx }) => (
        <StockTreeView sessionId={scope.sessionId} visible={visible} tab={tab} ctx={ctx} />
      ),
    }),
    'dsh-leek-fund: quotes tab'
  )
}
