/**
 * Stock detail pane: 「当日数据 | 5分钟K线」 manual dual view.
 *
 * - `daily` view: quote metrics + intraday price-position bar + trade data
 *   (no chart; per the dsh-leek-fund dual-view spec the daily page stays
 *   lightweight — no 分时图).
 * - `kline` view: 5-minute candlestick SVG. Candles, wicks, MA lines, both
 *   axis tick sets and yestclose/limit references all use the single
 *   `priceToY` mapping from `kline-math.ts`, so a bar's true high/low can
 *   never be clipped while a tick at the same price sits inside the plot.
 *   Candle wicks show each bar's true high/low; no extremum labels or
 *   quote-snapshot reconciliation prompts are drawn (per the hide-extremes
 *   spec).
 *
 * The last, still-forming bar is flagged 进行中 based on `bar.completed`
 * (derived server-side from the exchange clock).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { marketStatus } from '../market-status.js'
import { displayPrice, formatPercent } from '../quote.js'
import {
  barExtremes,
  buildPriceScale,
  maSeries,
  priceToY,
  tickDigitsFor,
  tickFor,
  yToPrice,
} from '../kline-math.js'
import { DailyPanel } from './DailyPanel.js'
import s from './styles.module.css'

export interface KlineBar {
  /** YYYY-MM-DD */
  date: string
  /** HH:mm (bar end time, e.g. 09:35 for the 09:30–09:35 bar). */
  time: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  /** Whether the 5-minute bucket has closed (last bar of the day may still be forming). */
  completed: boolean
}

export interface StockDetailData {
  code: string
  name: string
  price: number
  open: number
  high: number
  low: number
  snapshotHigh?: number
  snapshotLow?: number
  yestclose: number
  limitUp: number
  limitDown: number
  circulatingMarketCap: number
  volumeRatio: number
  /** 今日成交量（手，含当前未收盘桶） */
  volume: number
  volumeFromBars?: boolean
  /** 今日成交额（元） */
  amount: number
  /** 今日换手率（%） */
  turnoverRate: number
  /** 上一交易日最高价（0 = 无数据） */
  yestHigh: number
  /** 上一交易日最低价（0 = 无数据） */
  yestLow: number
  /** 近 60 个交易日最高价（含当前交易日，0 = 无数据） */
  high60: number
  /** 近 60 个交易日最低价（含当前交易日，0 = 无数据） */
  low60: number
  return5?: number | null
  return20?: number | null
  time: string
  /** Latest trading day's bars, ascending (≤ 48). */
  kline5: KlineBar[]
  /** Previous days' 5-minute closes (ascending) — MA warmup context. */
  klineWarmup?: number[]
  ma: {
    ma5: number | null
    ma10: number | null
    ma20: number | null
    ma30: number | null
    ma60: number | null
  }
}

export type DetailViewMode = 'daily' | 'kline'

// ── Chart constants & colors ────────────────────────────────────────────

const UP = '#d05d58'
const DOWN = '#4e9a72'
const GRAY = '#8a919c'
const GRID = '#eef1f4'
const REF = '#b7bdc7'
const AMBER = '#b56c17'

const MA_COLORS: Record<number, string> = {
  5: '#d1a03c',
  10: '#7092d8',
  20: '#b27acc',
  30: '#84939f',
  60: '#399d9e',
}
const MA_PERIODS = [5, 10, 20, 30, 60] as const

const MIN_CHART_W = 620
const PAD = { top: 18, right: 54, bottom: 26, left: 56 }
const REFRESH_MS = 30_000

// ── View-mode persistence (lightweight; no plugin settings plumbing) ────

const VIEW_KEY_PREFIX = 'leek-fund:detailView:'

function viewStorageKey(tabKey: string): string {
  return `${VIEW_KEY_PREFIX}${tabKey}`
}

function readDetailView(tabKey: string): DetailViewMode {
  try {
    return localStorage.getItem(viewStorageKey(tabKey)) === 'kline' ? 'kline' : 'daily'
  } catch {
    return 'daily'
  }
}

function writeDetailView(tabKey: string, mode: DetailViewMode): void {
  try {
    localStorage.setItem(viewStorageKey(tabKey), mode)
  } catch {
    // Storage may be unavailable (private mode); the switch still works per session.
  }
}

// ── Small helpers ───────────────────────────────────────────────────────

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/**
 * Map a bar's end time to the fixed x axis. Morning owns the left half
 * (9:30–11:30), afternoon the right half (13:00–15:00); the lunch recess is
 * never treated as continuous trading. For valid intraday times this equals
 * the 48-slot position, while missing bars simply leave honest gaps.
 */
function xOfTime(time: string, left: number, right: number): number {
  const minutes = timeToMinutes(time)
  const half = (right - left) / 2
  if (minutes <= 690) {
    const t = clamp((minutes - 570) / 120, 0, 1)
    return left + t * half
  }
  const t = clamp((minutes - 780) / 120, 0, 1)
  return left + half + t * half
}

function fmtPrice(detail: StockDetailData, value: number): string {
  return displayPrice(detail.code, detail.name, value)
}

function fmtVolume(volume: number): string {
  if (!Number.isFinite(volume) || volume <= 0) return '--'
  return `${Math.round(volume).toLocaleString('zh-CN')} 手`
}

function validPrice(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

// ── K-line SVG chart ────────────────────────────────────────────────────

interface PlotArea {
  left: number
  right: number
  top: number
  bottom: number
}

/** Numeric label with a thin line, drawn beside the right price axis. */
function axisReference(y: number, text: string, color: string, plot: PlotArea): string {
  return (
    `<line x1="${plot.left}" x2="${plot.right}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}" ` +
    `stroke="${color}" stroke-width="1" stroke-dasharray="4 4" opacity="0.85"/>` +
    `<text x="${plot.right + 6}" y="${(y + 3.5).toFixed(2)}" font-size="10" fill="${color}">${text}</text>`
  )
}

function KlineChart({ detail }: { detail: StockDetailData }): JSX.Element {
  const bars = useMemo(
    () => (Array.isArray(detail.kline5) ? detail.kline5 : []),
    [detail.kline5]
  )
  const warmup = useMemo(
    () => (Array.isArray(detail.klineWarmup) ? detail.klineWarmup : []),
    [detail.klineWarmup]
  )
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [frameWidth, setFrameWidth] = useState(0)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [hoverY, setHoverY] = useState<number | null>(null)

  // The frame is the single source of truth for the chart's width; the SVG
  // viewBox equals its CSS size (1:1, crisp on Retina), so bars can never
  // be pushed below a folded container edge.
  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const measure = (): void => setFrameWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const extremes = useMemo(() => barExtremes(bars), [bars])

  if (bars.length === 0 || extremes === null) {
    return (
      <div className={s.klineEmpty}>
        暂无 5 分钟 K 线数据
        {detail.time ? <span> · 行情时间 {detail.time}</span> : null}
      </div>
    )
  }

  const digits = tickDigitsFor(detail.code, detail.name, bars[bars.length - 1].close)
  const tick = tickFor(detail.code, detail.name, bars[bars.length - 1].close)
  const lastClose = bars[bars.length - 1].close

  const W = Math.max(MIN_CHART_W, frameWidth || MIN_CHART_W)
  const H = Math.round(clamp(W * 0.46, 250, 440))
  const plot: PlotArea = {
    left: PAD.left,
    right: W - PAD.right,
    top: PAD.top,
    bottom: H - PAD.bottom,
  }

  // MA series over 5-minute closes with real previous-day warmup; nulls
  // (window not yet filled) simply skip their segment.
  const allCloses = [...warmup, ...bars.map((bar) => bar.close)]
  const maValues = new Map<number, (number | null)[]>()
  let rawMin = extremes.low
  let rawMax = extremes.high
  for (const period of MA_PERIODS) {
    const values = maSeries(allCloses, period).slice(warmup.length)
    maValues.set(period, values)
    for (const value of values) {
      if (value !== null && Number.isFinite(value)) {
        rawMin = Math.min(rawMin, value)
        rawMax = Math.max(rawMax, value)
      }
    }
  }

  const scale = buildPriceScale(rawMin, rawMax, plot.top, plot.bottom, 0.06, tick)
  const yestcloseY = priceToY(detail.yestclose, scale)
  const lastInProgress = !bars[bars.length - 1].completed
  const hovered = hoverIndex !== null && bars[hoverIndex] ? bars[hoverIndex] : null

  // ── SVG assembly (string templates keep hot-path rendering cheap) ──────
  let svg = ''
  const slotW = (plot.right - plot.left) / 48

  // Grid + dual ticks (percent left, price right) — same priceToY mapping.
  for (let i = 0; i <= 5; i += 1) {
    const price = scale.max - ((scale.max - scale.min) * i) / 5
    const y = priceToY(price, scale)
    const pct = detail.yestclose > 0 ? ((price - detail.yestclose) / detail.yestclose) * 100 : 0
    const tone = pct > 0.005 ? UP : pct < -0.005 ? DOWN : GRAY
    svg +=
      `<line x1="${plot.left}" x2="${plot.right}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}" ` +
      `stroke="${GRID}" stroke-width="1" stroke-dasharray="3 5"/>` +
      `<text x="${plot.left - 8}" y="${(y + 3.5).toFixed(2)}" text-anchor="end" font-size="11" fill="${tone}">` +
      `${formatPercent(pct)}</text>` +
      `<text x="${plot.right + 8}" y="${(y + 3.5).toFixed(2)}" text-anchor="start" font-size="11" fill="#6b7380">` +
      `${displayPrice(detail.code, detail.name, price)}</text>`
  }

  // References: yestclose zero-axis + limit lines (drawn only when visible).
  svg += axisReference(yestcloseY, `昨收 ${fmtPrice(detail, detail.yestclose)}`, REF, plot)
  if (detail.limitUp > 0 && detail.limitUp < scale.max) {
    svg += axisReference(priceToY(detail.limitUp, scale), `涨停 ${fmtPrice(detail, detail.limitUp)}`, '#c79a3c', plot)
  }
  if (detail.limitDown > 0 && detail.limitDown > scale.min) {
    svg += axisReference(priceToY(detail.limitDown, scale), `跌停 ${fmtPrice(detail, detail.limitDown)}`, '#3f8f76', plot)
  }

  // Time axis labels + decorative lunch divider (bars keep their own slots).
  const xLabels: Array<{ text: string; x: number; anchor: string }> = [
    { text: '09:30', x: plot.left, anchor: 'start' },
    { text: '10:30', x: xOfTime('10:30', plot.left, plot.right), anchor: 'middle' },
    { text: '11:30/13:00', x: (plot.left + plot.right) / 2, anchor: 'middle' },
    { text: '14:00', x: xOfTime('14:00', plot.left, plot.right), anchor: 'middle' },
    { text: '15:00', x: plot.right, anchor: 'end' },
  ]
  for (const label of xLabels) {
    svg +=
      `<text x="${label.x.toFixed(2)}" y="${(H - 8).toFixed(2)}" text-anchor="${label.anchor}" ` +
      `font-size="10" fill="#9aa1ab">${label.text}</text>`
  }
  svg +=
    `<line x1="${((plot.left + plot.right) / 2).toFixed(2)}" x2="${((plot.left + plot.right) / 2).toFixed(2)}" ` +
    `y1="${plot.top}" y2="${plot.bottom}" stroke="${GRID}" stroke-dasharray="2 5"/>`

  // Candles: wick line + body rect, red up / green down.
  let wickLines = ''
  let bodyRects = ''
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i]
    const x = xOfTime(bar.time, plot.left, plot.right)
    const up = bar.close >= bar.open
    const color = up ? UP : DOWN
    const highY = priceToY(bar.high, scale)
    const lowY = priceToY(bar.low, scale)
    const openY = priceToY(bar.open, scale)
    const closeY = priceToY(bar.close, scale)
    wickLines +=
      `<line x1="${x.toFixed(2)}" y1="${highY.toFixed(2)}" x2="${x.toFixed(2)}" y2="${lowY.toFixed(2)}" ` +
      `stroke="${color}" stroke-width="1.3"/>`
    const bodyY = Math.min(openY, closeY)
    const bodyH = Math.max(1, Math.abs(closeY - openY))
    const bodyW = Math.max(2, Math.min(5.5, slotW * 0.68))
    bodyRects +=
      `<rect x="${(x - bodyW / 2).toFixed(2)}" y="${bodyY.toFixed(2)}" width="${bodyW.toFixed(2)}" ` +
      `height="${bodyH.toFixed(2)}" fill="${color}"/>`
  }
  svg += wickLines + bodyRects

  // MA polylines (5-minute SMA with warmup; values are on the same scale).
  for (const period of MA_PERIODS) {
    const values = maValues.get(period)!
    const points: string[] = []
    for (let i = 0; i < bars.length; i += 1) {
      const value = values[i]
      if (value === null || !Number.isFinite(value)) continue
      const x = xOfTime(bars[i].time, plot.left, plot.right)
      points.push(`${x.toFixed(2)},${priceToY(value, scale).toFixed(2)}`)
    }
    if (points.length > 1) {
      svg += `<polyline fill="none" stroke="${MA_COLORS[period]}" stroke-width="1.4" opacity="0.92" ` +
        `stroke-linecap="round" stroke-linejoin="round" points="${points.join(' ')}"/>`
    }
  }

  // In-progress marker for the still-forming last bar.
  if (lastInProgress && bars.length > 0) {
    const last = bars[bars.length - 1]
    const x = xOfTime(last.time, plot.left, plot.right)
    const y = clamp(priceToY(last.high, scale) - 14, plot.top + 16, plot.bottom - 10)
    svg +=
      `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle" font-size="10" fill="${AMBER}">` +
      `进行中</text>`
  }

  // Hover crosshair: vertical line on the nearest bar, horizontal line at
  // the cursor (its reference price comes from the inverse mapping).
  if (hovered && hoverY !== null) {
    const barX = xOfTime(hovered.time, plot.left, plot.right)
    const crossColor = 'rgba(90, 110, 140, 0.55)'
    svg +=
      `<line x1="${barX.toFixed(2)}" x2="${barX.toFixed(2)}" y1="${plot.top}" y2="${plot.bottom}" ` +
      `stroke="${crossColor}" stroke-width="1" stroke-dasharray="3 4"/>` +
      `<line x1="${plot.left}" x2="${plot.right}" y1="${hoverY.toFixed(2)}" y2="${hoverY.toFixed(2)}" ` +
      `stroke="${crossColor}" stroke-width="1" stroke-dasharray="3 4"/>`
    const refPrice = yToPrice(hoverY, scale)
    if (Number.isFinite(refPrice)) {
      svg +=
        `<text x="${(plot.right + 8).toFixed(2)}" y="${(hoverY - 3).toFixed(2)}" ` +
        `font-size="10" fill="#4d5662" paint-order="stroke" stroke="#fff" stroke-width="3">` +
        `${displayPrice(detail.code, detail.name, refPrice)}</text>`
    }
  }

  return (
    <div className={s.klineBlock}>
      <div className={s.chartFrame} ref={frameRef}>
        <svg
          className={s.chartSvg}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${detail.name} 5 分钟 K 线`}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            const x = event.clientX - rect.left
            const y = event.clientY - rect.top
            if (y < plot.top || y > plot.bottom) {
              setHoverIndex(null)
              setHoverY(null)
              return
            }
            setHoverY(y)
            let nearest = -1
            let nearestDx = slotW * 0.62
            for (let i = 0; i < bars.length; i += 1) {
              const dx = Math.abs(xOfTime(bars[i].time, plot.left, plot.right) - x)
              if (dx < nearestDx) {
                nearestDx = dx
                nearest = i
              }
            }
            setHoverIndex(nearest >= 0 ? nearest : null)
          }}
          onMouseLeave={() => {
            setHoverIndex(null)
            setHoverY(null)
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      {hovered ? (
        <div className={s.ohlcChip}>
          <span className={s.ohlcTime}>
            {hovered.time}
            {hovered.completed ? '' : <span className={s.ohlcLive}> · 进行中</span>}
          </span>
          <span>开 {displayPrice(detail.code, detail.name, hovered.open)}</span>
          <span>高 {displayPrice(detail.code, detail.name, hovered.high)}</span>
          <span>低 {displayPrice(detail.code, detail.name, hovered.low)}</span>
          <span>收 {displayPrice(detail.code, detail.name, hovered.close)}</span>
          <span className={s.ohlcMuted}>量 {fmtVolume(hovered.volume)}</span>
          <span className={s.ohlcMuted}>最新 {displayPrice(detail.code, detail.name, lastClose)}</span>
        </div>
      ) : (
        <div className={s.ohlcHint}>悬停蜡烛查看分时 OHLC</div>
      )}
    </div>
  )
}

// ── Pane: header + view switch + body ───────────────────────────────────

export function StockDetailPane({
  code,
  name,
  tabKey,
  onClose,
}: {
  code: string
  name: string
  tabKey: string
  onClose?: () => void
}): JSX.Element {
  const [detail, setDetail] = useState<StockDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<DetailViewMode>(() => readDetailView(tabKey))

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setInterval> | undefined
    const controller = new AbortController()

    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/leek-fund/api/quoteDetail', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code }),
          signal: controller.signal,
        })
        const json = (await res.json()) as StockDetailData & { error?: string }
        if (!active) return
        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
        setDetail(json)
        setError(null)
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === 'AbortError')) return
        setError(err instanceof Error ? err.message : '加载失败')
      }
    }

    void load()
    timer = setInterval(() => void load(), REFRESH_MS)
    return () => {
      active = false
      if (timer) clearInterval(timer)
      controller.abort()
    }
  }, [code])

  const switchView = (mode: DetailViewMode): void => {
    setView(mode)
    writeDetailView(tabKey, mode)
  }

  const price = detail?.price ?? 0
  const hasValidPrice = validPrice(price)
  const updownRaw = detail && hasValidPrice && validPrice(detail.yestclose) ? price - detail.yestclose : null
  const updown = updownRaw != null && Number.isFinite(updownRaw) ? updownRaw : null
  const percentRaw = updown !== null && detail && validPrice(detail.yestclose)
    ? (updown / detail.yestclose) * 100
    : null
  const percent = percentRaw != null && Number.isFinite(percentRaw) ? percentRaw : null
  const priceTone = percent == null ? '' : percent > 0.005 ? ` ${s.toneUp}` : percent < -0.005 ? ` ${s.toneDown}` : ''
  const status = marketStatus(detail?.time ?? '')

  return (
    <div className={s.detailPane}>
      <div className={s.paneHeader}>
        <div className={s.paneTitleWrap}>
          <div className={s.paneTitle}>
            {name}
            <span className={s.paneCode}>{code.toUpperCase()}</span>
          </div>
          {detail ? (
            <div className={s.panePrice + priceTone}>
              {hasValidPrice ? displayPrice(code, name, price) : '--'}
              {updown !== null && percent !== null ? (
                <span className={s.paneChange}>
                  {updown >= 0 ? '+' : ''}
                  {displayPrice(code, name, updown)} / {formatPercent(percent)}
                </span>
              ) : null}
            </div>
          ) : (
            <div className={s.panePrice}>--</div>
          )}
        </div>
        <div className={s.viewSwitch} role="tablist" aria-label="详情视图">
          <button
            type="button"
            className={s.viewSwitchBtn + (view === 'daily' ? ` ${s.active}` : '')}
            aria-selected={view === 'daily'}
            onClick={() => switchView('daily')}
          >
            当日数据
          </button>
          <button
            type="button"
            className={s.viewSwitchBtn + (view === 'kline' ? ` ${s.active}` : '')}
            aria-selected={view === 'kline'}
            onClick={() => switchView('kline')}
          >
            5分钟K线
          </button>
        </div>
        {onClose && (
          <button
            type="button"
            className={s.paneClose}
            aria-label="关闭详情"
            onClick={onClose}
          >
            ×
          </button>
        )}
      </div>

      {detail ? (
        <>
          <div className={s.paneStatus}>
            <span>{status.label}</span>
            {detail.time ? <span className={s.paneStatusTime}>行情时间 {detail.time}</span> : null}
          </div>
          {view === 'daily' ? (
            <DailyPanel detail={detail} />
          ) : (
            <>
              <div className={s.maRow}>
                {MA_PERIODS.map((period) => (
                  <span key={period}>
                    <i style={{ background: MA_COLORS[period] }} />
                    MA{period}{' '}
                    <b>{detail.ma?.[`ma${period}` as keyof typeof detail.ma] != null
                      ? displayPrice(code, name, detail.ma[`ma${period}` as keyof typeof detail.ma] as number)
                      : '--'}</b>
                  </span>
                ))}
              </div>
              <KlineChart detail={detail} />
            </>
          )}
        </>
      ) : error ? (
        <div className={s.detailError}>详情加载失败：{error}</div>
      ) : (
        <div className={s.detailLoading}>加载中…</div>
      )}
    </div>
  )
}
