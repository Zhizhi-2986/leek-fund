/**
 * Model-facing tool definitions for dsh-leek-fund.
 *
 * Every tool follows the DSH `defineTool` contract: typed parameters,
 * one canonical JSON return value, and a pure `output.render` that converts
 * the canonical value into model-facing text.
 */
import { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import { fetchQuotes, formatQuoteLine } from './quote.js'
import { searchAStocks } from './search.js'
import {
  addStock,
  categoryOf,
  createGroup,
  createStateStore,
  deleteGroup,
  groupOf,
  moveStockToGroup,
  normalizeCode,
  removeStock,
  renameGroup,
  setMark,
  type MutationResult,
  type StateStore,
} from './state.js'
import type { Quote, State } from './types.js'

export interface ToolDeps {
  store: StateStore
  timeoutMs: number
}

/** Run a mutating operation through the store and surface its result. */
async function runMutation(
  store: StateStore,
  mutator: (state: State) => MutationResult
): Promise<MutationResult> {
  let result!: MutationResult
  await store.mutate((state) => {
    result = mutator(state)
  })
  return result
}

/** Merge an AbortController signal with the execution signal. */
function mergeSignal(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal))
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]
  return AbortSignal.any(active)
}

const quoteObjectSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    code: { type: 'string' as const, required: true as const, description: '股票代码' },
    name: { type: 'string' as const, required: true as const, description: '股票名称' },
    price: { type: 'number' as const, required: true as const, description: '最新价' },
    yestclose: { type: 'number' as const, required: true as const, description: '昨收价' },
    open: { type: 'number' as const, required: true as const, description: '今开' },
    high: { type: 'number' as const, required: true as const, description: '最高' },
    low: { type: 'number' as const, required: true as const, description: '最低' },
    updown: { type: 'number' as const, required: true as const, description: '涨跌额' },
    percent: { type: 'number' as const, required: true as const, description: '涨跌幅(%)' },
    time: { type: 'string' as const, required: true as const, description: '行情时间' },
    available: { type: 'boolean' as const, required: true as const, description: '行情是否可用' },
  },
}

const groupObjectSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    id: { type: 'string' as const, required: true as const, description: '分组 id' },
    name: { type: 'string' as const, required: true as const, description: '分组名称' },
    category: { type: 'string' as const, required: true as const, description: '市场: A/HK/US' },
    parentId: { type: 'string' as const, description: '父分组 id（二级分组才有）' },
    stockCodes: {
      type: 'array' as const,
      required: true as const,
      items: { type: 'string' as const },
      description: '组内股票代码',
    },
  },
}

function renderQuotes(value: { quotes: Quote[]; failed: string[] }): string {
  const lines = value.quotes.map((quote) => formatQuoteLine(quote))
  const failed = value.failed.length > 0 ? `\n无数据代码: ${value.failed.join(', ')}` : ''
  return `【实时行情】\n${lines.join('\n')}${failed}`
}

export function defineTools(deps: ToolDeps) {
  const { store, timeoutMs } = deps

  return [
    defineTool({
      name: 'stock_quote',
      description:
        '查询股票实时行情。默认查询全部自选股票；可传入指定代码（如 sh600000 浦发银行、sz000001 平安银行、hk00700 腾讯、usr_aapl 苹果、sh000001 上证指数）。返回名称、现价、涨跌幅、今开、最高、最低、昨收等。',
      parameters: {
        codes: {
          type: 'array',
          items: { type: 'string' },
          description: '股票代码列表，省略时查询全部自选股票',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            quotes: {
              type: 'array',
              required: true,
              items: quoteObjectSchema,
              description: '成功获取的行情',
            },
            failed: {
              type: 'array',
              required: true,
              items: { type: 'string' },
              description: '无法获取行情的代码',
            },
          },
        },
        render: (args, value) => [{ type: 'text', text: renderQuotes(value) }],
      },
      async execute(args, exec) {
        const state = await store.load()
        const codes = args.codes && args.codes.length > 0 ? args.codes : state.stocks
        const quotes = await fetchQuotes(codes, timeoutMs, mergeSignal(exec.signal))
        const failed = codes.filter((code) => !quotes.has(code))
        return { quotes: [...quotes.values()], failed }
      },
    }),

    defineTool({
      name: 'stock_search',
      description:
        '按股票代码或中文名称搜索 A 股（沪深京），返回代码与名称候选列表。例如搜索"浦发"返回浦发银行 sh600000。',
      parameters: {
        keyword: { type: 'string', required: true, description: '搜索关键词：股票代码或中文名称' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            results: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  code: { type: 'string', required: true, description: '股票代码' },
                  name: { type: 'string', required: true, description: '股票名称' },
                },
              },
              description: 'A 股候选列表',
            },
          },
        },
        render: (_args, value) => {
          if (value.results.length === 0) return [{ type: 'text', text: '未找到匹配的 A 股' }]
          const lines = value.results.map((item) => `${item.name}(${item.code})`)
          return [{ type: 'text', text: `【搜索结果】\n${lines.join('\n')}` }]
        },
      },
      async execute(args, exec) {
        const results = await searchAStocks(args.keyword, timeoutMs, mergeSignal(exec.signal))
        return { results }
      },
    }),

    defineTool({
      name: 'stock_watchlist',
      description:
        '查看当前自选股票全貌：自选股列表、自定义分组（一级/二级）、持仓标记与关注标记。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            stocks: { type: 'array', required: true, items: { type: 'string' }, description: '全部自选股票代码' },
            groups: { type: 'array', required: true, items: groupObjectSchema, description: '自定义分组' },
            holdingCodes: { type: 'array', required: true, items: { type: 'string' }, description: '持仓标记股票' },
            watchCodes: { type: 'array', required: true, items: { type: 'string' }, description: '关注标记股票' },
          },
        },
        render: (_args, value) => {
          const lines: string[] = [`自选股(${value.stocks.length}): ${value.stocks.join(' ')}`]
          if (value.groups.length > 0) {
            const topLevel = value.groups.filter((group) => !group.parentId)
            for (const group of topLevel) {
              const children = value.groups.filter((item) => item.parentId === group.id)
              lines.push(`- ${group.name}(${group.category}): ${group.stockCodes.join(' ') || '空'}`)
              for (const child of children) {
                lines.push(`  - ${child.name}: ${child.stockCodes.join(' ') || '空'}`)
              }
            }
          } else {
            lines.push('自定义分组: 无')
          }
          lines.push(`持仓(${value.holdingCodes.length}): ${value.holdingCodes.join(' ') || '无'}`)
          lines.push(`关注(${value.watchCodes.length}): ${value.watchCodes.join(' ') || '无'}`)
          return [{ type: 'text', text: `【自选股列表】\n${lines.join('\n')}` }]
        },
      },
      async execute() {
        const state = await store.load()
        return {
          stocks: state.stocks,
          groups: state.groups,
          holdingCodes: state.holdingCodes,
          watchCodes: state.watchCodes,
        }
      },
    }),

    defineTool({
      name: 'stock_add',
      description: '添加股票到自选列表。代码格式：A 股 sh/sz/bj + 6 位数字，港股 hk + 5 位数字，美股 usr_ 或 gb_ 开头。',
      parameters: {
        code: { type: 'string', required: true, description: '股票代码，如 sh600000、hk00700、usr_aapl' },
        groupId: { type: 'string', description: '可选：添加到指定分组的 id（省略则放入未分组）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string', required: true, description: '规范化后的股票代码' },
            ok: { type: 'boolean', required: true, description: '是否成功' },
            error: { type: 'string', description: '失败原因' },
          },
        },
        render: (_args, value) => [
          { type: 'text', text: value.ok ? `已添加自选: ${value.code}` : `添加失败: ${value.error}` },
        ],
      },
      async execute(args) {
        const result = await runMutation(store, (state) => addStock(state, args.code, args.groupId))
        const code = normalizeCode(args.code)
        return { code: code || args.code, ok: result.ok, error: result.error }
      },
    }),

    defineTool({
      name: 'stock_remove',
      description: '从自选列表删除股票，同时移除其分组归属与持仓/关注标记。',
      parameters: {
        code: { type: 'string', required: true, description: '股票代码，如 sh600000' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string', required: true, description: '规范化后的股票代码' },
            ok: { type: 'boolean', required: true, description: '是否成功' },
            error: { type: 'string', description: '失败原因' },
          },
        },
        render: (_args, value) => [
          { type: 'text', text: value.ok ? `已删除自选: ${value.code}` : `删除失败: ${value.error}` },
        ],
      },
      async execute(args) {
        const result = await runMutation(store, (state) => removeStock(state, args.code))
        const code = normalizeCode(args.code)
        return { code: code || args.code, ok: result.ok, error: result.error }
      },
    }),

    defineTool({
      name: 'stock_group_create',
      description:
        '创建自定义分组。一级分组不传 parentId；二级分组传 parentId（二级分组不能再有子分组）。分组内股票与分组必须同市场。',
      parameters: {
        name: { type: 'string', required: true, description: '分组名称' },
        category: {
          type: 'string',
          enum: ['A', 'HK', 'US'],
          description: '分组市场，默认 A',
        },
        parentId: { type: 'string', description: '父分组 id（创建二级分组时传入）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '新分组 id' },
            name: { type: 'string', required: true, description: '分组名称' },
            category: { type: 'string', required: true, description: '市场' },
            parentId: { type: 'string', description: '父分组 id' },
            ok: { type: 'boolean', required: true, description: '是否成功' },
            error: { type: 'string', description: '失败原因' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: value.ok
              ? `已创建分组: ${value.name}(${value.id})${value.parentId ? `, 父分组 ${value.parentId}` : ''}`
              : `创建分组失败: ${value.error}`,
          },
        ],
      },
      async execute(args) {
        const category = args.category ?? 'A'
        const result = await runMutation(store, (state) => createGroup(state, args.name, category, args.parentId))
        if (!result.ok) {
          return { id: '', name: args.name, category, ok: false, error: result.error }
        }
        const created = result.state.groups[result.state.groups.length - 1]
        return { id: created.id, name: created.name, category: created.category, parentId: created.parentId, ok: true }
      },
    }),

    defineTool({
      name: 'stock_group_rename',
      description: '重命名自定义分组。',
      parameters: {
        id: { type: 'string', required: true, description: '分组 id' },
        name: { type: 'string', required: true, description: '新分组名称' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '分组 id' },
            name: { type: 'string', required: true, description: '新名称' },
            ok: { type: 'boolean', required: true, description: '是否成功' },
            error: { type: 'string', description: '失败原因' },
          },
        },
        render: (_args, value) => [
          { type: 'text', text: value.ok ? `已重命名分组: ${value.name}` : `重命名失败: ${value.error}` },
        ],
      },
      async execute(args) {
        const result = await runMutation(store, (state) => renameGroup(state, args.id, args.name))
        return { id: args.id, name: args.name, ok: result.ok, error: result.error }
      },
    }),

    defineTool({
      name: 'stock_group_delete',
      description: '删除自定义分组；二级子分组一并删除，组内股票保留在自选列表（回到未分组）。',
      parameters: {
        id: { type: 'string', required: true, description: '分组 id' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '分组 id' },
            ok: { type: 'boolean', required: true, description: '是否成功' },
            error: { type: 'string', description: '失败原因' },
          },
        },
        render: (_args, value) => [
          { type: 'text', text: value.ok ? `已删除分组: ${value.id}` : `删除失败: ${value.error}` },
        ],
      },
      async execute(args) {
        const result = await runMutation(store, (state) => deleteGroup(state, args.id))
        return { id: args.id, ok: result.ok, error: result.error }
      },
    }),

    defineTool({
      name: 'stock_group_move',
      description:
        '把股票移入指定分组或移回未分组（不传 groupId 时）。股票与目标分组必须同市场；股票会从所有原分组中移除。',
      parameters: {
        code: { type: 'string', required: true, description: '股票代码，如 sh600000' },
        groupId: { type: 'string', description: '目标分组 id；省略表示移回未分组' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string', required: true, description: '股票代码' },
            groupId: { type: 'string', description: '目标分组 id' },
            ok: { type: 'boolean', required: true, description: '是否成功' },
            error: { type: 'string', description: '失败原因' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: value.ok
              ? `已移动 ${value.code} 到 ${value.groupId ?? '未分组'}`
              : `移动失败: ${value.error}`,
          },
        ],
      },
      async execute(args) {
        const result = await runMutation(store, (state) => moveStockToGroup(state, args.code, args.groupId))
        return { code: args.code, groupId: args.groupId, ok: result.ok, error: result.error }
      },
    }),

    defineTool({
      name: 'stock_mark',
      description: '切换股票持仓或关注标记。持仓和关注是叠加标记，不改变股票所在分组。',
      parameters: {
        code: { type: 'string', required: true, description: '股票代码，如 sh600000' },
        mark: { type: 'string', enum: ['holding', 'watch'], required: true, description: '标记类型: holding=持仓, watch=关注' },
        value: { type: 'boolean', required: true, description: 'true 打上标记，false 取消标记' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string', required: true, description: '股票代码' },
            mark: { type: 'string', required: true, description: '标记类型' },
            value: { type: 'boolean', required: true, description: '标记状态' },
            ok: { type: 'boolean', required: true, description: '是否成功' },
            error: { type: 'string', description: '失败原因' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: value.ok
              ? `已${value.value ? '打上' : '取消'}${value.mark === 'holding' ? '持仓' : '关注'}标记: ${value.code}`
              : `操作失败: ${value.error}`,
          },
        ],
      },
      async execute(args) {
        const result = await runMutation(store, (state) => setMark(state, args.code, args.mark, args.value))
        return { code: args.code, mark: args.mark, value: args.value, ok: result.ok, error: result.error }
      },
    }),
  ]
}

/** Register every tool on the context (effect-based; unloaded automatically). */
export function registerTools(ctx: { tools: { register(tool: ReturnType<typeof defineTool>): unknown } }, deps: ToolDeps): void {
  for (const tool of defineTools(deps)) {
    ctx.tools.register(tool)
  }
}
