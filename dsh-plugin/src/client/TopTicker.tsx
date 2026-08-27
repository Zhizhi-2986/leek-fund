/**
 * Top ticker: fixed indices + status-bar stocks tiled in one scrolling row,
 * refreshed together with the snapshot (every 2s).
 */
import type { Quote } from './types.js'
import { displayPrice, formatPercent } from '../quote.js'
import s from './styles.module.css'

function priceClass(percent: number): string {
  if (percent > 0) return s.up
  if (percent < 0) return s.down
  return s.flat
}

export function TopTicker({ quotes }: { quotes: Quote[] }): JSX.Element {
  if (quotes.length === 0) return <div className={s.ticker} />
  return (
    <div className={s.ticker}>
      {quotes.map((quote) => (
        <div key={quote.code} className={s.tickerItem}>
          <span className={s.tickerName}>{quote.name}</span>
          <span className={`${s.tickerValue} ${priceClass(quote.percent)}`}>
            {quote.percent > 0 ? '▲' : quote.percent < 0 ? '▼' : ''} {displayPrice(quote.code, quote.name, quote.price)} {formatPercent(quote.percent)}
          </span>
        </div>
      ))}
    </div>
  )
}
