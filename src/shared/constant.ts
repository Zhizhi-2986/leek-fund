/**
 * 默认模板格式
 */
export const DEFAULT_LABEL_FORMAT = {
  statusBarLabelFormat: '「${name}」${price} ${icon}（${percent}）',
};

/**
 * 状态栏格式占位符说明
 * 支持的变量：
 * - ${name}: 股票名称
 * - ${code}: 股票代码
 * - ${price}: 当前价格
 * - ${percent}: 涨跌幅百分比（带符号，如 +2.35%）
 * - ${icon}: 涨跌图标（emoji）
 * - ${updown}: 涨跌值（绝对值，如 +5.50）
 * - ${open}: 开盘价
 * - ${high}: 最高价
 * - ${low}: 最低价
 * - ${yestclose}: 昨收价
 * - ${volume}: 成交量
 * - ${amount}: 成交额
 * - ${time}: 更新时间
 *
 * 过滤器：
 * - ${name | padRight}: 右对齐填充到10字符
 * - ${name | padRight(15)}: 右对齐填充到指定字符数
 */
export const STATUS_BAR_PLACEHOLDERS = {
  basic: ['name', 'code', 'price', 'percent', 'icon'],
  price: ['updown', 'open', 'high', 'low', 'yestclose'],
  volume_related: ['volume', 'amount', 'time'],
} as const;

/**
 * 提示语
 * TODO: 丰富模板
 */
export const TIPS_LOSE = [
  '今晚吃面🍜！',
  '关灯吃面🍜！',
  '稳住，我们能赢！',
  '在A股，稳住才会有收益！',
  '投资其实就是一次心态修炼，稳住心态长期投资都会有收益的！',
];
export const TIPS_WIN = ['喝汤吃肉！', '吃鸡腿🍗！', '好起来了！', '祝老板吃肉！'];
