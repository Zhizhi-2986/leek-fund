/**
 * LeekFund stock tree: A-share watchlist grouped into holdings / watch /
 * ungroupped / custom groups (two levels), with 2s live quotes, red-up
 * green-down colors, group up/down/flat summaries, drag reordering, a right
 * click menu and the top ticker. Parity with the Hermes Desktop plugin.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { displayPrice, formatPercent } from '../quote.js'
import { categoryOf, fetchSnapshot, mutate, reorder, type Snapshot } from './api.js'
import { MoveDialog } from './MoveDialog.js'
import { StockDetail } from './StockDetail.js'
import { CollapseAllIcon, PlusIcon, RefreshIcon } from './icons.js'
import { SearchDialog } from './SearchDialog.js'
import { TopTicker } from './TopTicker.js'
import type { Group, Quote } from './types.js'
import s from './styles.module.css'

const REFRESH_MS = 2000

type StockListKey = 'holding' | 'focus' | 'watch' | 'ungroupped' | `group:${string}`

interface StockDrag {
  kind: 'stock'
  code: string
  list: StockListKey
}

interface GroupDrag {
  kind: 'group'
  id: string
}

type DragPayload = StockDrag | GroupDrag

interface MenuItem {
  label: string
  danger?: boolean
  action: () => void
}

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

interface DropHint {
  targetCode?: string
  position?: 'before' | 'after'
  groupId?: string
}

function priceClass(percent: number): string {
  if (percent > 0) return s.up
  if (percent < 0) return s.down
  return s.flat
}

function quoteLine(quote: Quote | undefined): { price: string; percent: string; cls: string } {
  if (!quote) return { price: '--', percent: '--', cls: s.flat }
  return {
    price: displayPrice(quote.code, quote.name, quote.price),
    percent: formatPercent(quote.percent),
    cls: priceClass(quote.percent),
  }
}

function summarize(codes: string[], quotes: Map<string, Quote>): string {
  let up = 0
  let down = 0
  let flat = 0
  for (const code of codes) {
    const quote = quotes.get(code)
    if (!quote) continue
    if (quote.percent > 0) up += 1
    else if (quote.percent < 0) down += 1
    else flat += 1
  }
  return `↑${up} ↓${down} =${flat}`
}

/** Read the drag payload synchronously (native event lifetime rules). */
function readDrag(event: React.DragEvent): DragPayload | undefined {
  const raw = event.dataTransfer.getData('text/plain')
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as DragPayload
  } catch {
    return undefined
  }
}

export function StockTreeView({
  visible,
  tab,
  ctx,
}: {
  sessionId: string
  visible: boolean
  tab: { id: string; meta?: unknown }
  ctx: { betterSidebar: { updateTab(tabId: string, patch: { meta?: unknown }): void } }
}): JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set((tab.meta as { expanded?: string[] } | undefined)?.expanded ?? [])
  )
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState<{ code: string; name: string; currentGroupId?: string } | null>(null)
  const [dropHint, setDropHint] = useState<DropHint | null>(null)
  const [dragging, setDragging] = useState<DragPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const suppressClick = useRef(false)
  const [expandedDetail, setExpandedDetail] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const data = await fetchSnapshot(controller.signal)
      setSnapshot(data)
      setError(null)

    } catch (err) {
      if (controller.signal.aborted) return
      setError(String(err))
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => {
      clearInterval(timer)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [visible, load])

  // Persist the expansion set on the tab instance so switching sessions
  // restores each conversation's own collapsed/expanded state.
  useEffect(() => {
    ctx.betterSidebar.updateTab(tab.id, {
      meta: { ...(tab.meta as Record<string, unknown> | undefined), expanded: [...expanded] },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, tab.id, ctx])

  // Close the context menu on any outside click.
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  const quotes = useMemo(() => {
    const map = new Map<string, Quote>()
    for (const quote of snapshot?.quotes ?? []) map.set(quote.code, quote)
    return map
  }, [snapshot])

  const tree = useMemo(() => {
    if (!snapshot) return null
    const state = snapshot.state
    const aStocks = state.stocks.filter((code) => categoryOf(code) === 'A')
    const grouped = new Set<string>()
    for (const group of state.groups) for (const code of group.stockCodes) grouped.add(code)
    const ungroupped = aStocks.filter((code) => !grouped.has(code))
    const aGroups = state.groups.filter((group) => group.category === 'A')
    const topGroups = aGroups.filter((group) => !group.parentId)
    const childrenOf = (groupId: string): Group[] => aGroups.filter((group) => group.parentId === groupId)
    const holding = (state.holdingCodes ?? []).filter((code) => categoryOf(code) === 'A')
    // Holdings are not shown in the key-focus group (focusCodes still keep
    // the mark; only the display excludes holdings).
    const focus = (state.focusCodes ?? [])
      .filter((code) => categoryOf(code) === 'A')
      .filter((code) => !(state.holdingCodes ?? []).includes(code))
    const watch = (state.watchCodes ?? []).filter((code) => categoryOf(code) === 'A')
    return { aStocks, ungroupped, topGroups, childrenOf, holding, focus, watch }
  }, [snapshot])

  const showError = useCallback((message: string) => {
    setError(message)
  }, [])

  function openMenu(x: number, y: number, items: MenuItem[]): void {
    setMenu({ x, y, items })
  }

  /** Toggle one expansion key (builtin groups use 'builtin:*', groups use their id). */
  function toggleKey(key: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ── stock row context menu ──────────────────────────────────────────────
  function stockMenu(event: React.MouseEvent, code: string, list: StockListKey): void {
    event.preventDefault()
    event.stopPropagation()
    const name = quotes.get(code)?.name ?? code
    const isHolding = (snapshot?.state.holdingCodes ?? []).includes(code)
    const isFocus = (snapshot?.state.focusCodes ?? []).includes(code)
    const inTicker = snapshot?.state.statusBarStockCodes.includes(code) ?? false
    const items: MenuItem[] = [
      {
        label: isFocus ? '取消重点关注' : '标记重点关注',
        action: () => void runMutate('mark', { code, mark: 'focus', value: !isFocus }),
      },
      {
        label: '移动到…',
        action: () => {
          const current = list.startsWith('group:') ? list.slice('group:'.length) : undefined
          setMoveTarget({ code, name, currentGroupId: current })
        },
      },
      {
        label: isHolding ? '取消持仓' : '标记持仓',
        action: () => void runMutate('mark', { code, mark: 'holding', value: !isHolding }),
      },
      {
        label: inTicker ? '移出平铺条' : '加入平铺条',
        action: () => void runMutate('statusBar', { code, value: !inTicker }),
      },
      { label: '删除', danger: true, action: () => void runMutate('remove', { code }) },
    ]
    openMenu(event.clientX, event.clientY, items)
  }

  // ── group title context menu ────────────────────────────────────────────
  function groupMenu(event: React.MouseEvent, group: Group): void {
    event.preventDefault()
    event.stopPropagation()
    const items: MenuItem[] = group.parentId
      ? [
          { label: '重命名', action: () => {
            const name = window.prompt('新名称', group.name)
            if (name && name !== group.name) void runMutate('groupRename', { id: group.id, name })
          } },
          {
            label: '删除分组（保留股票）',
            danger: true,
            action: () => {
              if (window.confirm(`删除分组「${group.name}」？组内股票将回到关注。`)) {
                void runMutate('groupDelete', { id: group.id })
              }
            },
          },
        ]
      : [
      {
        label: '创建二级分组',
        action: () => {
          const name = window.prompt('二级分组名称')
          if (name) void runMutate('groupCreate', { name, category: group.category, parentId: group.id })
        },
      },
      { label: '重命名', action: () => {
        const name = window.prompt('新名称', group.name)
        if (name && name !== group.name) void runMutate('groupRename', { id: group.id, name })
      } },
      {
        label: '删除分组（保留股票）',
        danger: true,
        action: () => {
          if (window.confirm(`删除分组「${group.name}」及其二级分组？组内股票将回到关注。`)) {
            void runMutate('groupDelete', { id: group.id })
          }
        },
      },
    ]
    openMenu(event.clientX, event.clientY, items)
  }

  async function runMutate(op: string, args: Record<string, unknown>): Promise<void> {
    try {
      const res = await mutate(op, args)
      await load()
      if (op === 'groupCreate') {
        const id = res.data?.id
        if (id) {
          // Expand the new first-level group (or its parent for a second-level
          // group) so freshly created groups are immediately visible.
          setExpanded((prev) => {
            const next = new Set(prev)
            next.add(id)
            if (typeof args.parentId === 'string') next.add(args.parentId)
            return next
          })
        }
      }
    } catch (err) {
      showError(String(err))
    }
  }

  // ── drag & drop ─────────────────────────────────────────────────────────
  function startDrag(event: React.DragEvent, payload: DragPayload): void {
    event.dataTransfer.setData('text/plain', JSON.stringify(payload))
    event.dataTransfer.effectAllowed = 'move'
    setDragging(payload)
  }

  function endDrag(): void {
    setDragging(null)
    setDropHint(null)
  }

  /** Stock row drop target: same-list reorder or cross-group move. */
  function onStockDrop(event: React.DragEvent, targetCode: string, list: StockListKey): void {
    event.preventDefault()
    const payload = readDrag(event)
    endDrag()
    if (!payload || payload.kind !== 'stock') return
    if (payload.code === targetCode) return
    const rect = event.currentTarget.getBoundingClientRect()
    const position: 'before' | 'after' = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    const listCodes = listCodesOf(list)
    const targetIndex = listCodes.indexOf(targetCode)
    const beforeCode = position === 'before' ? targetCode : listCodes[targetIndex + 1]
    // Holding / watch / focus are overlay mark lists: they only reorder
    // within themselves (never drag between mark lists or real groups).
    if (list === 'holding' || list === 'watch' || list === 'focus') {
      if (payload.list !== list) return
      void runReorder('mark', { mark: list, code: payload.code, beforeCode })
      return
    }
    const args: Record<string, unknown> = { code: payload.code, beforeCode }
    if (list.startsWith('group:')) args.targetGroupId = list.slice('group:'.length)
    else if (list === 'ungroupped') args.targetGroupId = undefined
    void runReorder('stock', args)
  }

  /** Group title drop target: reorder group siblings, or move a stock here. */
  function onGroupDrop(event: React.DragEvent, group: Group): void {
    event.preventDefault()
    const payload = readDrag(event)
    endDrag()
    if (!payload) return
    if (payload.kind === 'group') {
      if (payload.id === group.id) return
      void runReorder('group', { id: payload.id, beforeId: group.id })
      return
    }
    // A stock dropped onto the group title appends to that group.
    void runReorder('stock', { code: payload.code, targetGroupId: group.id })
  }

  /** Ungroupped section title area is not a drop target; rows handle drops. */

  function listCodesOf(list: StockListKey): string[] {
    if (!tree) return []
    switch (list) {
      case 'holding':
        return tree.holding
      case 'focus':
        return tree.focus
      case 'watch':
        return tree.watch
      case 'ungroupped':
        return tree.ungroupped
      default: {
        const group = snapshot?.state.groups.find((item) => item.id === list.slice('group:'.length))
        return group ? group.stockCodes.filter((code) => categoryOf(code) === 'A') : []
      }
    }
  }

  async function runReorder(kind: string, args: Record<string, unknown>): Promise<void> {
    try {
      await reorder(kind, args)
      await load()
    } catch (err) {
      showError(String(err))
    }
  }

  // ── render helpers ──────────────────────────────────────────────────────
  function renderStockRow(code: string, list: StockListKey, level: number): JSX.Element {
    const quote = quotes.get(code)
    const line = quoteLine(quote)
    const isHolding = (snapshot?.state.holdingCodes ?? []).includes(code)
    const hintKey = dropHint?.targetCode === code && !dropHint.groupId
      ? (dropHint.position === 'after' ? s.dropAfter : s.dropBefore)
      : ''
    return (
      <>
      <div
        key={code}
        className={`${s.stockRow} ${s[`level${level}`]} ${hintKey} ${dragging?.kind === 'stock' && dragging.code === code ? s.dragging : ''}`}
        draggable
        onDragStart={(event) => startDrag(event, { kind: 'stock', code, list })}
        onDragEnd={() => {
          suppressClick.current = true
          endDrag()
        }}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false
            return
          }
          setExpandedDetail((prev) => {
            const next = new Set(prev)
            if (next.has(code)) next.delete(code)
            else next.add(code)
            return next
          })
        }}
        onDragOver={(event) => {
          if (dragging?.kind === 'stock' && dragging.code !== code) {
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
            setDropHint({ targetCode: code, position })
          }
        }}
        onDragLeave={() => setDropHint((prev) => (prev?.targetCode === code ? null : prev))}
        onDrop={(event) => onStockDrop(event, code, list)}
        onContextMenu={(event) => stockMenu(event, code, list)}
      >
        <span className={s.stockName}>{quote?.name ?? code}</span>
        <span className={s.stockCode}>{code}</span>
        <span className={s.stockQuote}>
          <span className={`${s.stockPrice} ${line.cls}`}>{line.price}</span>
          <span className={`${s.stockPercent} ${line.cls}`}>{line.percent}</span>
        </span>
      </div>
      {expandedDetail.has(code) && (
        <StockDetail code={code} name={quote?.name ?? code} />
      )}
    </>
    )
  }

  function renderGroup(group: Group): JSX.Element {
    const children = tree?.childrenOf(group.id) ?? []
    const directCodes = group.stockCodes.filter((code) => categoryOf(code) === 'A')
    const childCodes = children.flatMap((child) => child.stockCodes.filter((code) => categoryOf(code) === 'A'))
    const summary = summarize([...new Set([...directCodes, ...childCodes])], quotes)
    const isOpen = expanded.has(group.id)
    return (
      <div key={group.id}>
        <div
          className={`${s.groupTitle} ${s.level0} ${dropHint?.groupId === group.id ? s.dropGroup : ''} ${dragging?.kind === 'group' && dragging.id === group.id ? s.dragging : ''}`}
          draggable
          onDragStart={(event) => startDrag(event, { kind: 'group', id: group.id })}
          onDragEnd={endDrag}
          onDragOver={(event) => {
            event.preventDefault()
            setDropHint({ groupId: group.id })
          }}
          onDragLeave={() => setDropHint((prev) => (prev?.groupId === group.id ? null : prev))}
          onDrop={(event) => onGroupDrop(event, group)}
          onContextMenu={(event) => groupMenu(event, group)}
          onClick={() =>
            setExpanded((prev) => {
              const next = new Set(prev)
              if (next.has(group.id)) next.delete(group.id)
              else next.add(group.id)
              return next
            })
          }
        >
          <span
            className={`${s.caret} ${isOpen ? s.caretOpen : ''}`}
            onClick={(event) => {
              event.stopPropagation()
              setExpanded((prev) => {
                const next = new Set(prev)
                if (next.has(group.id)) next.delete(group.id)
                else next.add(group.id)
                return next
              })
            }}
          >
            ▶
          </span>
          <span>{group.name}</span>
          <span className={s.groupSummary}>{summary}</span>
        </div>
        {isOpen && (
          <div>
            {children.map((child) => {
              const childOpen = expanded.has(child.id)
              return (
              <div key={child.id}>
                <div
                  className={`${s.groupTitle} ${s.level1} ${dropHint?.groupId === child.id ? s.dropGroup : ''}`}
                  draggable
                  onDragStart={(event) => startDrag(event, { kind: 'group', id: child.id })}
                  onDragEnd={endDrag}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDropHint({ groupId: child.id })
                  }}
                  onDragLeave={() => setDropHint((prev) => (prev?.groupId === child.id ? null : prev))}
                  onDrop={(event) => onGroupDrop(event, child)}
                  onContextMenu={(event) => groupMenu(event, child)}
                  onClick={() => toggleKey(child.id)}
                >
                  <span className={`${s.caret} ${childOpen ? s.caretOpen : ''}`}>▶</span>
                  <span>{child.name}</span>
                  <span className={s.groupSummary}>
                    {summarize(child.stockCodes.filter((code) => categoryOf(code) === 'A'), quotes)}
                  </span>
                </div>
                {childOpen && directCodesOf(child).map((code) => renderStockRow(code, `group:${child.id}`, 2))}
              </div>
              )
            })}
            {directCodes.map((code) => renderStockRow(code, `group:${group.id}`, 1))}
          </div>
        )}
      </div>
    )
  }

  function directCodesOf(group: Group): string[] {
    return group.stockCodes.filter((code) => categoryOf(code) === 'A')
  }

  return (
    <div className={s.root}>
      <TopTicker quotes={snapshot?.indexQuotes ?? []} />
      <div className={s.toolbar}>
        <button className={s.addButton} onClick={() => setSearchOpen(true)}>
          <PlusIcon /> 添加股票
        </button>
        <button className={s.addButton} onClick={() => {
          const name = window.prompt('分组名称')
          if (name) void runMutate('groupCreate', { name, category: 'A' })
        }}>
          新建分组
        </button>
        <button
          className={s.refreshButton}
          title="全部分组折叠"
          onClick={() => setExpanded(new Set())}
        >
          <CollapseAllIcon />
        </button>
        <button className={s.refreshButton} title="刷新" onClick={() => void load()}>
          <RefreshIcon />
        </button>
      </div>
      {error && <div className={s.error}>{error}</div>}
      <div className={s.tree}>
        {!tree && <div className={s.hint}>加载中…</div>}
        {tree && (
          <>
            <div
              className={`${s.groupTitle} ${s.level0}`}
              onClick={() => toggleKey('builtin:holding')}
            >
              <span className={`${s.caret} ${expanded.has('builtin:holding') ? s.caretOpen : ''}`}>▶</span>
              <span>持仓股</span>
              <span className={s.groupSummary}>{summarize(tree.holding, quotes)}</span>
            </div>
            {expanded.has('builtin:holding') && tree.holding.map((code) => renderStockRow(code, 'holding', 1))}
            <div
              className={`${s.groupTitle} ${s.level0}`}
              onClick={() => toggleKey('builtin:focus')}
            >
              <span className={`${s.caret} ${expanded.has('builtin:focus') ? s.caretOpen : ''}`}>▶</span>
              <span>重点关注</span>
              <span className={s.groupSummary}>{summarize(tree.focus, quotes)}</span>
            </div>
            {expanded.has('builtin:focus') && tree.focus.map((code) => renderStockRow(code, 'focus', 1))}
            <div
              className={`${s.groupTitle} ${s.level0}`}
              onClick={() => toggleKey('builtin:watch')}
            >
              <span className={`${s.caret} ${expanded.has('builtin:watch') ? s.caretOpen : ''}`}>▶</span>
              <span>关注</span>
              <span className={s.groupSummary}>{summarize(tree.ungroupped, quotes)}</span>
            </div>
            {expanded.has('builtin:watch') && tree.ungroupped.map((code) => renderStockRow(code, 'ungroupped', 1))}
            {tree.topGroups.map((group) => renderGroup(group))}
          </>
        )}
      </div>
      {searchOpen && (
        <SearchDialog
          onClose={() => setSearchOpen(false)}
          onAdded={() => void load()}
          onError={showError}
        />
      )}
      {moveTarget && tree && (
        <MoveDialog
          code={moveTarget.code}
          name={moveTarget.name}
          currentGroupId={moveTarget.currentGroupId}
          groups={tree ? snapshot?.state.groups.filter((group) => group.category === 'A') ?? [] : []}
          onClose={() => setMoveTarget(null)}
          onMoved={() => void load()}
          onError={showError}
        />
      )}
      {menu && (
        <div className={s.menu} style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
          {menu.items.map((item) => (
            <button
              key={item.label}
              className={s.menuItem}
              onClick={() => {
                setMenu(null)
                item.action()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

