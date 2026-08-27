/**
 * Expandable stock detail: intraday minute chart (SVG) with percentage-based
 * Y-axis (±10% default, auto-switch to ±20%), volume-weighted average price,
 * 0-axis reference, MA5/MA10/MA20, and a market overview
 * panel showing up/down counts, market volume and estimated close volume.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { displayPrice } from '../quote.js'
import { fetchMarketOverview, type MarketOverview } from './api.js'
import s from './styles.module.css'

export interface StockDetailData {
  code: string
  name: string
  price: number
  high: number
  low: number
  yestclose: number
  limitUp: number
  limitDown: number
  circulatingMarketCap: number
  volumeRatio: number
  time: string
  minute: { time: string; price: number; avgPrice: number; volume: number }[]
  ma: { ma5: number | null; ma10: number | null; ma20: number | null }
}

// ── Chart layout constants ─────────────────────────────────────────────

const WIDTH = 300
const VIEW_HEIGHT = 180
const PAD = { top: 10, right: 44, bottom: 6, left: 50 }
/** Bottom of the price chart area. */
const PRICE_BOTTOM = 152
/** Half of the inner width (morning / afternoon each get half). */
const HALF_W = (WIDTH - PAD.left - PAD.right) / 2 // 103
/** Price chart inner height. */
const PRICE_H = PRICE_BOTTOM - PAD.top // 142

/** Low-key color for up/down figures (kept subtle per user request). */
const LOWKEY = '#8a8a8a'

// ── Colors ─────────────────────────────────────────────────────────────

/** Line color for the minute chart (red/green for trend readability). */
function priceColor(price: number, yestclose: number): string {
  if (price > yestclose) return '#e02e24'
  if (price < yestclose) return '#2e9e4f'
  return '#888'
}

// ── Time helpers ───────────────────────────────────────────────────────

/** 9:30 -> 0 in the fixed 9:30-11:30 / 13:00-15:00 axis. */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** Map a clock time to the fixed x axis: each half-session owns half the width. */
function xOf(time: string): number {
  const minutes = timeToMinutes(time)
  if (minutes <= 690) {
    // morning 9:30 (570) -> 11:30 (690)
    const t = Math.max(0, Math.min(1, (minutes - 570) / 120))
    return PAD.left + t * HALF_W
  }
  // afternoon 13:00 (780) -> 15:00 (900)
  const t = Math.max(0, Math.min(1, (minutes - 780) / 120))
  return PAD.left + HALF_W + t * HALF_W
}

/** Y position for a given percentage value in a ±halfRange chart. */
function pctY(percent: number, halfRange: number): number {
  const ratio = percent / halfRange
  return PAD.top + PRICE_H / 2 - ratio * (PRICE_H / 2)
}

/** Build a polyline points string for a price series in percentage space. */
function buildPctPoints(
  minute: { time: string; price: number }[],
  yestclose: number,
  halfRange: number
): string {
  return minute
    .map((point) => {
      const x = xOf(point.time)
      const pct = yestclose > 0 ? ((point.price - yestclose) / yestclose) * 100 : 0
      const y = pctY(pct, halfRange)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/** Build a polyline points string for avgPrice series in percentage space. */
function buildAvgPctPoints(
  minute: { time: string; avgPrice: number }[],
  yestclose: number,
  halfRange: number
): string {
  return minute
    .map((point) => {
      const x = xOf(point.time)
      const pct = yestclose > 0 && point.avgPrice > 0
        ? ((point.avgPrice - yestclose) / yestclose) * 100
        : 0
      const y = pctY(pct, halfRange)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

// ── Format helpers ─────────────────────────────────────────────────────

/** Format a number with appropriate precision for price display. */
function fmtPrice(value: number, digits = 2): string {
  return value.toFixed(digits)
}

/** 格式化金额：元 → 万/亿 */
function fmtAmount(value: number): string {
  if (!value || value <= 0) return '--'
  if (value >= 1e8) return (value / 1e8).toFixed(2) + '亿'
  if (value >= 1e4) return (value / 1e4).toFixed(2) + '万'
  return value.toFixed(2)
}

// ── MinuteChart component ──────────────────────────────────────────────

function MinuteChart({ detail }: { detail: StockDetailData }): JSX.Element {
  const { minute, yestclose, limitUp, limitDown } = detail
  const prices = minute.map((p) => p.price)
  if (prices.length === 0) return <div className={s.hint}>暂无分时数据</div>
  if (yestclose <= 0) return <div className={s.hint}>缺少昨收数据</div>

  // 计算所有点的涨跌幅
  const pcts = prices.map((p) => yestclose > 0 ? ((p - yestclose) / yestclose) * 100 : 0)
  const maxPct = Math.max(...pcts, 0)
  const minPct = Math.min(...pcts, 0)
  const absMax = Math.max(Math.abs(maxPct), Math.abs(minPct))

  // 确定 Y 轴百分比范围：默认 ±10%，超限自动切换 ±20%
  let halfRange = 10
  if (absMax > 10) halfRange = 20

  // ── 价格线 & 均价线 ──
  const priceLine = buildPctPoints(minute, yestclose, halfRange)
  const avgLine = buildAvgPctPoints(minute, yestclose, halfRange)
  const lastColor = priceColor(prices[prices.length - 1], yestclose)

  // ── Y 轴刻度（百分比）──
  const pctTicks = [-halfRange, -halfRange / 2, 0, halfRange / 2, halfRange]

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${VIEW_HEIGHT}`}
      style={{ width: '100%', display: 'block' }}
    >
      {/* ═══ Price chart area ═══ */}

      {/* Grid lines at each tick */}
      {pctTicks.map((pct) => (
        <line
          key={`g-${pct}`}
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={pctY(pct, halfRange)}
          y2={pctY(pct, halfRange)}
          stroke={pct === 0 ? '#777' : '#333'}
          strokeWidth={pct === 0 ? '1' : '0.5'}
          strokeDasharray={pct === 0 ? 'none' : '3 3'}
        />
      ))}

      {/* 0-axis label */}
      <text
        x={PAD.left - 4}
        y={pctY(0, halfRange) + 2.5}
        fontSize="7"
        fill="#999"
        textAnchor="end"
      >
        0.00%
      </text>

      {/* Limit-up reference line */}
      {limitUp > 0 && limitUp > yestclose && (
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={pctY(((limitUp - yestclose) / yestclose) * 100, halfRange)}
          y2={pctY(((limitUp - yestclose) / yestclose) * 100, halfRange)}
          stroke="#e02e24"
          strokeDasharray="2 4"
          strokeWidth="0.6"
        />
      )}

      {/* Limit-down reference line */}
      {limitDown > 0 && limitDown < yestclose && (
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={pctY(((limitDown - yestclose) / yestclose) * 100, halfRange)}
          y2={pctY(((limitDown - yestclose) / yestclose) * 100, halfRange)}
          stroke="#2e9e4f"
          strokeDasharray="2 4"
          strokeWidth="0.6"
        />
      )}

      {/* Price line */}
      <polyline
        points={priceLine}
        fill="none"
        stroke={lastColor}
        strokeWidth="1.2"
        vectorEffect="non-scaling-stroke"
      />

      {/* Average price line */}
      {minute.some((point) => point.avgPrice > 0) && (
        <polyline
          points={avgLine}
          fill="none"
          stroke="#d89000"
          strokeWidth="1"
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {/* ─── Left Y-axis: percentage ─── */}
      {pctTicks.map((pct) => {
        const y = pctY(pct, halfRange)
        if (pct === 0) return null // 0-axis already labeled above
        const tickColor = pct > 0 ? '#e02e24' : '#2e9e4f'
        return (
          <text
            key={`lp-${pct}`}
            x={PAD.left - 4}
            y={y + 2.5}
            fontSize="7"
            fill={tickColor}
            textAnchor="end"
          >
            {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
          </text>
        )
      })}

      {/* ─── Right Y-axis: price ─── */}
      {pctTicks.map((pct) => {
        const y = pctY(pct, halfRange)
        if (pct === 0) return null
        const priceVal = yestclose * (1 + pct / 100)
        const tickColor = pct > 0 ? '#e02e24' : '#2e9e4f'
        return (
          <text
            key={`rp-${pct}`}
            x={WIDTH - PAD.right + 4}
            y={y + 2.5}
            fontSize="7"
            fill={tickColor}
            textAnchor="start"
          >
            {fmtPrice(priceVal)}
          </text>
        )
      })}

      {/* ─── Limit up/down labels ─── */}
      {limitUp > 0 && limitUp > yestclose && (
        <text
          x={WIDTH - PAD.right}
          y={pctY(((limitUp - yestclose) / yestclose) * 100, halfRange) - 2}
          fontSize="7"
          fill="#e02e24"
          textAnchor="end"
        >
          涨停 {fmtPrice(limitUp)}
        </text>
      )}
      {limitDown > 0 && limitDown < yestclose && (
        <text
          x={WIDTH - PAD.right}
          y={pctY(((limitDown - yestclose) / yestclose) * 100, halfRange) + 10}
          fontSize="7"
          fill="#2e9e4f"
          textAnchor="end"
        >
          跌停 {fmtPrice(limitDown)}
        </text>
      )}

      {/* ─── Time axis labels ─── */}
      <text x={PAD.left} y={PRICE_BOTTOM + 22} fontSize="7" fill="#999" textAnchor="middle">9:30</text>
      <text x={PAD.left + HALF_W * 0.5} y={PRICE_BOTTOM + 22} fontSize="7" fill="#999" textAnchor="middle">10:30</text>
      <text x={PAD.left + HALF_W} y={PRICE_BOTTOM + 22} fontSize="7" fill="#999" textAnchor="middle">11:30/13:00</text>
      <text x={PAD.left + HALF_W + HALF_W * 0.5} y={PRICE_BOTTOM + 22} fontSize="7" fill="#999" textAnchor="middle">14:00</text>
      <text x={WIDTH - PAD.right} y={PRICE_BOTTOM + 22} fontSize="7" fill="#999" textAnchor="middle">15:00</text>
    </svg>
  )
}

// ── MarketOverviewPanel component ──────────────────────────────────────

function MarketOverviewPanel(): JSX.Element {
  const [overview, setOverview] = useState<MarketOverview | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const load = () => {
      fetchMarketOverview()
        .then((data) => { if (!cancelled) setOverview(data) })
        .catch(() => {})
    }

    load()
    timer = setInterval(load, 30000)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [])

  if (!overview || (overview.upCount === 0 && overview.downCount === 0)) {
    return <div className={s.marketOverview} />
  }

  const isUp = overview.upCount >= overview.downCount

  return (
    <div className={s.marketOverview}>
      <div className={s.moRow}>
        <span className={s.moItem}>
          <span className={s.moLabel}>上涨</span>
          <span className={`${s.moValue} ${s.up}`}>{overview.upCount}</span>
        </span>
        <span className={s.moItem}>
          <span className={s.moLabel}>下跌</span>
          <span className={`${s.moValue} ${s.down}`}>{overview.downCount}</span>
        </span>
        <span className={s.moItem}>
          <span className={s.moLabel}>平盘</span>
          <span className={s.moValue}>{overview.flatCount}</span>
        </span>
      </div>
      <div className={s.moRow}>
        <span className={s.moItem}>
          <span className={s.moLabel}>成交额</span>
          <span className={s.moValue}>{fmtAmount(overview.totalAmount)}</span>
        </span>
        <span className={s.moItem}>
          <span className={s.moLabel}>预计收盘</span>
          <span className={s.moValue}>{fmtAmount(overview.estimatedCloseAmount)}</span>
        </span>
      </div>
    </div>
  )
}

// ── StockDetail component ──────────────────────────────────────────────

export function StockDetail({ code, name }: { code: string; name: string }): JSX.Element {
  const [detail, setDetail] = useState<StockDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/leek-fund/api/quoteDetail', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then((res) => res.json())
      .then((json: StockDetailData & { error?: string }) => {
        if (cancelled) return
        if (json.error) setError(json.error)
        else setDetail(json)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err))
      })
    return () => {
      cancelled = true
    }
  }, [code])

  if (error) return <div className={`${s.detail} ${s.level2}`}>详情加载失败：{error}</div>
  if (!detail) return <div className={`${s.detail} ${s.level2}`}>加载详情…</div>

  const lastAvg = detail.minute.at(-1)?.avgPrice ?? 0

  return (
    <div className={`${s.detail} ${s.level2}`}>
      {/* Price stats row */}
      <div className={s.detailStats}>
        {detail.limitUp > 0 && <span>涨停 <b style={{ color: '#e02e24' }}>{displayPrice(code, name, detail.limitUp)}</b></span>}
        {detail.limitDown > 0 && <span>跌停 <b style={{ color: '#2e9e4f' }}>{displayPrice(code, name, detail.limitDown)}</b></span>}
        <span>最高 <b>{displayPrice(code, name, detail.high)}</b></span>
        <span>最低 <b>{displayPrice(code, name, detail.low)}</b></span>
        <span>均价 <b>{lastAvg > 0 ? displayPrice(code, name, lastAvg) : '--'}</b></span>
        {detail.circulatingMarketCap > 0 && (
          <span>流通市值 <b>{fmtAmount(detail.circulatingMarketCap)}</b></span>
        )}
        {detail.volumeRatio > 0 && (
          <span>量比 <b>{detail.volumeRatio.toFixed(2)}</b></span>
        )}
      </div>

      {/* Minute chart */}
      <MinuteChart detail={detail} />

      {/* MA values */}
      <div className={s.detailMa}>
        <span>MA5 <b>{detail.ma.ma5 !== null ? displayPrice(code, name, detail.ma.ma5) : '--'}</b></span>
        <span>MA10 <b>{detail.ma.ma10 !== null ? displayPrice(code, name, detail.ma.ma10) : '--'}</b></span>
        <span>MA20 <b>{detail.ma.ma20 !== null ? displayPrice(code, name, detail.ma.ma20) : '--'}</b></span>
        <span className={s.detailHint}>5/10/20 日均线（按日收盘价）</span>
      </div>

      {/* Market overview */}
      <MarketOverviewPanel />
    </div>
  )
}
