import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createAlertRule, deleteAlertRule, fetchAlertEvents, fetchAlertRules, type AlertEvent, type AlertRule, type NewAlertRule } from './api.js'
import { notificationMonitor, type NotificationStatus } from './notification.js'
import s from './styles.module.css'

const EVENTS_REFRESH_MS = 15_000

function ruleLabel(rule: Pick<AlertRule, 'kind' | 'direction' | 'threshold'>): string {
  return `${rule.kind === 'price' ? '目标价' : '涨跌幅'}${rule.direction === 'above' ? '≥' : '≤'}${rule.threshold}${rule.kind === 'percent' ? '%' : '元'}`
}

function eventRuleLabel(event: AlertEvent, rules: AlertRule[]): string {
  if (event.kind && event.direction && typeof event.threshold === 'number') {
    return ruleLabel({ kind: event.kind, direction: event.direction, threshold: event.threshold })
  }
  const rule = rules.find((item) => item.id === event.ruleId)
  return rule ? ruleLabel(rule) : '历史规则'
}

export function AlertPanel({ codes, selectedCode, onClose }: {
  codes: string[]
  selectedCode?: string
  onClose(): void
}): JSX.Element {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [rules, setRules] = useState<AlertRule[]>([])
  const [today, setToday] = useState<AlertEvent[]>([])
  const [history, setHistory] = useState<AlertEvent[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [status, setStatus] = useState<NotificationStatus>(() => notificationMonitor.getStatus())
  const [code, setCode] = useState(selectedCode ?? codes[0] ?? '')
  const [kind, setKind] = useState<NewAlertRule['kind']>('price')
  const [direction, setDirection] = useState<NewAlertRule['direction']>('above')
  const [threshold, setThreshold] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [nextRules, nextEvents] = await Promise.all([fetchAlertRules(), fetchAlertEvents()])
      setRules(nextRules.rules)
      setToday(nextEvents.today.slice(0, 3))
      setHistory(nextEvents.events.slice(0, 10))
      setError(undefined)
    } catch (cause) {
      setError(`提醒列表更新失败：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, EVENTS_REFRESH_MS)
    const off = notificationMonitor.subscribe(setStatus)
    return () => { clearInterval(timer); off() }
  }, [refresh])

  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled])')
      if (!controls?.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function addRule(): Promise<void> {
    const value = Number(threshold)
    if (!codes.includes(code) || !threshold.trim() || !Number.isFinite(value) || (kind === 'price' && value <= 0) || (kind === 'percent' && (value < -100 || value > 100))) {
      setError('请选择自选股并输入有效阈值：目标价须大于 0，涨跌幅须在 -100% 到 100% 之间。')
      return
    }
    setBusy(true)
    try {
      await createAlertRule({ code, kind, direction, threshold: value })
      setThreshold('')
      await refresh()
    } catch (cause) {
      setError(`建立提醒失败：${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  async function removeRule(id: string): Promise<void> {
    setBusy(true)
    try {
      await deleteAlertRule(id)
      await refresh()
    } catch (cause) {
      setError(`删除提醒失败：${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className={s.overlay} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} className={`${s.dialog} ${s.alertDialog}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={s.alertDialogHeader}>
          <strong id={titleId}>行情提醒</strong>
          <button ref={closeRef} type="button" className={s.alertClose} aria-label="关闭提醒弹窗" onClick={onClose}>×</button>
        </div>
        <div className={s.dialogBody}>
          <section className={s.alertPanel} aria-label="今日关注">
            <div className={s.alertHeading}>
              <strong>今日关注</strong>
              <span className={s.alertMuted}>最多 3 条</span>
            </div>
            {today.length === 0 ? <div className={s.alertMuted}>暂无今日触发提醒</div> : today.map((event) => (
              <div key={event.id} className={s.alertEvent}>
                <b>{event.code}</b> · {event.price} ({event.percent > 0 ? '+' : ''}{event.percent}%)
                {' · '}{eventRuleLabel(event, rules)}
                <span title={`行情时间 ${event.quoteTime} · 触发时间 ${event.triggeredAt}`}>
                  行情 {event.quoteTime} · 触发 {new Date(event.triggeredAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}
                </span>
              </div>
            ))}
            {history.length > 0 && (
              <button type="button" className={s.alertLink} onClick={() => setShowHistory((value) => !value)} aria-expanded={showHistory}>
                {showHistory ? '收起历史记录' : '查看历史记录'}
              </button>
            )}
            {showHistory && history.map((event) => (
              <div key={`history-${event.id}`} className={s.alertEvent}>
                <b>{event.code}</b> · {event.price} ({event.percent > 0 ? '+' : ''}{event.percent}%) · {eventRuleLabel(event, rules)}
                <span>行情 {event.quoteTime} · 触发 {new Date(event.triggeredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</span>
              </div>
            ))}
            {status.message && <div className={s.alertNotice} role="status">{status.message}</div>}
            {status.permission === 'default' && (
              <button type="button" className={s.alertLink} onClick={() => { void notificationMonitor.enable() }}>启用桌面通知</button>
            )}
            {error && <div className={s.alertError} role="alert">{error}</div>}
            <div className={s.alertSettings}>
              <div className={s.alertHeading}><strong>提醒规则</strong><span className={s.alertMuted}>{rules.length} 条</span></div>
              <div className={s.alertForm}>
                <select aria-label="提醒股票" value={code} onChange={(event) => setCode(event.target.value)}>
                  {!codes.includes(code) && <option value="">选择股票</option>}
                  {codes.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <select aria-label="提醒指标" value={kind} onChange={(event) => setKind(event.target.value as NewAlertRule['kind'])}>
                  <option value="price">目标价</option><option value="percent">涨跌幅</option>
                </select>
                <select aria-label="提醒方向" value={direction} onChange={(event) => setDirection(event.target.value as NewAlertRule['direction'])}>
                  <option value="above">达到或超过</option><option value="below">达到或低于</option>
                </select>
                <input aria-label="提醒阈值" type="number" step="any" value={threshold} placeholder={kind === 'price' ? '价格' : '百分比'} onChange={(event) => setThreshold(event.target.value)} />
                <button type="button" className={s.alertLink} disabled={busy} onClick={() => { void addRule() }}>建立提醒</button>
              </div>
              {rules.map((rule) => (
                <div key={rule.id} className={s.alertRule}>
                  <span>{rule.code} · {rule.kind === 'price' ? '目标价' : '涨跌幅'} {rule.direction === 'above' ? '≥' : '≤'} {rule.threshold}{rule.kind === 'percent' ? '%' : '元'}</span>
                  <button type="button" className={s.alertLink} disabled={busy} aria-label={`删除 ${rule.code} 提醒`} onClick={() => { void removeRule(rule.id) }}>删除</button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body
  )
}
