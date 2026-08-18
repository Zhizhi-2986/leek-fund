/**
 * Expandable stock detail: intraday minute chart (SVG), today's high/low,
 * volume-weighted average price, and MA5/MA10/MA20 from daily closes.
 */
import { useEffect, useState } from 'react'
import { displayPrice, formatPercent } from '../quote.js'
import s from './styles.module.css'

export interface StockDetailData {
  code: string
  name: string
  price: number
  high: number
  low: number
  yestclose: number
  time: string
  minute: { time: string; price: number; avgPrice: number; volume: number }[]
  ma: { ma5: number | null; ma10: number | null; ma20: number | null }
}

const WIDTH = 300
const HEIGHT = 120
const PAD = { top: 8, right: 8, bottom: 18, left: 48 }

function priceColor(price: number, yestclose: number): string {
  if (price > yestclose) return '#e02e24'
  if (price < yestclose) return '#2e9e4f'
  return '#888'
}

/** 9:30 -> 0 in the fixed 9:30-11:30 / 13:00-15:00 axis. */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** Map a clock time to the fixed x axis: each half-session owns half the width. */
function xOf(time: string): number {
  const minutes = timeToMinutes(time)
  const halfW = (WIDTH - PAD.left - PAD.right) / 2
  if (minutes <= 690) {
    // morning 9:30 (570) -> 11:30 (690)
    const t = Math.max(0, Math.min(1, (minutes - 570) / 120))
    return PAD.left + t * halfW
  }
  // afternoon 13:00 (780) -> 15:00 (900)
  const t = Math.max(0, Math.min(1, (minutes - 780) / 120))
  return PAD.left + halfW + t * halfW
}

function buildPoints(
  minute: { time: string; price: number; avgPrice: number }[],
  key: 'price' | 'avgPrice',
  ymin: number,
  ymax: number
): string {
  const span = ymax - ymin || 1
  return minute
    .map((point) => {
      const x = xOf(point.time)
      const y = PAD.top + (1 - (point[key] - ymin) / span) * (HEIGHT - PAD.top - PAD.bottom)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function yOf(value: number, ymin: number, ymax: number): number {
  const span = ymax - ymin || 1
  return PAD.top + (1 - (value - ymin) / span) * (HEIGHT - PAD.top - PAD.bottom)
}

function MinuteChart({ detail }: { detail: StockDetailData }): JSX.Element {
  const { minute, high, low, yestclose } = detail
  const prices = minute.map((point) => point.price)
  if (prices.length === 0) return <div className={s.hint}>暂无分时数据</div>
  const rawMin = Math.min(low || Math.min(...prices), yestclose || Math.min(...prices))
  const rawMax = Math.max(high || Math.max(...prices), yestclose || Math.max(...prices))
  const ymin = rawMin - (rawMax - rawMin) * 0.08
  const ymax = rawMax + (rawMax - rawMin) * 0.08
  const priceLine = buildPoints(minute, 'price', ymin, ymax)
  const avgLine = buildPoints(minute, 'avgPrice', ymin, ymax)
  const color = priceColor(prices[prices.length - 1], yestclose)

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" style={{ width: '100%', height: 130 }}>
      {/* yesterday close reference line */}
      <line
        x1={PAD.left}
        x2={WIDTH - PAD.right}
        y1={yOf(yestclose, ymin, ymax)}
        y2={yOf(yestclose, ymin, ymax)}
        stroke="#999"
        strokeDasharray="3 3"
        strokeWidth="0.8"
      />

      {/* y-axis labels: high / yestclose / low with % vs yestclose */}
      <text x={PAD.left - 44} y={yOf(high, ymin, ymax)} fontSize="7" fill="#e02e24" textAnchor="start">
        {displayPrice(detail.code, detail.name, high)}
        {yestclose > 0 ? ` (${formatPercent(((high - yestclose) / yestclose) * 100)})` : ''}
      </text>
      <text x={PAD.left - 44} y={yOf(yestclose, ymin, ymax) + 8} fontSize="7" fill="#999">
        昨收 {displayPrice(detail.code, detail.name, yestclose)}
      </text>
      <text x={PAD.left - 44} y={HEIGHT - PAD.bottom} fontSize="7" fill="#2e9e4f">
        {displayPrice(detail.code, detail.name, low)}
        {yestclose > 0 ? ` (${formatPercent(((low - yestclose) / yestclose) * 100)})` : ''}
      </text>
      {/* price line */}
      <polyline
        points={priceLine}
        fill="none"
        stroke={color}
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      {/* average price line */}
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
      {/* Fixed full-session time axis; the curve itself is drawn at its real
           clock positions, so a morning session leaves the afternoon blank. */}
      <text x={PAD.left} y={HEIGHT - 4} fontSize="7" fill="#999">
        9:30
      </text>
      <text x={WIDTH / 2 - 18} y={HEIGHT - 4} fontSize="7" fill="#999">
        11:30/13:00
      </text>
      <text x={WIDTH - PAD.right - 16} y={HEIGHT - 4} fontSize="7" fill="#999">
        15:00
      </text>
    </svg>
  )
}

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

  const lastPrice = detail.minute.at(-1)?.price ?? detail.price
  const lastAvg = detail.minute.at(-1)?.avgPrice ?? 0
  const color = priceColor(lastPrice, detail.yestclose)
  const maColor = (value: number | null, ref: number): string => priceColor(value ?? ref, ref)

  return (
    <div className={`${s.detail} ${s.level2}`}>
      <div className={s.detailStats}>
        <span className={color}>
          现价 {displayPrice(code, name, lastPrice)}
          {detail.yestclose > 0 && ` (${formatPercent(((lastPrice - detail.yestclose) / detail.yestclose) * 100)})`}
        </span>
        <span>最高 <b>{displayPrice(code, name, detail.high)}</b></span>
        <span>最低 <b>{displayPrice(code, name, detail.low)}</b></span>
        <span>均价 <b className={maColor(lastAvg, lastPrice)}>{lastAvg > 0 ? displayPrice(code, name, lastAvg) : '--'}</b></span>
        <span>昨收 {displayPrice(code, name, detail.yestclose)}</span>
      </div>
      <MinuteChart detail={detail} />
      <div className={s.detailMa}>
        <span>
          MA5 <b className={maColor(detail.ma.ma5, lastPrice)}>{detail.ma.ma5 !== null ? displayPrice(code, name, detail.ma.ma5) : '--'}</b>
        </span>
        <span>
          MA10 <b className={maColor(detail.ma.ma10, lastPrice)}>{detail.ma.ma10 !== null ? displayPrice(code, name, detail.ma.ma10) : '--'}</b>
        </span>
        <span>
          MA20 <b className={maColor(detail.ma.ma20, lastPrice)}>{detail.ma.ma20 !== null ? displayPrice(code, name, detail.ma.ma20) : '--'}</b>
        </span>
        <span className={s.detailHint}>5/10/20 日均线（按日收盘价）</span>
      </div>
    </div>
  )
}
