/**
 * LeekFund Hermes Desktop plugin.
 *
 * Runtime target:
 *   $HERMES_HOME/desktop-plugins/leek-fund/plugin.js
 *
 * Hermes loads this file as plain ESM. Keep it single-file, use jsx()/jsxs(),
 * and only import modules provided by the Desktop plugin runtime.
 */

import {
  Button,
  Codicon,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  ScrollArea,
  Skeleton,
  Tip,
  cn,
  host,
  useMutation,
  usePluginI18n,
  useQuery,
  useQueryClient,
} from '@hermes/plugin-sdk';
import { useEffect, useRef, useState } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

const ID = 'leek-fund';
const SNAPSHOT_KEY = [ID, 'snapshot'];

function createApi(ctx) {
  const request = (path, method = 'GET', body) =>
    ctx.rest(path, {
      method,
      ...(body === undefined ? {} : { body }),
      timeoutMs: 12000,
    });

  return {
    snapshot: () => request('/snapshot'),
    searchStocks: (query) =>
      request(`/stock-search?q=${encodeURIComponent(query)}`),
    addStock: (code) => request('/stocks', 'POST', { code }),
    deleteStock: (code) =>
      request(`/stocks/${encodeURIComponent(code)}`, 'DELETE'),
    createGroup: (category, name) =>
      request('/groups', 'POST', { category, name }),
    renameGroup: (groupId, name) =>
      request(`/groups/${encodeURIComponent(groupId)}`, 'PATCH', { name }),
    deleteGroup: (groupId) =>
      request(`/groups/${encodeURIComponent(groupId)}`, 'DELETE'),
    moveStock: (code, groupId) =>
      request(`/stocks/${encodeURIComponent(code)}/group`, 'POST', {
        group_id: groupId,
      }),
    reorderStock: (code, targetGroupId, targetCode, placement) =>
      request(`/stocks/${encodeURIComponent(code)}/reorder`, 'POST', {
        target_group_id: targetGroupId,
        target_code: targetCode,
        placement,
      }),
    reorderGroup: (groupId, targetGroupId, placement) =>
      request(`/groups/${encodeURIComponent(groupId)}/reorder`, 'POST', {
        target_group_id: targetGroupId,
        placement,
      }),
    updateFlags: (code, flags) =>
      request(`/stocks/${encodeURIComponent(code)}/flags`, 'POST', flags),
  };
}

function useSnapshot(api) {
  return useQuery({
    queryKey: SNAPSHOT_KEY,
    queryFn: api.snapshot,
    refetchInterval: 2000,
    staleTime: 2000,
    retry: 1,
  });
}

function usePluginAction(api) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action) => action.run(api),
    onSuccess: (_data, action) => {
      queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
      if (action.success) {
        host.notify({ kind: 'success', message: action.success });
      }
    },
    onError: (error) => {
      host.notifyError(error, 'LeekFund 操作失败');
    },
  });
}

function dropPlacement(event) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
}

function useTreeDrag(onAction) {
  const [item, setItem] = useState(null);
  const [target, setTarget] = useState(null);
  const itemRef = useRef(null);

  const start = (event, nextItem) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', JSON.stringify(nextItem));
    itemRef.current = nextItem;
    setItem(nextItem);
    setTarget(null);
  };

  const end = () => {
    itemRef.current = null;
    setItem(null);
    setTarget(null);
  };

  const canDropOnGroup = (category, group) => {
    const currentItem = itemRef.current;
    if (!currentItem) return false;
    if (currentItem.kind === 'stock') {
      if (currentItem.category !== category) return false;
      const sourceOverlay =
        currentItem.groupId === 'holding' || currentItem.groupId === 'watch';
      const targetOverlay = group.id === 'holding' || group.id === 'watch';
      return sourceOverlay || targetOverlay
        ? sourceOverlay && currentItem.groupId === group.id
        : true;
    }
    return (
      currentItem.kind === 'group' &&
      !group.builtin &&
      currentItem.id !== group.id &&
      currentItem.category === category &&
      (currentItem.parentId || null) === (group.parent_id || null)
    );
  };

  const dragOverStock = (event, category, groupId, stockCode) => {
    const currentItem = itemRef.current;
    const sourceOverlay =
      currentItem?.groupId === 'holding' || currentItem?.groupId === 'watch';
    const targetOverlay = groupId === 'holding' || groupId === 'watch';
    if (
      currentItem?.kind !== 'stock' ||
      currentItem.code === stockCode ||
      currentItem.category !== category ||
      ((sourceOverlay || targetOverlay) && currentItem.groupId !== groupId)
    ) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setTarget({
      kind: 'stock',
      id: `${groupId}:${stockCode}`,
      placement: dropPlacement(event),
    });
  };

  const dropOnStock = (event, category, groupId, stockCode) => {
    const currentItem = itemRef.current;
    const sourceOverlay =
      currentItem?.groupId === 'holding' || currentItem?.groupId === 'watch';
    const targetOverlay = groupId === 'holding' || groupId === 'watch';
    if (
      currentItem?.kind !== 'stock' ||
      currentItem.code === stockCode ||
      currentItem.category !== category ||
      ((sourceOverlay || targetOverlay) && currentItem.groupId !== groupId)
    ) {
      return;
    }
    event.preventDefault();
    const placement = dropPlacement(event);
    onAction({
      run: (api) =>
        api.reorderStock(currentItem.code, groupId, stockCode, placement),
    });
    end();
  };

  const dragOverGroup = (event, category, group) => {
    if (!canDropOnGroup(category, group)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setTarget({
      kind: 'group',
      id: group.id,
      placement:
        itemRef.current.kind === 'group' ? dropPlacement(event) : 'inside',
    });
  };

  const dropOnGroup = (event, category, group) => {
    if (!canDropOnGroup(category, group)) return;
    const currentItem = itemRef.current;
    event.preventDefault();
    if (currentItem.kind === 'stock') {
      onAction({
        run: (api) => api.reorderStock(currentItem.code, group.id, '', 'after'),
      });
    } else {
      const placement = dropPlacement(event);
      onAction({
        run: (api) => api.reorderGroup(currentItem.id, group.id, placement),
      });
    }
    end();
  };

  return {
    item,
    target,
    start,
    end,
    dragOverStock,
    dropOnStock,
    dragOverGroup,
    dropOnGroup,
  };
}

function TextActionDialog({ dialog, onClose }) {
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue(dialog?.initial || '');
  }, [dialog]);

  if (!dialog) return null;

  const submit = () => {
    const next = value.trim();
    if (!next) return;
    dialog.submit(next);
    onClose();
  };

  return jsx(Dialog, {
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    children: jsxs(DialogContent, {
      className: 'max-w-sm',
      children: [
        jsx(DialogHeader, {
          children: jsx(DialogTitle, { children: dialog.title }),
        }),
        jsx(Input, {
          autoFocus: true,
          value,
          placeholder: dialog.placeholder,
          onChange: (event) => setValue(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter') submit();
          },
        }),
        jsxs(DialogFooter, {
          children: [
            jsx(Button, {
              variant: 'text',
              onClick: onClose,
              children: dialog.cancelLabel,
            }),
            jsx(Button, {
              disabled: !value.trim(),
              onClick: submit,
              children: dialog.submitLabel,
            }),
          ],
        }),
      ],
    }),
  });
}

function StockSearchDialog({ open, api, t, onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setQuery('');
      setItems([]);
      setIsSearching(false);
      setError('');
      return undefined;
    }

    const keyword = query.trim();
    if (!keyword) {
      setItems([]);
      setIsSearching(false);
      setError('');
      return undefined;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setIsSearching(true);
      setError('');
      api
        .searchStocks(keyword)
        .then((result) => {
          if (!active) return;
          setItems(Array.isArray(result?.items) ? result.items : []);
        })
        .catch(() => {
          if (!active) return;
          setItems([]);
          setError(t('stockSearchFailed'));
        })
        .finally(() => {
          if (active) setIsSearching(false);
        });
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, open, query, t]);

  return jsx(Dialog, {
    open,
    onOpenChange: (nextOpen) => {
      if (!nextOpen) onClose();
    },
    children: jsxs(DialogContent, {
      className: 'max-w-sm',
      children: [
        jsx(DialogHeader, {
          children: jsx(DialogTitle, { children: t('addStock') }),
        }),
        jsx(Input, {
          autoFocus: true,
          value: query,
          placeholder: t('stockSearchPlaceholder'),
          onChange: (event) => setQuery(event.target.value),
        }),
        jsx(ScrollArea, {
          className: 'h-64',
          style: { height: '16rem' },
          children: jsxs('div', {
            className: 'space-y-0.5 py-1',
            children: [
              isSearching
                ? jsx('div', {
                    className:
                      'px-2 py-3 text-center text-xs text-(--ui-text-tertiary)',
                    children: t('stockSearching'),
                  })
                : null,
              error
                ? jsx('div', {
                    className:
                      'px-2 py-3 text-center text-xs text-(--ui-danger)',
                    children: error,
                  })
                : null,
              !isSearching && !error && query.trim() && !items.length
                ? jsx('div', {
                    className:
                      'px-2 py-3 text-center text-xs text-(--ui-text-tertiary)',
                    children: t('stockSearchEmpty'),
                  })
                : null,
              !query.trim()
                ? jsx('div', {
                    className:
                      'px-2 py-3 text-center text-xs text-(--ui-text-tertiary)',
                    children: t('stockSearchHint'),
                  })
                : null,
              ...items.map((item) =>
                jsxs(
                  'button',
                  {
                    type: 'button',
                    className: cn(
                      'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs',
                      'hover:bg-(--chrome-action-hover) focus-visible:bg-(--ui-control-active-background)'
                    ),
                    onClick: () => {
                      onSelect(item);
                      onClose();
                    },
                    children: [
                      jsx('span', {
                        className:
                          'min-w-0 flex-1 truncate text-(--ui-text-primary)',
                        children: item.name,
                      }),
                      jsx('span', {
                        className:
                          'shrink-0 font-mono text-(--ui-text-tertiary)',
                        children: item.code,
                      }),
                    ],
                  },
                  item.code
                )
              ),
            ],
          }),
        }),
        jsx(DialogFooter, {
          children: jsx(Button, {
            variant: 'text',
            onClick: onClose,
            children: t('cancel'),
          }),
        }),
      ],
    }),
  });
}

function TreeChevron({ expanded }) {
  return jsx(Codicon, {
    className: 'shrink-0 text-(--ui-text-tertiary)',
    name: expanded ? 'chevron-down' : 'chevron-right',
    size: '0.75rem',
  });
}

function trendClass(percent) {
  const value = Number.parseFloat(String(percent));
  if (value > 0) return 'text-red-700 dark:text-red-300';
  if (value < 0) return 'text-emerald-700 dark:text-emerald-300';
  return 'text-(--ui-text-tertiary)';
}

function trendStyle(percent) {
  const value = Number.parseFloat(String(percent));
  return Number.isFinite(value) && value !== 0 ? { opacity: 0.72 } : undefined;
}

function groupTrend(group) {
  const stocksByCode = new Map();

  const collect = (current) => {
    const stocks = Array.isArray(current.stocks) ? current.stocks : [];
    stocks.forEach((stock) => stocksByCode.set(stock.code, stock));
    const children = Array.isArray(current.children) ? current.children : [];
    children.forEach(collect);
  };

  collect(group);

  return [...stocksByCode.values()].reduce(
    (summary, stock) => {
      const percent = Number.parseFloat(String(stock.percent));
      if (!Number.isFinite(percent)) return summary;
      if (percent > 0) summary.up += 1;
      else if (percent < 0) summary.down += 1;
      else summary.flat += 1;
      return summary;
    },
    { up: 0, down: 0, flat: 0 }
  );
}

function GroupTrend({ group, t }) {
  const summary = groupTrend(group);

  return jsxs('span', {
    className:
      'flex shrink-0 items-center gap-1 text-[0.625rem] font-normal tabular-nums',
    'aria-label': t(
      'groupTrendSummary',
      summary.up,
      summary.down,
      summary.flat
    ),
    children: [
      jsx('span', {
        className: trendClass(1),
        style: trendStyle(1),
        children: `↑${summary.up}`,
      }),
      jsx('span', {
        className: trendClass(-1),
        style: trendStyle(-1),
        children: `↓${summary.down}`,
      }),
      jsx('span', {
        className: 'text-(--ui-text-quaternary)',
        children: `=${summary.flat}`,
      }),
    ],
  });
}

function MoveGroupNode({ group, expandedGroups, onToggle, onSelect }) {
  const children = Array.isArray(group.children) ? group.children : [];
  const expanded = expandedGroups[group.id] === true;

  return jsxs('div', {
    children: [
      jsxs('div', {
        className: 'flex items-center',
        children: [
          children.length
            ? jsx('button', {
                type: 'button',
                className: cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded',
                  'hover:bg-(--chrome-action-hover) focus-visible:bg-(--ui-control-active-background)'
                ),
                onClick: () => onToggle(group.id),
                children: jsx(TreeChevron, { expanded }),
              })
            : jsx('span', { className: 'h-7 w-7 shrink-0' }),
          jsx('button', {
            type: 'button',
            className: cn(
              'min-w-0 flex-1 rounded px-1 py-1.5 text-left text-xs',
              'text-(--ui-text-primary) hover:bg-(--chrome-action-hover)',
              'focus-visible:bg-(--ui-control-active-background)'
            ),
            onClick: () => onSelect(group.id, group.name),
            children: group.name,
          }),
        ],
      }),
      children.length && expanded
        ? jsx('div', {
            className: 'ml-3 border-l border-(--ui-stroke-tertiary) pl-2',
            children: children.map((child) =>
              jsx(
                MoveGroupNode,
                {
                  group: child,
                  expandedGroups,
                  onToggle,
                  onSelect,
                },
                child.id
              )
            ),
          })
        : null,
    ],
  });
}

function StockMoveDialog({ dialog, t, onMove, onClose }) {
  const [expandedGroups, setExpandedGroups] = useState({});

  useEffect(() => {
    setExpandedGroups({});
  }, [dialog]);

  if (!dialog) return null;

  const selectGroup = (groupId, groupName) => {
    onMove(dialog.stock, groupId, groupName);
    onClose();
  };

  return jsx(Dialog, {
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    children: jsxs(DialogContent, {
      className: 'max-w-sm',
      children: [
        jsx(DialogHeader, {
          children: jsx(DialogTitle, {
            children: t(
              'moveStockTitle',
              dialog.stock.name || dialog.stock.code
            ),
          }),
        }),
        jsx(ScrollArea, {
          className: 'h-64',
          style: { height: '16rem' },
          children: jsxs('div', {
            className: 'space-y-0.5 py-1',
            children: [
              jsxs('div', {
                className: 'flex items-center',
                children: [
                  jsx('span', { className: 'h-7 w-7 shrink-0' }),
                  jsx('button', {
                    type: 'button',
                    className: cn(
                      'min-w-0 flex-1 rounded px-1 py-1.5 text-left text-xs',
                      'text-(--ui-text-primary) hover:bg-(--chrome-action-hover)',
                      'focus-visible:bg-(--ui-control-active-background)'
                    ),
                    onClick: () => selectGroup('ungrouped', t('ungrouped')),
                    children: t('ungrouped'),
                  }),
                ],
              }),
              ...dialog.groups.map((group) =>
                jsx(
                  MoveGroupNode,
                  {
                    group,
                    expandedGroups,
                    onToggle: (groupId) =>
                      setExpandedGroups((current) => ({
                        ...current,
                        [groupId]: current[groupId] !== true,
                      })),
                    onSelect: selectGroup,
                  },
                  group.id
                )
              ),
            ],
          }),
        }),
        jsx(DialogFooter, {
          children: jsx(Button, {
            variant: 'text',
            onClick: onClose,
            children: t('cancel'),
          }),
        }),
      ],
    }),
  });
}

function StockRow({
  stock,
  category,
  groupId,
  moveGroups,
  level = 0,
  canSort,
  dnd,
  t,
  onAction,
  openMove,
}) {
  const percent = String(stock.percent || '--');
  const quoteClass = trendClass(percent);
  const quoteStyle = trendStyle(percent);
  const dropTarget =
    dnd.target?.kind === 'stock' && dnd.target.id === `${groupId}:${stock.code}`
      ? dnd.target
      : null;
  const rowStyle = {
    paddingLeft: level > 0 ? '1.5rem' : '1rem',
    cursor: canSort ? 'grab' : undefined,
    ...(dropTarget
      ? {
          boxShadow:
            dropTarget.placement === 'before'
              ? 'inset 0 2px 0 var(--ui-accent)'
              : 'inset 0 -2px 0 var(--ui-accent)',
        }
      : {}),
  };

  const row = jsxs('button', {
    type: 'button',
    draggable: canSort,
    'aria-grabbed':
      canSort && dnd.item?.kind === 'stock' && dnd.item.code === stock.code,
    className: cn(
      'flex w-full items-center gap-2 py-1 pr-2 text-left text-xs outline-none',
      'hover:bg-(--chrome-action-hover) focus-visible:bg-(--ui-control-active-background)'
    ),
    style: rowStyle,
    onDragStart: (event) => {
      if (!canSort) return;
      dnd.start(event, {
        kind: 'stock',
        code: stock.code,
        category,
        groupId,
      });
    },
    onDragEnd: dnd.end,
    onDragOver: (event) =>
      dnd.dragOverStock(event, category, groupId, stock.code),
    onDrop: (event) => dnd.dropOnStock(event, category, groupId, stock.code),
    children: [
      jsxs('span', {
        className: 'min-w-0 flex-1',
        children: [
          jsxs('span', {
            className: 'flex min-w-0 items-center gap-1',
            children: [
              jsx('span', {
                className: 'truncate text-(--ui-text-primary)',
                children: stock.name || stock.code,
              }),
              stock.holding
                ? jsx(Codicon, {
                    className: 'text-(--ui-accent)',
                    name: 'tag',
                    size: '0.7rem',
                  })
                : null,
              stock.watch
                ? jsx(Codicon, {
                    className: 'text-(--ui-accent)',
                    name: 'eye',
                    size: '0.7rem',
                  })
                : null,
            ],
          }),
          jsx('span', {
            className:
              'block truncate text-[0.6875rem] text-(--ui-text-quaternary)',
            children: stock.code,
          }),
        ],
      }),
      jsxs('span', {
        className: 'shrink-0 text-right tabular-nums',
        style: quoteStyle,
        children: [
          jsx('span', {
            className: cn('block', quoteClass),
            children: stock.price || '--',
          }),
          jsx('span', {
            className: cn('block text-[0.6875rem]', quoteClass),
            children: percent === '--' ? percent : `${percent}%`,
          }),
        ],
      }),
    ],
  });

  const menuItems = [
    jsx(
      ContextMenuItem,
      {
        onSelect: () =>
          onAction({
            run: (api) =>
              api.updateFlags(stock.code, { holding: !stock.holding }),
            success: stock.holding ? t('holdingRemoved') : t('holdingAdded'),
          }),
        children: stock.holding ? t('removeHolding') : t('markHolding'),
      },
      'holding'
    ),
    jsx(
      ContextMenuItem,
      {
        onSelect: () =>
          onAction({
            run: (api) => api.updateFlags(stock.code, { watch: !stock.watch }),
            success: stock.watch ? t('watchRemoved') : t('watchAdded'),
          }),
        children: stock.watch ? t('removeWatch') : t('markWatch'),
      },
      'watch'
    ),
    jsx(
      ContextMenuItem,
      {
        onSelect: () =>
          onAction({
            run: (api) =>
              api.updateFlags(stock.code, { status_bar: !stock.in_status_bar }),
            success: stock.in_status_bar
              ? t('tickerRemoved')
              : t('tickerAdded'),
          }),
        children: stock.in_status_bar ? t('removeTicker') : t('addTicker'),
      },
      'ticker'
    ),
    jsx(ContextMenuSeparator, {}, 'flags-separator'),
    jsx(
      ContextMenuItem,
      {
        onSelect: () => openMove(stock, moveGroups),
        children: t('moveStock'),
      },
      'move'
    ),
    jsx(ContextMenuSeparator, {}, 'delete-separator'),
    jsx(
      ContextMenuItem,
      {
        variant: 'destructive',
        onSelect: () => {
          if (
            !window.confirm(t('deleteStockConfirm', stock.name || stock.code))
          )
            return;
          onAction({
            run: (api) => api.deleteStock(stock.code),
            success: t('stockDeleted'),
          });
        },
        children: t('deleteStock'),
      },
      'delete'
    ),
  ];

  return jsxs(ContextMenu, {
    children: [
      jsx(ContextMenuTrigger, { asChild: true, children: row }),
      jsx(ContextMenuContent, { className: 'min-w-44', children: menuItems }),
    ],
  });
}

function GroupNode({
  group,
  category,
  moveGroups,
  expanded,
  t,
  onToggle,
  groupState,
  onToggleGroup,
  onAction,
  dnd,
  openMove,
  openRename,
  level = 0,
}) {
  const childGroups = Array.isArray(group.children) ? group.children : [];
  const canSortGroup = !group.builtin;
  const groupDropTarget =
    dnd.target?.kind === 'group' && dnd.target.id === group.id
      ? dnd.target
      : null;
  const groupDropStyle = groupDropTarget
    ? groupDropTarget.placement === 'inside'
      ? { background: 'var(--chrome-action-hover)' }
      : {
          boxShadow:
            groupDropTarget.placement === 'before'
              ? 'inset 0 2px 0 var(--ui-accent)'
              : 'inset 0 -2px 0 var(--ui-accent)',
        }
    : undefined;
  const groupButton = jsxs('button', {
    type: 'button',
    draggable: canSortGroup,
    'aria-grabbed':
      canSortGroup && dnd.item?.kind === 'group' && dnd.item.id === group.id,
    className: cn(
      'flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs font-medium',
      'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)'
    ),
    style: {
      cursor: canSortGroup ? 'grab' : undefined,
      ...groupDropStyle,
    },
    onClick: onToggle,
    onDragStart: (event) => {
      if (!canSortGroup) return;
      dnd.start(event, {
        kind: 'group',
        id: group.id,
        category,
        parentId: group.parent_id || null,
      });
    },
    onDragEnd: dnd.end,
    onDragOver: (event) => dnd.dragOverGroup(event, category, group),
    onDrop: (event) => dnd.dropOnGroup(event, category, group),
    children: [
      jsx(TreeChevron, { expanded }),
      jsx(Codicon, {
        className: 'text-(--ui-text-tertiary)',
        name: group.builtin ? 'folder' : 'folder-library',
        size: '0.8rem',
      }),
      jsx('span', { className: 'min-w-0 truncate', children: group.name }),
      jsx(GroupTrend, { group, t }),
      jsx('span', {
        className:
          'ml-auto shrink-0 text-[0.6875rem] font-normal text-(--ui-text-quaternary)',
        children: String(group.count ?? group.stocks.length),
      }),
    ],
  });

  const header = group.builtin
    ? groupButton
    : jsxs(ContextMenu, {
        children: [
          jsx(ContextMenuTrigger, { asChild: true, children: groupButton }),
          jsx(ContextMenuContent, {
            children: [
              jsx(ContextMenuItem, {
                onSelect: () => openRename(group),
                children: t('renameGroup'),
              }),
              jsx(ContextMenuItem, {
                variant: 'destructive',
                onSelect: () => {
                  if (!window.confirm(t('deleteGroupConfirm', group.name)))
                    return;
                  onAction({
                    run: (api) => api.deleteGroup(group.id),
                    success: t('groupDeleted'),
                  });
                },
                children: t('deleteGroup'),
              }),
            ],
          }),
        ],
      });

  return jsxs('div', {
    className: level > 0 ? 'ml-2' : undefined,
    children: [
      header,
      expanded
        ? jsx('div', {
            className: 'ml-3 border-l border-(--ui-stroke-tertiary)',
            children:
              group.stocks.length || childGroups.length
                ? [
                    ...group.stocks.map((stock) =>
                      jsx(
                        StockRow,
                        {
                          stock,
                          category,
                          groupId: group.id,
                          moveGroups,
                          level,
                          canSort: true,
                          dnd,
                          t,
                          onAction,
                          openMove,
                        },
                        `${category}-${group.id}-${stock.code}`
                      )
                    ),
                    ...childGroups.map((child) =>
                      jsx(
                        GroupNode,
                        {
                          group: child,
                          category,
                          moveGroups,
                          expanded:
                            groupState[`${category}:${child.id}`] === true,
                          t,
                          onToggle: () =>
                            onToggleGroup(`${category}:${child.id}`),
                          groupState,
                          onToggleGroup,
                          onAction,
                          dnd,
                          openMove,
                          openRename,
                          level: level + 1,
                        },
                        `${category}-${child.id}`
                      )
                    ),
                  ]
                : jsx('div', {
                    className:
                      'px-3 py-1 text-[0.6875rem] text-(--ui-text-quaternary)',
                    children: t('emptyGroup'),
                  }),
          })
        : null,
    ],
  });
}

function MarketNode({
  category,
  expanded,
  groupState,
  t,
  onToggle,
  onToggleGroup,
  onAction,
  dnd,
  openMove,
  openCreateGroup,
  openRename,
}) {
  const moveGroups = category.groups.filter((group) => !group.builtin);
  const marketButton = jsxs('button', {
    type: 'button',
    className: cn(
      'flex w-full items-center gap-1.5 border-b border-(--ui-stroke-tertiary)',
      'px-2 py-1.5 text-left text-xs font-semibold text-(--ui-text-primary)',
      'hover:bg-(--chrome-action-hover)'
    ),
    onClick: onToggle,
    children: [
      jsx(TreeChevron, { expanded }),
      jsx('span', {
        className: 'min-w-0 flex-1 truncate',
        children: category.name,
      }),
      jsx('span', {
        className: 'text-[0.6875rem] font-normal text-(--ui-text-quaternary)',
        children: String(category.count),
      }),
    ],
  });

  return jsxs('div', {
    children: [
      jsxs(ContextMenu, {
        children: [
          jsx(ContextMenuTrigger, { asChild: true, children: marketButton }),
          jsx(ContextMenuContent, {
            children: jsx(ContextMenuItem, {
              onSelect: () => openCreateGroup(category),
              children: t('createGroup'),
            }),
          }),
        ],
      }),
      expanded
        ? jsx('div', {
            className: 'py-0.5',
            children: category.groups.map((group) =>
              jsx(
                GroupNode,
                {
                  group,
                  category: category.id,
                  moveGroups,
                  expanded: groupState[`${category.id}:${group.id}`] === true,
                  t,
                  onToggle: () => onToggleGroup(`${category.id}:${group.id}`),
                  groupState,
                  onToggleGroup,
                  onAction,
                  dnd,
                  openMove,
                  openRename,
                  level: 0,
                },
                `${category.id}-${group.id}`
              )
            ),
          })
        : null,
    ],
  });
}

function StockPane({ api }) {
  const t = usePluginI18n(ID);
  const snapshot = useSnapshot(api);
  const action = usePluginAction(api);
  const [dialog, setDialog] = useState(null);
  const [moveDialog, setMoveDialog] = useState(null);
  const [stockSearchOpen, setStockSearchOpen] = useState(false);
  const [marketState, setMarketState] = useState({ A: true });
  const [groupState, setGroupState] = useState({});

  const onAction = (next) => action.mutate(next);
  const dnd = useTreeDrag(onAction);
  const toggleMarket = (id) =>
    setMarketState((current) => ({ ...current, [id]: !current[id] }));
  const toggleGroup = (id) =>
    setGroupState((current) => ({ ...current, [id]: !current[id] }));

  const addStock = (stock) =>
    onAction({
      run: (currentApi) => currentApi.addStock(stock.code),
      success: t('stockAdded'),
    });

  const moveStock = (stock, groupId, groupName) =>
    onAction({
      run: (currentApi) => currentApi.moveStock(stock.code, groupId),
      success:
        groupId === 'ungrouped' ? t('movedUngrouped') : t('movedTo', groupName),
    });

  const openCreateGroup = (category) =>
    setDialog({
      title: t('createGroupFor', category.name),
      placeholder: t('groupNamePlaceholder'),
      submitLabel: t('create'),
      cancelLabel: t('cancel'),
      submit: (name) =>
        onAction({
          run: (currentApi) => currentApi.createGroup(category.id, name),
          success: t('groupCreated'),
        }),
    });

  const openRename = (group) =>
    setDialog({
      title: t('renameGroup'),
      initial: group.name,
      placeholder: t('groupNamePlaceholder'),
      submitLabel: t('save'),
      cancelLabel: t('cancel'),
      submit: (name) =>
        onAction({
          run: (currentApi) => currentApi.renameGroup(group.id, name),
          success: t('groupRenamed'),
        }),
    });

  if (snapshot.isLoading && !snapshot.data) {
    return jsxs('div', {
      className: 'flex h-full flex-col gap-2 p-3',
      children: [
        jsx(Skeleton, { className: 'h-7 w-full' }),
        jsx(Skeleton, { className: 'h-16 w-full' }),
        jsx(Skeleton, { className: 'h-16 w-full' }),
      ],
    });
  }

  if (snapshot.isError && !snapshot.data) {
    return jsxs('div', {
      className:
        'flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs',
      children: [
        jsx(Codicon, {
          className: 'text-(--ui-text-tertiary)',
          name: 'warning',
          size: '1.25rem',
        }),
        jsx('div', {
          className: 'text-(--ui-text-secondary)',
          children: t('backendUnavailable'),
        }),
        jsx(Button, {
          variant: 'outline',
          size: 'xs',
          onClick: () => snapshot.refetch(),
          children: t('retry'),
        }),
      ],
    });
  }

  const data = snapshot.data || { categories: [], errors: [] };

  return jsxs(Fragment, {
    children: [
      jsxs('div', {
        className: 'flex h-full min-h-0 flex-col text-xs',
        children: [
          jsxs('div', {
            className:
              'flex shrink-0 items-center gap-2 border-b border-(--ui-stroke-secondary) px-2 py-1',
            children: [
              jsx('div', {
                className:
                  'min-w-0 flex-1 truncate font-semibold text-(--ui-text-primary)',
                children: 'LeekFund',
              }),
              jsx(Tip, {
                label: t('addStock'),
                children: jsx(Button, {
                  variant: 'ghost',
                  size: 'icon-xs',
                  onClick: () => setStockSearchOpen(true),
                  children: jsx(Codicon, { name: 'add', size: '0.8rem' }),
                }),
              }),
              jsx(Tip, {
                label: t('refresh'),
                children: jsx(Button, {
                  variant: 'ghost',
                  size: 'icon-xs',
                  disabled: snapshot.isFetching,
                  onClick: () => snapshot.refetch(),
                  children: jsx(Codicon, {
                    name: 'refresh',
                    size: '0.8rem',
                    spinning: snapshot.isFetching,
                  }),
                }),
              }),
            ],
          }),
          data.stale && data.errors?.length
            ? jsx('div', {
                className:
                  'shrink-0 border-b border-(--ui-stroke-tertiary) px-2 py-1 text-[0.6875rem] text-(--ui-text-tertiary)',
                children: t('staleData', data.errors[0]),
              })
            : null,
          jsx(ScrollArea, {
            className: 'min-h-0 flex-1',
            children: data.categories.map((category) =>
              jsx(
                MarketNode,
                {
                  category,
                  expanded: marketState[category.id] !== false,
                  groupState,
                  t,
                  onToggle: () => toggleMarket(category.id),
                  onToggleGroup: toggleGroup,
                  onAction,
                  dnd,
                  openMove: (stock, groups) => setMoveDialog({ stock, groups }),
                  openCreateGroup,
                  openRename,
                },
                category.id
              )
            ),
          }),
          jsx('div', {
            className:
              'shrink-0 border-t border-(--ui-stroke-tertiary) px-2 py-1 text-[0.625rem] text-(--ui-text-quaternary)',
            children: data.updated_at
              ? t(
                  'updatedAt',
                  new Date(data.updated_at * 1000).toLocaleTimeString()
                )
              : t('notUpdated'),
          }),
        ],
      }),
      jsx(TextActionDialog, {
        dialog,
        onClose: () => setDialog(null),
      }),
      jsx(StockSearchDialog, {
        open: stockSearchOpen,
        api,
        t,
        onSelect: addStock,
        onClose: () => setStockSearchOpen(false),
      }),
      jsx(StockMoveDialog, {
        dialog: moveDialog,
        t,
        onMove: moveStock,
        onClose: () => setMoveDialog(null),
      }),
    ],
  });
}

function StatusTicker({ api }) {
  const t = usePluginI18n(ID);
  const snapshot = useSnapshot(api);
  const items = snapshot.data?.status_bar || [];
  if (!items.length) {
    return jsx('span', {
      className:
        'inline-flex h-full items-center px-1.5 text-[0.6875rem] text-(--ui-text-tertiary)',
      children: snapshot.isError ? t('tickerUnavailable') : t('tickerLoading'),
    });
  }

  return jsx('div', {
    className:
      'inline-flex h-full items-center overflow-hidden whitespace-nowrap',
    children: items.map((item) => {
      const percent = item.percent === '--' ? '--' : `${item.percent}%`;
      const label = `${item.name} ${item.price} ${percent}`;
      return jsx(
        Tip,
        {
          label: `${item.name} (${item.code}) · ${
            item.time || t('latestQuote')
          }`,
          children: jsx('span', {
            className: cn(
              'inline-flex h-full items-center border-l border-(--ui-stroke-tertiary)',
              'px-1.5 text-[0.6875rem] tabular-nums',
              trendClass(item.percent)
            ),
            style: trendStyle(item.percent),
            children: label,
          }),
        },
        item.code
      );
    }),
  });
}

export default {
  id: ID,
  name: 'LeekFund',
  defaultEnabled: true,
  register(ctx) {
    ctx.i18n.register({
      en: {
        addStock: 'Add stock',
        stockSearchPlaceholder: 'Stock code or name',
        stockSearchHint: 'Search A-shares by code or name',
        stockSearching: 'Searching…',
        stockSearchEmpty: 'No matching A-shares',
        stockSearchFailed: 'Stock search failed. Try again.',
        cancel: 'Cancel',
        create: 'Create',
        save: 'Save',
        refresh: 'Refresh',
        retry: 'Retry',
        createGroup: 'Create group',
        createGroupFor: (market) => `Create group in ${market}`,
        groupNamePlaceholder: 'Group name',
        renameGroup: 'Rename group',
        deleteGroup: 'Delete group',
        deleteGroupConfirm: (name) =>
          `Delete group “${name}”? Stocks will be kept.`,
        deleteStock: 'Delete stock',
        deleteStockConfirm: (name) => `Delete “${name}” from the stock list?`,
        markHolding: 'Mark as holding',
        removeHolding: 'Remove holding mark',
        markWatch: 'Add to watch',
        removeWatch: 'Remove from watch',
        addTicker: 'Show in status bar',
        removeTicker: 'Remove from status bar',
        moveStock: 'Move to…',
        moveStockTitle: (name) => `Move “${name}”`,
        ungrouped: 'Ungrouped',
        groupTrendSummary: (up, down, flat) =>
          `${up} up, ${down} down, ${flat} unchanged`,
        emptyGroup: 'No stocks',
        backendUnavailable:
          'LeekFund backend is unavailable. Enable the backend plugin, then fully quit and reopen Hermes Desktop.',
        staleData: (error) => `Using cached quotes · ${error}`,
        updatedAt: (time) => `Updated ${time}`,
        notUpdated: 'No successful quote update yet',
        latestQuote: 'Latest quote',
        tickerUnavailable: 'LeekFund unavailable',
        tickerLoading: 'LeekFund loading…',
        stockAdded: 'Stock added',
        stockDeleted: 'Stock deleted',
        groupCreated: 'Group created',
        groupRenamed: 'Group renamed',
        groupDeleted: 'Group deleted; stocks were kept',
        holdingAdded: 'Holding mark added',
        holdingRemoved: 'Holding mark removed',
        watchAdded: 'Watch mark added',
        watchRemoved: 'Watch mark removed',
        tickerAdded: 'Added to status bar',
        tickerRemoved: 'Removed from status bar',
        movedUngrouped: 'Moved to ungrouped',
        movedTo: (name) => `Moved to ${name}`,
      },
      zh: {
        addStock: '添加股票',
        stockSearchPlaceholder: '输入股票代码或名称',
        stockSearchHint: '支持按代码或中文名称查询 A 股',
        stockSearching: '正在查询…',
        stockSearchEmpty: '没有匹配的 A 股',
        stockSearchFailed: '股票查询失败，请重试',
        cancel: '取消',
        create: '创建',
        save: '保存',
        refresh: '刷新行情',
        retry: '重试',
        createGroup: '创建分组',
        createGroupFor: (market) => `在${market}中创建分组`,
        groupNamePlaceholder: '分组名称',
        renameGroup: '重命名分组',
        deleteGroup: '删除分组',
        deleteGroupConfirm: (name) =>
          `确定删除分组“${name}”吗？组内股票不会删除。`,
        deleteStock: '删除股票',
        deleteStockConfirm: (name) => `确定从股票列表删除“${name}”吗？`,
        markHolding: '标记为持仓',
        removeHolding: '取消持仓标记',
        markWatch: '添加关注',
        removeWatch: '取消关注',
        addTicker: '加入状态栏',
        removeTicker: '移出状态栏',
        moveStock: '移动到…',
        moveStockTitle: (name) => `移动“${name}”`,
        ungrouped: '未分组',
        groupTrendSummary: (up, down, flat) =>
          `上涨 ${up}，下跌 ${down}，平盘 ${flat}`,
        emptyGroup: '暂无股票',
        backendUnavailable:
          'LeekFund 后端不可用，请启用后端插件，然后完全退出并重新打开 Hermes Desktop。',
        staleData: (error) => `正在展示缓存行情 · ${error}`,
        updatedAt: (time) => `更新时间 ${time}`,
        notUpdated: '尚未成功更新行情',
        latestQuote: '最新行情',
        tickerUnavailable: 'LeekFund 不可用',
        tickerLoading: 'LeekFund 加载中…',
        stockAdded: '股票已添加',
        stockDeleted: '股票已删除',
        groupCreated: '分组已创建',
        groupRenamed: '分组已重命名',
        groupDeleted: '分组已删除，组内股票已保留',
        holdingAdded: '已添加持仓标记',
        holdingRemoved: '已取消持仓标记',
        watchAdded: '已添加关注',
        watchRemoved: '已取消关注',
        tickerAdded: '已加入状态栏',
        tickerRemoved: '已移出状态栏',
        movedUngrouped: '已移动到未分组',
        movedTo: (name) => `已移动到 ${name}`,
      },
    });

    const api = createApi(ctx);
    ctx.register({
      id: 'stock-tree-sidebar',
      area: 'panes',
      title: 'LeekFund',
      data: {
        placement: 'left',
        dock: { pane: 'workspace', pos: 'left' },
        width: '300px',
      },
      render: () => jsx(StockPane, { api }),
    });
    ctx.register({
      id: 'status-ticker',
      area: 'statusBar.right',
      order: 125,
      render: () => jsx(StatusTicker, { api }),
    });
  },
};
