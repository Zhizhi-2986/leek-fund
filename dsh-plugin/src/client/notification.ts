import { claimAlertEvents, type AlertEvent } from './api.js'

export type AlertPermission = NotificationPermission | 'unsupported'
export interface NotificationStatus {
  permission: AlertPermission
  message?: string
}

interface NotificationDependencies {
  permission(): AlertPermission
  requestPermission(): Promise<AlertPermission>
  claim(): Promise<AlertEvent[]>
  notify(event: AlertEvent): void
  now?(): number
  setInterval?(callback: () => void, delay: number): ReturnType<typeof setInterval>
  clearInterval?(handle: ReturnType<typeof setInterval>): void
}

const POLL_MS = 10_000
const DELIVERY_WINDOW_MS = 5 * 60_000
const FUTURE_CLOCK_SKEW_MS = 60_000

function permissionMessage(permission: AlertPermission): string | undefined {
  if (permission === 'denied') return '桌面通知已被拒绝；触发记录仍可在今日关注查看，请到系统设置中开启。'
  if (permission === 'unsupported') return '当前环境不支持桌面通知；触发记录仍可在今日关注查看。'
  if (permission === 'default') return '未启用桌面通知；点击按钮授权，触发记录仍可在今日关注查看。'
  return undefined
}

/** The host atomically claims an event only after this window has permission. */
export function createNotificationMonitor(deps: NotificationDependencies) {
  let status: NotificationStatus = { permission: deps.permission() }
  const listeners = new Set<(status: NotificationStatus) => void>()
  let timer: ReturnType<typeof setInterval> | undefined
  let polling = false
  let active = false
  const publish = (next: NotificationStatus): void => {
    status = next
    for (const listener of listeners) listener(status)
  }
  const poll = async (): Promise<void> => {
    const permission = deps.permission()
    if (permission !== 'granted') {
      publish({ permission, message: permissionMessage(permission) })
      return
    }
    if (polling) return
    polling = true
    try {
      // The host returns at most ten per default claim. Old events are still
      // claimed, but only recent ones produce noisy OS notifications.
      const events = await deps.claim()
      const failedCodes: string[] = []
      const now = (deps.now ?? Date.now)()
      for (const event of events) {
        const triggeredAt = Date.parse(event.triggeredAt)
        if (!Number.isFinite(triggeredAt) || now - triggeredAt > DELIVERY_WINDOW_MS || triggeredAt - now > FUTURE_CLOCK_SKEW_MS) continue
        try {
          deps.notify(event)
        } catch {
          // Claimed events cannot be replayed, but remain in the persisted
          // event history. Continue attempting the rest of this batch.
          failedCodes.push(event.code)
        }
      }
      const failure = failedCodes.length
        ? `桌面通知发送失败（${failedCodes.join('、')}）；请到今日关注查看已触发记录。`
        : undefined
      publish({ permission, message: failure ?? (status.message?.startsWith('桌面通知发送失败') ? status.message : undefined) })
    } catch {
      publish({ permission, message: '提醒领取失败，请检查连接；未领取的事件会保留待重试。' })
    } finally {
      polling = false
    }
  }
  return {
    getStatus: (): NotificationStatus => status,
    subscribe(listener: (status: NotificationStatus) => void): () => void {
      listeners.add(listener)
      listener(status)
      return () => { listeners.delete(listener) }
    },
    async enable(): Promise<void> {
      if (deps.permission() === 'default') {
        try {
          const permission = await deps.requestPermission()
          publish({ permission, message: permissionMessage(permission) })
        } catch {
          publish({ permission: deps.permission(), message: '无法申请通知权限；请检查浏览器设置。' })
        }
      } else {
        const permission = deps.permission()
        publish({ permission, message: permissionMessage(permission) })
      }
      if (deps.permission() === 'granted') await poll()
    },
    poll,
    start(): () => void {
      if (!active) {
        active = true
        void poll()
        timer = (deps.setInterval ?? setInterval)(() => { void poll() }, POLL_MS)
      }
      return () => {
        if (!active) return
        active = false
        if (timer !== undefined) (deps.clearInterval ?? clearInterval)(timer)
        timer = undefined
      }
    },
  }
}

export const notificationMonitor = createNotificationMonitor({
  permission: () => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  requestPermission: () => Notification.requestPermission(),
  claim: async () => (await claimAlertEvents()).events,
  notify: (event) => {
    const basis = event.kind && event.direction && typeof event.threshold === 'number'
      ? `${event.kind === 'price' ? '目标价' : '涨跌幅'}${event.direction === 'above' ? '≥' : '≤'}${event.threshold}${event.kind === 'price' ? '元' : '%'}`
      : '已触发提醒'
    new Notification(`行情提醒 · ${event.code}`, {
      body: `${basis} · 现价 ${event.price} · 涨跌幅 ${event.percent}% · 行情 ${event.quoteTime}`,
      tag: `leek-fund:${event.id}`,
    })
  },
})
