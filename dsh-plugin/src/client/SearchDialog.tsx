/**
 * Search-and-add dialog: A-share candidates in a fixed-height scroll area.
 */
import { useEffect, useRef, useState } from 'react'
import type { StockCandidate } from './types.js'
import { mutate, searchStocks } from './api.js'
import s from './styles.module.css'

export function SearchDialog({
  onClose,
  onAdded,
  onError,
}: {
  onClose: () => void
  onAdded: () => void
  onError: (message: string) => void
}): JSX.Element {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<StockCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const query = keyword.trim()
    if (!query) {
      setResults([])
      return
    }
    timer.current = setTimeout(() => {
      setSearching(true)
      searchStocks(query)
        .then((res) => setResults(res.results))
        .catch((error: unknown) => onError(String(error)))
        .finally(() => setSearching(false))
    }, 300)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [keyword, onError])

  async function addCandidate(candidate: StockCandidate): Promise<void> {
    try {
      await mutate('add', { code: candidate.code })
      onAdded()
      onClose()
    } catch (error) {
      onError(String(error))
    }
  }

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.dialog} onClick={(event) => event.stopPropagation()}>
        <div className={s.dialogTitle}>添加股票</div>
        <div className={s.dialogBody}>
          <input
            className={s.input}
            autoFocus
            placeholder="输入股票代码或中文名称，如 sh600000 或 浦发"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <div className={s.searchResults}>
            {searching && <div className={s.hint}>搜索中…</div>}
            {!searching && results.length === 0 && keyword.trim() !== '' && (
              <div className={s.hint}>未找到匹配的 A 股</div>
            )}
            {results.map((candidate) => (
              <div
                key={candidate.code}
                className={s.searchItem}
                onClick={() => void addCandidate(candidate)}
              >
                <span>{candidate.name}</span>
                <span className={s.searchItemCode}>{candidate.code}</span>
              </div>
            ))}
          </div>
          <div className={s.hint}>点击结果添加到自选列表（未分组）</div>
        </div>
        <div className={s.dialogFooter}>
          <button className={s.button} onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
