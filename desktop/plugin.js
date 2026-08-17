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
    ranking: (type) => request(`/speed-ranking?type=${encodeURIComponent(type)}`),
    strategies: () => request('/strategies'),
    searchStocks: (query) =>
      request(`/stock-search?q=${encodeURIComponent(query)}`),
    minuteStock: (code) =>
      request(`/stock-minute?code=${encodeURIComponent(code)}`),
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

function useRanking(api, type, enabled = true) {
  return useQuery({
    queryKey: [ID, 'speed-ranking', type],
    queryFn: () => api.ranking(type),
    enabled: Boolean(type) && enabled,
    refetchInterval: 2000,
    staleTime: 2000,
    retry: 1,
  });
}

function useStrategies(api, enabled = true) {
  return useQuery({
    queryKey: [ID, 'strategies'],
    queryFn: api.strategies,
    enabled,
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
      queryClient.invalidateQueries({ queryKey: [ID, 'speed-ranking'] });
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

function groupAvgPercent(group) {
  const values = [];

  const collect = (current) => {
    const stocks = Array.isArray(current.stocks) ? current.stocks : [];
    stocks.forEach((stock) => {
      const percent = Number.parseFloat(String(stock.percent));
      if (Number.isFinite(percent)) values.push(percent);
    });
    const children = Array.isArray(current.children) ? current.children : [];
    children.forEach(collect);
  };

  collect(group);
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
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
                    onClick: () => selectGroup('watch', t('watch')),
                    children: t('watch'),
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

const MINUTE_CARD_WIDTH = 300;
const MINUTE_CARD_HEIGHT = 224;

const TOTAL_TRADING_MINUTES = 240;

function tradingMinuteIndex(timeText) {
  const match = String(timeText || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (minutes >= 570 && minutes <= 690) return minutes - 570;
  if (minutes >= 780 && minutes <= 900) return 120 + (minutes - 780);
  return null;
}

function buildMinuteChart(points, width, height, preClose) {
  const pad = 6;
  const count = points.length;
  if (!count) return null;
  const values = points.map((point) => Number.parseFloat(point.price));
  const close = Number.parseFloat(preClose);
  const lower = Math.min(...values, Number.isFinite(close) ? close : Infinity);
  const upper = Math.max(...values, Number.isFinite(close) ? close : -Infinity);
  const range = upper - lower || 1;
  const chartW = width - pad * 2;
  const chartH = height - pad * 2;
  const toX = (point) => {
    const index = tradingMinuteIndex(point.time);
    if (index === null) return null;
    return pad + (index / TOTAL_TRADING_MINUTES) * chartW;
  };
  const toY = (value) => pad + ((upper - value) / range) * chartH;
  const lineSegments = [];
  let lineStarted = false;
  for (const point of points) {
    const x = toX(point);
    if (x === null) continue;
    const y = toY(Number.parseFloat(point.price)).toFixed(1);
    lineSegments.push(`${lineStarted ? 'L' : 'M'}${x.toFixed(1)},${y}`);
    lineStarted = true;
  }
  const avgSegments = [];
  let avgStarted = false;
  for (const point of points) {
    const x = toX(point);
    const avg = Number.parseFloat(point.avg_price);
    if (x === null || !Number.isFinite(avg)) continue;
    const y = toY(avg).toFixed(1);
    avgSegments.push(`${avgStarted ? 'L' : 'M'}${x.toFixed(1)},${y}`);
    avgStarted = true;
  }
  return {
    line: lineSegments.join(''),
    avgLine: avgSegments.length ? avgSegments.join('') : null,
    closeY: Number.isFinite(close) ? toY(close) : null,
    lower,
    upper,
  };
}

function StockMinuteCard({ hover, data, isLoading, isError }) {
  if (!hover) return null;
  const chart = data?.points?.length
    ? buildMinuteChart(data.points, 190, 116, data.pre_close)
    : null;
  const labelCloseY =
    chart?.closeY == null
      ? null
      : (() => {
          const top = 14;
          const bottom = 108;
          const gap = 17;
          let y = chart.closeY + 3;
          if (y < top + gap) y = top + gap;
          if (y > bottom - gap) y = bottom - gap;
          return y;
        })();
  const left =
    hover.x + 14 + MINUTE_CARD_WIDTH > window.innerWidth
      ? hover.x - 14 - MINUTE_CARD_WIDTH
      : hover.x + 14;
  const top =
    hover.y + 14 + MINUTE_CARD_HEIGHT > window.innerHeight
      ? hover.y - 14 - MINUTE_CARD_HEIGHT
      : hover.y + 14;
  const preClose = Number.parseFloat(data?.pre_close);
  const price = Number.parseFloat(data?.price);
  const percent =
    Number.isFinite(preClose) && preClose > 0 && Number.isFinite(price)
      ? ((price - preClose) / preClose) * 100
      : null;
  const percentText =
    percent === null ? '--' : `${percent > 0 ? '+' : ''}${percent.toFixed(2)}%`;
  const limitUp = Number.parseFloat(data?.limit_up);
  const limitDown = Number.parseFloat(data?.limit_down);
  const latest = data?.points?.length
    ? data.points[data.points.length - 1]
    : null;
  const quoteDigits = (() => {
    const sample =
      Number.parseFloat(data?.pre_close) || Number.parseFloat(data?.price) || 0;
    return Number.isFinite(sample) &&
      Math.abs(sample * 100 - Math.round(sample * 100)) >= 0.005
      ? 3
      : 2;
  })();
  const avgPrice = Number.parseFloat(latest?.avg_price);
  const avgText =
    Number.isFinite(avgPrice) && avgPrice > 0
      ? avgPrice.toFixed(quoteDigits)
      : '--';
  const fmtMA = (value) => {
    const num = Number.parseFloat(value);
    return Number.isFinite(num) && num > 0
      ? num.toFixed(quoteDigits)
      : '--';
  };
  const fmtLimit = (value) =>
    Number.isFinite(value) && value > 0 ? value.toFixed(quoteDigits) : '--';
  const highValue = Number.parseFloat(data?.high);
  const lowValue = Number.parseFloat(data?.low);
  const pctOf = (value) => {
    if (
      !Number.isFinite(preClose) ||
      preClose <= 0 ||
      !Number.isFinite(value) ||
      value <= 0
    ) {
      return '';
    }
    const pct = ((value - preClose) / preClose) * 100;
    return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
  };
  const highText = `${data?.high || '--'} ${pctOf(highValue)}`.trim();
  const lowText = `${data?.low || '--'} ${pctOf(lowValue)}`.trim();

  return jsx('div', {
    className:
      'pointer-events-none fixed z-50 flex flex-col gap-1.5 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) px-3 py-2 text-xs shadow-lg',
    style: { left, top, width: MINUTE_CARD_WIDTH },
    children: [
      jsxs('div', {
        className: 'flex w-full items-baseline gap-2',
        children: [
          jsxs('span', {
            className: 'min-w-0 flex-1',
            children: [
              jsx('span', {
                className:
                  'block truncate font-medium text-(--ui-text-primary)',
                children: hover.name,
              }),
              jsx('span', {
                className:
                  'block font-mono text-[0.6875rem] text-(--ui-text-quaternary)',
                children: hover.code,
              }),
            ],
          }),
                    jsx('span', {
            className: cn(
              'font-mono tabular-nums',
              trendClass(percentText)
            ),
            style: trendStyle(percentText),
            children: data?.price || '--',
          }),
          jsx('span', {
            className: cn(
              'font-mono tabular-nums',
              trendClass(percentText)
            ),
            style: trendStyle(percentText),
            children: percentText,
          }),
        ],
      }),
      data == null && isLoading
        ? jsx('div', {
            className:
              'py-6 text-center text-[0.6875rem] text-(--ui-text-tertiary)',
            children: '分时数据加载中…',
          })
        : isError || !chart
        ? jsx('div', {
            className: 'py-6 text-center text-[0.6875rem] text-(--ui-danger)',
            children: '分时数据加载失败',
          })
        : [
            jsxs('div', {
              className:
                'flex w-full items-center justify-between text-[0.6875rem] text-(--ui-text-quaternary)',
              children: [
                jsx('span', {
                  className: 'text-(--ui-text-quaternary)',
                  children: `均价 ${avgText}`,
                }),
                jsx('span', {
                  children: `涨停 ${fmtLimit(limitUp)}`,
                }),
                jsx('span', {
                  children: `跌停 ${fmtLimit(limitDown)}`,


                }),
              ],
            }),
            jsx('svg', {
              width: 292,
              height: 122,
              viewBox: '0 0 292 122',
              className: 'block w-full',
              children: [
                jsx('line', {
                  x1: 6,
                  y1: 6,
                  x2: 184,
                  y2: 6,
                  stroke: 'currentColor',
                  strokeWidth: 1,
                  className: 'text-(--ui-stroke-tertiary)',
                }),
                jsx('line', {
                  x1: 6,
                  y1: 110,
                  x2: 184,
                  y2: 110,
                  stroke: 'currentColor',
                  strokeWidth: 1,
                  className: 'text-(--ui-stroke-tertiary)',
                }),
                chart.closeY != null
                  ? jsx('line', {
                      x1: 6,
                      y1: chart.closeY,
                      x2: 184,
                      y2: chart.closeY,
                      stroke: 'currentColor',
                      strokeWidth: 1,
                      strokeDasharray: '4 3',
                      className: 'text-(--ui-text-quaternary)',
                    })
                  : null,
                jsx('path', {
                  d: chart.line,
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 1.5,
                  className: trendClass(percentText),
                }),
                chart.avgLine
                  ? jsx('path', {
                      d: chart.avgLine,
                      fill: 'none',
                      stroke: '#d9a441',
                      strokeWidth: 1,
                    })
                  : null,
                chart.closeY != null && labelCloseY != null
                  ? jsx('text', {
                      x: 190,
                      y: labelCloseY,
                      fontSize: 9,
                      fill: '#000000',
                      children: `昨收 ${data.pre_close || '--'}`,
                    })
                  : null,
                jsx('text', {
                  x: 190,
                  y: 14,
                  fontSize: 9,
                  fill: '#000000',
                  children: `最高 ${highText}`,
                }),
                jsx('text', {
                  x: 190,
                  y: 108,
                  fontSize: 9,
                  fill: '#000000',
                  children: `最低 ${lowText}`,
                }),
              ],
            }),
            jsxs('div', {
              className:
                'flex w-full items-center justify-end gap-1.5 text-[0.6875rem] text-(--ui-text-quaternary)',
              children: [
                jsx('span', { children: `MA5 ${fmtMA(data.ma5)}` }),
                jsx('span', { children: `MA10 ${fmtMA(data.ma10)}` }),
                jsx('span', { children: `MA20 ${fmtMA(data.ma20)}` }),
              ],
            }),
          ],
    ],
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
  onHoverEnter,
  onHoverLeave,
}) {
  const percent = String(stock.percent || '--');
  const quoteClass = trendClass(percent);
  const quoteStyle = trendStyle(percent);
  const hoverTimer = useRef(null);
  const hoverPosition = useRef({ x: 0, y: 0 });
  const isAShare = /^(sh|sz|bj)/.test(String(stock.code || ''));
  const handleMouseEnter = (event) => {
    if (!isAShare) return;
    hoverPosition.current = { x: event.clientX, y: event.clientY };
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      if (typeof onHoverEnter === 'function') {
        onHoverEnter(
          stock.code,
          stock.name || stock.code,
          hoverPosition.current
        );
      }
    }, 300);
  };
  const handleMouseLeave = () => {
    window.clearTimeout(hoverTimer.current);
    if (typeof onHoverLeave === 'function') onHoverLeave();
  };
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
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
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
    ...(groupId === 'watch'
      ? []
      : [
          jsx(ContextMenuSeparator, {}, 'delete-separator'),
          jsx(
            ContextMenuItem,
            {
              variant: 'destructive',
              onSelect: () => {
                if (
                  !window.confirm(
                    t('deleteStockConfirm', stock.name || stock.code)
                  )
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
        ]),
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
  hoverApi,
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
      !childGroups.length
        ? (() => {
            const avg = groupAvgPercent(group);
            return avg === null
              ? null
              : jsx('span', {
                  className: cn(
                    'ml-auto shrink-0 text-[0.6875rem] font-normal tabular-nums',
                    trendClass(avg)
                  ),
                  style: trendStyle(avg),
                  children: `${avg > 0 ? '+' : ''}${avg.toFixed(2)}%`,
                });
          })()
        : null,
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
                          onHoverEnter: hoverApi.onEnter,
                          onHoverLeave: hoverApi.onLeave,
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
                          hoverApi,
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
  hoverApi,
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
                  hoverApi,
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

function StockPane({ api, storage }) {
  const t = usePluginI18n(ID);
  const snapshot = useSnapshot(api);
  const action = usePluginAction(api);
  const [dialog, setDialog] = useState(null);
  const [moveDialog, setMoveDialog] = useState(null);
  const [stockSearchOpen, setStockSearchOpen] = useState(false);
  const [marketState, setMarketState] = useState(() =>
    storage.get('stockTree.marketState', { A: true })
  );
  const [groupState, setGroupState] = useState(() =>
    storage.get('stockTree.groupState', {})
  );
  const [hover, setHover] = useState(null);
  const minuteQuery = useQuery({
    queryKey: [ID, 'minute', hover?.code || ''],
    queryFn: () => api.minuteStock(hover.code),
    enabled: Boolean(hover?.code),
    staleTime: 60000,
    retry: 1,
  });
  const hoverApi = {
    onEnter: (code, name, position) =>
      setHover({ code, name, x: position.x, y: position.y }),
    onLeave: () => setHover(null),
  };

  const onAction = (next) => action.mutate(next);
  const dnd = useTreeDrag(onAction);
  const toggleMarket = (id) =>
    setMarketState((current) => {
      const next = { ...current, [id]: !current[id] };
      storage.set('stockTree.marketState', next);
      return next;
    });
  const toggleGroup = (id) =>
    setGroupState((current) => {
      const next = { ...current, [id]: !current[id] };
      storage.set('stockTree.groupState', next);
      return next;
    });
  const collapseAll = () => {
    const nextMarket = {};
    const nextGroup = {};
    (data?.categories || []).forEach((category) => {
      nextMarket[category.id] = false;
    });
    storage.set('stockTree.marketState', nextMarket);
    storage.set('stockTree.groupState', nextGroup);
    setMarketState(nextMarket);
    setGroupState(nextGroup);
  };

  const addStock = (stock) =>
    onAction({
      run: (currentApi) => currentApi.addStock(stock.code),
      success: t('stockAdded'),
    });

  const moveStock = (stock, groupId, groupName) =>
    onAction({
      run: (currentApi) => currentApi.moveStock(stock.code, groupId),
      success:
        groupId === 'watch' ? t('watchAdded') : t('movedTo', groupName),
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
                label: t('collapseAll'),
                children: jsx(Button, {
                  variant: 'ghost',
                  size: 'icon-xs',
                  onClick: collapseAll,
                  children: jsx(Codicon, {
                    name: 'collapse-all',
                    size: '0.8rem',
                  }),
                }),
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
            onWheel: () => setHover(null),
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
                  hoverApi,
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
      jsx(StockMinuteCard, {
        hover,
        data: minuteQuery.data,
        isLoading: minuteQuery.isLoading,
        isError: minuteQuery.isError,
      }),
    ],
  });
}

const RANKING_TABS = [
  { id: 'speed', label: 'speedRanking' },
  { id: 'up', label: 'upRanking' },
  { id: 'down', label: 'downRanking' },
  { id: 'strategy', label: 'strategy' },
];

function SpeedRankingPane({ api }) {
  const t = usePluginI18n(ID);
  const [tab, setTab] = useState('speed');
  const isStrategy = tab === 'strategy';
  const ranking = useRanking(api, isStrategy ? null : tab);
  const strategies = useStrategies(api, isStrategy);
  const action = usePluginAction(api);
  const [hover, setHover] = useState(null);
  const hoverTimer = useRef(null);
  const hoverPosition = useRef({ x: 0, y: 0 });
  const minuteQuery = useQuery({
    queryKey: [ID, 'minute', hover?.code || ''],
    queryFn: () => api.minuteStock(hover.code),
    enabled: Boolean(hover?.code),
    staleTime: 60000,
    retry: 1,
  });

  const fullCode = (code) => {
    if (code.startsWith('6')) return `sh${code}`;
    if (code.startsWith('0') || code.startsWith('3')) return `sz${code}`;
    return code;
  };
  const onAdd = (item) =>
    action.mutate({
      run: (currentApi) => currentApi.addStock(fullCode(item.code)),
      success: t('stockAdded'),
    });
  const groupLabel = (item) =>
    item.group_id === 'watch'
      ? t('watch')
      : item.group_id === 'holding'
      ? t('holding')
      : item.group_name || '';
  const onRowEnter = (event, item) => {
    hoverPosition.current = { x: event.clientX, y: event.clientY };
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      setHover({
        code: fullCode(item.code),
        name: item.name,
        x: hoverPosition.current.x,
        y: hoverPosition.current.y,
      });
    }, 300);
  };
  const onRowLeave = () => {
    window.clearTimeout(hoverTimer.current);
    setHover(null);
  };
  const renderStockRow = (item, index) => {
    if (!item) return null;
    const quoteClass = trendClass(item.percent);
    const quoteStyle = trendStyle(item.percent);
    return jsxs(
      'div',
      {
        className:
          'flex items-center gap-2 border-b border-(--ui-stroke-tertiary) px-2 py-1.5',
        onMouseEnter: (event) => onRowEnter(event, item),
        onMouseLeave: onRowLeave,
        children: [
          jsx('span', {
            className:
              'w-5 shrink-0 text-center text-[0.6875rem] tabular-nums text-(--ui-text-quaternary)',
            children: index + 1,
          }),
          jsxs('span', {
            className: 'min-w-0 flex-1',
            children: [
              jsx('span', {
                className:
                  'block truncate text-(--ui-text-primary)',
                children: item.name,
              }),
              jsx('span', {
                className:
                  'block text-[0.6875rem] text-(--ui-text-quaternary)',
                children: item.code,
              }),
            ],
          }),
          jsxs('span', {
            className: 'shrink-0 text-right tabular-nums',
            style: quoteStyle,
            children: [
              jsx('span', {
                className: cn('block', quoteClass),
                children: item.price,
              }),
              jsx('span', {
                className: cn(
                  'block text-[0.6875rem]',
                  quoteClass
                ),
                children: `${item.percent}%`,
              }),
            ],
          }),
          item.added
            ? jsx('span', {
                className:
                  'shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)',
                children: groupLabel(item),
              })
            : jsx(Tip, {
                label: t('addStock'),
                children: jsx(Button, {
                  variant: 'ghost',
                  size: 'icon-xs',
                  onClick: () => onAdd(item),
                  children: jsx(Codicon, {
                    name: 'add',
                    size: '0.75rem',
                  }),
                }),
              }),
        ],
      },
      `${index}-${item.code}`
    );
  };
  const renderStrategyList = () => {
    const groups = strategies.data?.groups || [];
    if (!groups.length) {
      return jsx('div', {
        className: 'px-3 py-6 text-center text-(--ui-text-quaternary)',
        children: t('strategyEmpty'),
      });
    }
    return jsxs(Fragment, {
      children: groups.map((group) => {
        const items = Array.isArray(group.items) ? group.items : [];
        return jsxs(
          'div',
          {
            className: 'py-1',
            children: [
              jsx('div', {
                className:
                  'bg-(--ui-bg-elevated) px-2 py-1 text-[0.6875rem] font-semibold text-(--ui-text-secondary)',
                children: group.name,
              }),
              items.length
                ? items.map((item, index) => renderStockRow(item, index))
                : jsx('div', {
                    className:
                      'px-3 py-2 text-[0.6875rem] text-(--ui-text-quaternary)',
                    children: t('strategyEmpty'),
                  }),
            ],
          },
          group.id
        );
      }),
    });
  };

  const activeLoading = isStrategy
    ? strategies.isLoading && !strategies.data
    : ranking.isLoading && !ranking.data;
  const activeError = isStrategy
    ? strategies.isError && !strategies.data
    : ranking.isError && !ranking.data;
  const activeFetching = isStrategy
    ? strategies.isFetching
    : ranking.isFetching;

  if (activeLoading) {
    return jsxs('div', {
      className: 'flex h-full flex-col gap-2 p-3',
      children: [
        jsx(Skeleton, { className: 'h-7 w-full' }),
        jsx(Skeleton, { className: 'h-10 w-full' }),
        jsx(Skeleton, { className: 'h-10 w-full' }),
        jsx(Skeleton, { className: 'h-10 w-full' }),
      ],
    });
  }

  if (activeError) {
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
          children: t('speedRankingUnavailable'),
        }),
        jsx(Button, {
          variant: 'outline',
          size: 'xs',
          onClick: () =>
            isStrategy ? strategies.refetch() : ranking.refetch(),
          children: t('retry'),
        }),
      ],
    });
  }

  const data = ranking.data || { items: [] };

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col text-xs',
    children: [
      jsxs('div', {
        className:
          'flex shrink-0 items-center gap-2 border-b border-(--ui-stroke-secondary) px-2 py-1',
        children: [
          jsx('div', {
            className:
              'min-w-0 flex-1 truncate font-semibold text-(--ui-text-primary)',
            children: t('rankingTitle'),
          }),
          jsx(Tip, {
            label: t('refresh'),
            children: jsx(Button, {
              variant: 'ghost',
              size: 'icon-xs',
              disabled: activeFetching,
              onClick: () =>
                isStrategy ? strategies.refetch() : ranking.refetch(),
              children: jsx(Codicon, {
                name: 'refresh',
                size: '0.8rem',
                spinning: activeFetching,
              }),
            }),
          }),
        ],
      }),
      jsxs('div', {
        className:
          'flex shrink-0 items-center gap-1 border-b border-(--ui-stroke-tertiary) px-2 py-1',
        children: RANKING_TABS.map((item) =>
          jsx(
            'button',
            {
              type: 'button',
              className: cn(
                'rounded px-2 py-0.5 text-[0.6875rem]',
                tab === item.id
                  ? 'bg-(--ui-control-active-background) text-(--ui-text-primary)'
                  : 'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover)'
              ),
              onClick: () => setTab(item.id),
              children: t(item.label),
            },
            item.id
          )
        ),
      }),
      activeError
        ? jsx('div', {
            className:
              'shrink-0 border-b border-(--ui-stroke-tertiary) px-2 py-1 text-[0.6875rem] text-(--ui-text-tertiary)',
            children: t('speedRankingStale'),
          })
        : null,
      jsx(ScrollArea, {
        className: 'min-h-0 flex-1',
        onWheel: () => setHover(null),
        children: isStrategy
          ? renderStrategyList()
          : data.items.length
          ? data.items.map((item, index) => renderStockRow(item, index))
          : jsx('div', {
              className:
                'px-3 py-6 text-center text-(--ui-text-quaternary)',
              children: t('speedRankingEmpty'),
            }),
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
      jsx(StockMinuteCard, {
        hover,
        data: minuteQuery.data,
        isLoading: minuteQuery.isLoading,
        isError: minuteQuery.isError,
      }),
    ],
  });
}

function StatusTicker({ api }) {
  const t = usePluginI18n(ID);
  const snapshot = useSnapshot(api);
  const [hover, setHover] = useState(null);
  const hoverTimer = useRef(null);
  const hoverPosition = useRef({ x: 0, y: 0 });
  const minuteQuery = useQuery({
    queryKey: [ID, 'minute', hover?.code || ''],
    queryFn: () => api.minuteStock(hover.code),
    enabled: Boolean(hover?.code),
    staleTime: 60000,
    retry: 1,
  });
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
    children: [
      ...items.map((item) => {
        if (!item) return null;
        const percent = item.percent === '--' ? '--' : `${item.percent}%`;
        const label = `${item.name} ${item.price} ${percent}`;
        const canShowMinute = /^(sh|sz)/.test(String(item.code || ''));
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
              onMouseEnter: (event) => {
                if (!canShowMinute) return;
                hoverPosition.current = { x: event.clientX, y: event.clientY };
                window.clearTimeout(hoverTimer.current);
                hoverTimer.current = window.setTimeout(() => {
                  setHover({
                    code: item.code,
                    name: item.name,
                    x: hoverPosition.current.x,
                    y: hoverPosition.current.y,
                  });
                }, 300);
              },
              onMouseLeave: () => {
                window.clearTimeout(hoverTimer.current);
                setHover(null);
              },
              children: label,
            }),
          },
          item.code
        );
      }),
      jsx(StockMinuteCard, {
        hover,
        data: minuteQuery.data,
        isLoading: minuteQuery.isLoading,
        isError: minuteQuery.isError,
      }),
    ],
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
        collapseAll: 'Collapse all',
        stockSearchPlaceholder: 'Stock code or name',
        stockSearchHint: 'Search A-shares by code or name',
        stockSearching: 'Searching…',
        stockSearchEmpty: 'No matching A-shares',
        stockSearchFailed: 'Stock search failed. Try again.',
        speedRanking: 'Speed ranking',
        upRanking: 'Gainers',
        downRanking: 'Losers',
        strategy: 'Strategies',
        strategyEmpty: 'No strategy results yet',
        rankingTitle: 'Market ranking',
        speedRankingEmpty: 'No speed ranking data',
        speedRankingUnavailable: 'Speed ranking is unavailable. Try again.',
        speedRankingStale: 'Refresh failed. Showing the last successful ranking.',
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
        watch: 'Watch',
        holding: 'Holding',
        added: 'Added',
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
        watchAdded: 'Added to watch',
        watchRemoved: 'Removed from watch',
        tickerAdded: 'Added to status bar',
        tickerRemoved: 'Removed from status bar',
        movedTo: (name) => `Moved to ${name}`,
      },
      zh: {
        addStock: '添加股票',
        collapseAll: '全部折叠',
        stockSearchPlaceholder: '输入股票代码或名称',
        stockSearchHint: '支持按代码或中文名称查询 A 股',
        stockSearching: '正在查询…',
        stockSearchEmpty: '没有匹配的 A 股',
        stockSearchFailed: '股票查询失败，请重试',
        speedRanking: '涨速榜',
        upRanking: '涨幅榜',
        downRanking: '跌幅榜',
        strategy: '策略选股',
        strategyEmpty: '暂无策略结果',
        rankingTitle: '行情排行',
        speedRankingEmpty: '暂无涨速榜数据',
        speedRankingUnavailable: '涨速榜暂不可用，请重试',
        speedRankingStale: '刷新失败，正在展示上一次成功榜单',
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
        watch: '关注',
        holding: '持仓',
        added: '已添加',
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
        watchAdded: '已添加到关注',
        watchRemoved: '已取消关注',
        tickerAdded: '已加入状态栏',
        tickerRemoved: '已移出状态栏',
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
      render: () => jsx(StockPane, { api, storage: ctx.storage }),
    });
    ctx.register({
      id: 'speed-ranking-sidebar',
      area: 'panes',
      title: '行情排行',
      data: {
        placement: 'left',
        dock: { pane: 'stock-tree-sidebar', pos: 'bottom' },
        width: '300px',
        height: '40vh',
        minHeight: '12rem',
      },
      render: () => jsx(SpeedRankingPane, { api }),
    });
    ctx.register({
      id: 'status-ticker',
      area: 'statusBar.right',
      order: 125,
      render: () => jsx(StatusTicker, { api }),
    });
  },
};
