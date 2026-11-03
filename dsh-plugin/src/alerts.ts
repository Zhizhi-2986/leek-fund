/** Host-owned A-share alerts. Quote timestamps are exchange-local (Asia/Shanghai). */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fetchQuotes } from './quote.js'
import { normalizeCode, type StateStore } from './state.js'
import type { Quote } from './types.js'

export interface AlertRule {
  id: string
  code: string
  kind: 'price' | 'percent'
  direction: 'above' | 'below'
  threshold: number
  enabled: boolean
}
export type AlertRuleInput = Pick<AlertRule, 'code' | 'kind' | 'direction' | 'threshold'>
export interface AlertEvent {
  id: string
  ruleId: string
  code: string
  kind: AlertRule['kind']
  direction: AlertRule['direction']
  threshold: number
  price: number
  percent: number
  quoteTime: string
  triggeredAt: string
}
interface PersistedEvent extends AlertEvent { tradingDate: string; claimedAt?: string }
interface AlertData { rules: AlertRule[]; events: PersistedEvent[] }
export interface AlertStore {
  readonly path: string
  listRules(): Promise<AlertRule[]>
  createRule(input: AlertRuleInput): Promise<AlertRule>
  deleteRule(id: string): Promise<boolean>
  deleteRulesForCode(code: string): Promise<number>
  listEvents(): Promise<AlertEvent[]>
  claimEvents(limit: number): Promise<AlertEvent[]>
  record(quotes: Map<string, Quote>, now: Date): Promise<AlertEvent[]>
}

const MAX_RULES = 100
const MAX_CLAIM = 50
const MAX_QUOTE_AGE_MS = 5 * 60_000
const CHINA_OFFSET_MS = 8 * 60 * 60_000
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
const queues = new Map<string, Promise<void>>()

function chinaClock(now: Date) {
  const instant = new Date(now.getTime() + CHINA_OFFSET_MS)
  return {
    date: instant.toISOString().slice(0, 10),
    weekday: instant.getUTCDay(),
    seconds: instant.getUTCHours() * 3600 + instant.getUTCMinutes() * 60 + instant.getUTCSeconds(),
  }
}

function inSession(seconds: number): boolean {
  return (seconds >= 9 * 3600 + 30 * 60 && seconds <= 11 * 3600 + 30 * 60) ||
    (seconds >= 13 * 3600 && seconds <= 15 * 3600)
}

function tradingTime(now: Date): boolean {
  if (!Number.isFinite(now.getTime())) return false
  const clock = chinaClock(now)
  return clock.weekday >= 1 && clock.weekday <= 5 && inSession(clock.seconds)
}

/** Reject missing/malformed/future/stale quotes and any timestamp outside trading sessions. */
export function eligibleQuote(quote: Quote, now = new Date()): boolean {
  if (!tradingTime(now) || !quote.available || !Number.isFinite(quote.price) || quote.price <= 0 ||
    !Number.isFinite(quote.percent)) return false
  const match = TIMESTAMP.exec(quote.time)
  if (!match) return false
  const [, year, month, day, hour, minute, second] = match.map(Number)
  const localTime = Date.UTC(year, month - 1, day, hour, minute, second)
  const check = new Date(localTime)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day ||
    check.getUTCHours() !== hour || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second) return false
  const stamp = new Date(localTime - CHINA_OFFSET_MS)
  const clock = chinaClock(stamp)
  const age = now.getTime() - stamp.getTime()
  return clock.date === chinaClock(now).date && clock.weekday >= 1 && clock.weekday <= 5 &&
    inSession(clock.seconds) && age >= 0 && age <= MAX_QUOTE_AGE_MS
}

function validateRule(input: AlertRuleInput): AlertRuleInput {
  if (!input || typeof input !== 'object' || typeof input.code !== 'string' ||
    !/^(sh|sz|bj)\d{6}$/i.test(input.code) ||
    (input.kind !== 'price' && input.kind !== 'percent') ||
    (input.direction !== 'above' && input.direction !== 'below') ||
    typeof input.threshold !== 'number' || !Number.isFinite(input.threshold) ||
    (input.kind === 'price' && input.threshold <= 0) ||
    (input.kind === 'percent' && (input.threshold < -100 || input.threshold > 100))) {
    throw new RangeError('invalid alert rule: code, kind, direction or threshold')
  }
  return { code: normalizeCode(input.code), kind: input.kind, direction: input.direction, threshold: input.threshold }
}

function matches(rule: AlertRule, quote: Quote): boolean {
  const actual = rule.kind === 'price' ? quote.price : quote.percent
  return rule.direction === 'above' ? actual >= rule.threshold : actual <= rule.threshold
}

function publicEvent(event: PersistedEvent): AlertEvent {
  const { id, ruleId, code, kind, direction, threshold, price, percent, quoteTime, triggeredAt } = event
  return { id, ruleId, code, kind, direction, threshold, price, percent, quoteTime, triggeredAt }
}

async function readData(path: string): Promise<AlertData> {
  let text: string
  try { text = await readFile(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { rules: [], events: [] }
    throw error
  }
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || !Array.isArray((value as AlertData).rules) ||
    !Array.isArray((value as AlertData).events)) throw new Error('invalid alerts state')
  return value as AlertData
}

async function writeData(path: string, value: AlertData): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/** Serialize all instances for the same path within the single DSH host process. */
async function transaction<T>(path: string, update: (data: AlertData) => { data: AlertData; result: T; changed: boolean }): Promise<T> {
  const previous = queues.get(path) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  queues.set(path, current)
  await previous
  try {
    const outcome = update(await readData(path))
    if (outcome.changed) await writeData(path, outcome.data)
    return outcome.result
  } finally {
    release()
    if (queues.get(path) === current) queues.delete(path)
  }
}

export function createAlertStore(path: string): AlertStore {
  return {
    path,
    async listRules() { return (await readData(path)).rules },
    async createRule(input) {
      const valid = validateRule(input)
      return transaction(path, (data) => {
        if (data.rules.length >= MAX_RULES) throw new RangeError('alert rule limit reached')
        const rule: AlertRule = { ...valid, id: randomUUID(), enabled: true }
        return { data: { ...data, rules: [...data.rules, rule] }, result: rule, changed: true }
      })
    },
    async deleteRule(id) {
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new RangeError('invalid alert rule id')
      return transaction(path, (data) => {
        const rules = data.rules.filter((rule) => rule.id !== id)
        const changed = rules.length !== data.rules.length
        return { data: { ...data, rules }, result: changed, changed }
      })
    },
    async deleteRulesForCode(code) {
      const normalized = normalizeCode(code)
      if (!normalized) throw new RangeError('invalid stock code')
      return transaction(path, (data) => {
        const rules = data.rules.filter((rule) => rule.code !== normalized)
        const removed = data.rules.length - rules.length
        return { data: { ...data, rules }, result: removed, changed: removed > 0 }
      })
    },
    async listEvents() {
      return (await readData(path)).events.slice(-100).reverse().map(publicEvent)
    },
    async claimEvents(limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CLAIM) throw new RangeError('invalid claim limit')
      return transaction(path, (data) => {
        const pending = data.events.filter((event) => !event.claimedAt).slice(0, limit)
        const ids = new Set(pending.map((event) => event.id))
        return {
          data: { ...data, events: data.events.map((event) => ids.has(event.id) ? { ...event, claimedAt: new Date().toISOString() } : event) },
          result: pending.map(publicEvent), changed: pending.length > 0,
        }
      })
    },
    async record(quotes, now) {
      if (!tradingTime(now)) return []
      return transaction(path, (data) => {
        const date = chinaClock(now).date
        const previouslyTriggered = new Set(data.events.filter((event) => event.tradingDate === date).map((event) => event.ruleId))
        const events: PersistedEvent[] = []
        for (const rule of data.rules) {
          const quote = quotes.get(rule.code)
          if (!rule.enabled || previouslyTriggered.has(rule.id) || !quote || quote.code !== rule.code ||
            !eligibleQuote(quote, now) || !matches(rule, quote)) continue
          events.push({ id: randomUUID(), ruleId: rule.id, code: rule.code, kind: rule.kind,
            direction: rule.direction, threshold: rule.threshold, price: quote.price,
            percent: quote.percent, quoteTime: quote.time, triggeredAt: now.toISOString(), tradingDate: date })
          previouslyTriggered.add(rule.id)
        }
        return { data: { ...data, events: [...data.events, ...events] }, result: events.map(publicEvent), changed: events.length > 0 }
      })
    },
  }
}

export function alertPath(stateStore: StateStore): string {
  return join(dirname(stateStore.path), 'alerts.json')
}

export async function checkAlerts(store: AlertStore, quotes: Map<string, Quote>, now = new Date()): Promise<AlertEvent[]> {
  return store.record(quotes, now)
}

/** One host timer, independent of the sidebar tab. Returned cleanup stops further polls. */
export function startAlertMonitor(store: AlertStore, timeoutMs: number, onError: (error: unknown) => void,
  intervalMs = 30_000, fetcher: typeof fetchQuotes = fetchQuotes, clock: () => Date = () => new Date()): () => void {
  let stopped = false
  let busy = false
  async function tick() {
    if (stopped || busy || !tradingTime(clock())) return
    busy = true
    try {
      const rules = await store.listRules()
      if (stopped) return
      const codes = [...new Set(rules.filter((rule) => rule.enabled).map((rule) => rule.code))]
      if (codes.length) {
        const quotes = await fetcher(codes, timeoutMs)
        if (!stopped) await checkAlerts(store, quotes, clock())
      }
    } catch (error) { onError(error) } finally { busy = false }
  }
  const timer = setInterval(() => { void tick() }, intervalMs)
  void tick()
  return () => { stopped = true; clearInterval(timer) }
}
