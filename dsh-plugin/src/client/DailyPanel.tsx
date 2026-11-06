import {
  calcDayAverage,
  calcIntradayAmplitude,
  calcPercentAboveLow,
  calcPercentFromHigh,
  calcRangePosition,
} from '../daily-math.js'
import { displayPrice, formatPercent } from '../quote.js'
import { formatVolumeHands, formatYuanAmount } from '../trade-format.js'
import type { StockDetailData } from './StockDetail.js'
import s from './styles.module.css'

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

function validPrice(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function toneFor(value: number | null | undefined): string | undefined {
  if (value == null || !Number.isFinite(value)) return undefined
  return value > 0.005 ? s.toneUp : value < -0.005 ? s.toneDown : undefined
}

function fmtPrice(detail: StockDetailData, value: number): string {
  return displayPrice(detail.code, detail.name, value)
}

function signedPrice(detail: StockDetailData, value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '--'
  return `${value > 0 ? '+' : ''}${fmtPrice(detail, Math.abs(value))}`
}

function PriceMetric({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: string
}): JSX.Element {
  return (
    <div className={s.metricCell}>
      <span className={s.metricLabel}>{label}</span>
      <b className={tone}>{value}</b>
    </div>
  )
}

function RangeCard({ detail }: { detail: StockDetailData }): JSX.Element {
  const { price, high, low, yestclose } = detail
  const hasRange = validPrice(low) && validPrice(high) && high > low
  const position = hasRange ? calcRangePosition(price, low, high) : null
  const previousPosition = hasRange ? calcRangePosition(yestclose, low, high) : null
  const priceOutside = position !== null && (position < 0 || position > 100)
  const previousOutside = previousPosition !== null && (previousPosition < 0 || previousPosition > 100)
  const average = detail.volumeFromBars ? null : calcDayAverage(detail.amount, detail.volume)
  const relativeAverageRaw = average && validPrice(price) ? (price / average - 1) * 100 : null
  const relativeAverage = relativeAverageRaw != null && Number.isFinite(relativeAverageRaw) ? relativeAverageRaw : null
  const amplitude = calcIntradayAmplitude(high, low, yestclose)
  const highDifference = validPrice(price) && validPrice(high) ? price - high : null
  const lowDifference = validPrice(price) && validPrice(low) ? price - low : null
  const stats = [
    { label: '日内均价（估算）', value: average ? fmtPrice(detail, average) : '--' },
    { label: '相对均价', value: relativeAverage == null ? '--' : formatPercent(relativeAverage), tone: toneFor(relativeAverage) },
    { label: '距今日高点', value: signedPrice(detail, highDifference), tone: toneFor(highDifference) },
    { label: '较今日低点', value: signedPrice(detail, lowDifference), tone: toneFor(lowDifference) },
    { label: '日内振幅', value: amplitude == null ? '--' : `${amplitude.toFixed(2)}%` },
  ]
  return (
    <section className={s.dailyCard}>
      <h2 className={s.dailyTitle}>今日价格区间</h2>
      {hasRange ? (
        <div className={s.rangeArea}>
          <div className={s.rangeBarWrap}>
            {position !== null ? (
              <span className={s.rangeCurrentLabel} style={{ left: `${clamp(position, 4, 96)}%` }}>
                {fmtPrice(detail, price)}
              </span>
            ) : null}
            <div className={s.rangeTrack} aria-label="日内高低价范围">
              {previousPosition !== null && !previousOutside ? (
                <span className={s.rangePrevMarker} style={{ left: `${previousPosition}%` }} />
              ) : null}
              {position !== null ? (
                <span className={s.rangeDot} style={{ left: `${clamp(position, 0, 100)}%` }} />
              ) : null}
            </div>
            {previousPosition !== null && !previousOutside ? (
              <span className={s.rangePrevLabel} style={{ left: `${clamp(previousPosition, 8, 92)}%` }}>
                昨收 {fmtPrice(detail, yestclose)}
              </span>
            ) : null}
          </div>
          <div className={s.rangeLabels}>
            <span><b>{fmtPrice(detail, low)}</b> 今日最低</span>
            <span>今日最高 <b>{fmtPrice(detail, high)}</b></span>
          </div>
          {priceOutside ? <p className={s.rangeWarning}>现价超出当日高低价范围，请核对行情时点</p> : null}
          {previousOutside ? <p className={s.rangeHint}>昨收在当日区间外，未绘制参考刻度</p> : null}
        </div>
      ) : (
        <div className={s.rangeUnavailable}>当日高低价暂不可用</div>
      )}
      <div className={s.rangeStats}>
        {stats.map((stat) => (
          <div className={s.rangeStat} key={stat.label}>
            <span className={s.metricLabel}>{stat.label}</span>
            <b className={stat.tone}>{stat.value}</b>
          </div>
        ))}
      </div>
    </section>
  )
}

function TradeCard({ detail }: { detail: StockDetailData }): JSX.Element {
  const rows = [
    { label: '成交量', value: formatVolumeHands(detail.volume) },
    { label: '成交额', value: formatYuanAmount(detail.amount) },
    { label: '换手率', value: Number.isFinite(detail.turnoverRate) && detail.turnoverRate > 0 ? `${detail.turnoverRate.toFixed(2)}%` : '--' },
    { label: '量比', value: Number.isFinite(detail.volumeRatio) && detail.volumeRatio > 0 ? detail.volumeRatio.toFixed(2) : '--' },
    { label: '流通市值', value: Number.isFinite(detail.circulatingMarketCap) && detail.circulatingMarketCap > 0 ? `${(detail.circulatingMarketCap / 1e8).toFixed(2)} 亿` : '--' },
  ]
  return (
    <section className={s.dailyCard}>
      <h2 className={s.dailyTitle}>成交与活跃度</h2>
      <div className={s.tradeGrid}>
        {rows.map((row) => (
          <div className={s.tradeLine} key={row.label}>
            <span>{row.label}</span><b>{row.value}</b>
          </div>
        ))}
      </div>
    </section>
  )
}

function StageCard({ detail }: { detail: StockDetailData }): JSX.Element {
  const position = calcRangePosition(detail.price, detail.low60, detail.high60)
  const highDistance = calcPercentFromHigh(detail.price, detail.high60)
  const lowDistance = calcPercentAboveLow(detail.price, detail.low60)
  const periods = [
    { label: '近5日涨跌幅', value: detail.return5 },
    { label: '近20日涨跌幅', value: detail.return20 },
  ]
  const outOfRange = position !== null && (position < 0 || position > 100)
  return (
    <section className={s.dailyCard}>
      <h2 className={s.dailyTitle}>阶段表现</h2>
      <div className={s.stageGrid}>
        {periods.map((period) => (
          <div className={s.stageMetric} key={period.label}>
            <span>{period.label}</span>
            <b className={toneFor(period.value)}>{period.value == null || !Number.isFinite(period.value) ? '--' : formatPercent(period.value)}</b>
          </div>
        ))}
        <div className={s.stagePosition}>
          <span>60日区间位置</span>
          <b>{position == null ? '--' : `${position.toFixed(1)}%`}</b>
          <div className={s.stageTrack}>
            <span style={{ width: `${position == null ? 0 : clamp(position, 0, 100)}%` }} />
          </div>
          <div className={s.stageEnds}>
            <span>最低 {validPrice(detail.low60) ? fmtPrice(detail, detail.low60) : '--'}</span>
            <span>最高 {validPrice(detail.high60) ? fmtPrice(detail, detail.high60) : '--'}</span>
          </div>
          {outOfRange ? <small className={s.rangeWarning}>现价超出 60 日区间</small> : null}
        </div>
        <div className={s.stageDistances}>
          <div><span>距60日高点</span><b className={toneFor(highDistance)}>{highDistance == null ? '--' : formatPercent(highDistance)}</b></div>
          <div><span>较60日低点</span><b className={toneFor(lowDistance)}>{lowDistance == null ? '--' : formatPercent(lowDistance)}</b></div>
        </div>
      </div>
    </section>
  )
}

// ── Daily MA chips (daily-line MAs; distinct from the K-line view's 5-min) ─

const MA_PERIODS = [5, 10, 20, 30, 60] as const
const MA_COLORS: Record<number, string> = {
  5: '#d1a03c',
  10: '#7092d8',
  20: '#b27acc',
  30: '#84939f',
  60: '#399d9e',
}

function MaCard({ detail }: { detail: StockDetailData }): JSX.Element {
  return (
    <section className={s.dailyCard}>
      <h2 className={s.dailyTitle}>均线（日线）</h2>
      <div className={s.maRow}>
        {MA_PERIODS.map((period) => {
          const value = detail.dailyMA?.[`ma${period}`]
          return (
            <span key={period}>
              <i style={{ background: MA_COLORS[period] }} />
              MA{period}{' '}
              <b>{value != null && Number.isFinite(value) && value > 0 ? fmtPrice(detail, value) : '--'}</b>
            </span>
          )
        })}
      </div>
    </section>
  )
}

export function DailyPanel({ detail }: { detail: StockDetailData }): JSX.Element {
  const cells = [
    { label: '今开', value: detail.open },
    { label: '昨收', value: detail.yestclose },
    { label: '最高', value: detail.high, tone: s.toneUp },
    { label: '最低', value: detail.low, tone: s.toneDown },
    { label: '涨停', value: detail.limitUp, tone: s.toneUp },
    { label: '跌停', value: detail.limitDown, tone: s.toneDown },
  ]
  return (
    <div className={s.dailyPanel}>
      <section className={s.dailyCard}>
        <h2 className={s.dailyTitle}>今日关键价格</h2>
        <div className={s.metricGrid}>
          {cells.map((cell) => (
            <PriceMetric
              key={cell.label}
              label={cell.label}
              value={validPrice(cell.value) ? fmtPrice(detail, cell.value) : '--'}
              tone={cell.tone}
            />
          ))}
        </div>
      </section>
      <MaCard detail={detail} />
      <div className={s.dailySplit}>
        <RangeCard detail={detail} />
        <TradeCard detail={detail} />
      </div>
      <StageCard detail={detail} />
      <p className={s.dailyNote}>区间位置仅描述历史价格范围，不代表估值、预测或买卖建议。</p>
    </div>
  )
}
