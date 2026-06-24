import { ExtensionContext } from 'vscode';
import { DEFAULT_LABEL_FORMAT } from './shared/constant';
import { LeekFundConfig } from './shared/leekConfig';
import { Telemetry } from './shared/telemetry';

const deviceId = Math.random().toString(16).substr(2) + Math.random().toString(32).substr(2);

let context: ExtensionContext = undefined as unknown as ExtensionContext;

let telemetry: Telemetry | any = null;

let iconType = 'arrow';

let stocksRemind: Record<string, any> = {};
let remindSwitch = 1; // 是否打开提示
let labelFormat = DEFAULT_LABEL_FORMAT;

let aStockCount = 0;
let usStockCount = 0;
let hkStockCount = 0;
let noDataStockCount = 0;
let isHolidayChina = false; // 初始化状态，默认是false，免得API有问题，就当它不是好了，可以继续运行

let showStockErrorInfo = true; // 控制只显示一次错误弹窗（临时处理）
let immersiveBackground = true; // 图表是否沉浸式背景

let isDevelopment = false; // 是否开发环境

export function reloadFromConfig() {
  iconType = LeekFundConfig.getConfig('leek-fund.iconType') || 'arrow';
  remindSwitch = LeekFundConfig.getConfig('leek-fund.stockRemindSwitch');
  labelFormat = LeekFundConfig.getConfig('leek-fund.labelFormat');
  immersiveBackground = LeekFundConfig.getConfig('leek-fund.immersiveBackground', true);
  stocksRemind = LeekFundConfig.getConfig('leek-fund.stocksRemind') || {};
}

export default {
  context,
  telemetry,
  iconType,
  deviceId,
  aStockCount,
  usStockCount,
  hkStockCount,
  noDataStockCount,
  /**
   * 当天是否中国节假日（在插件启动时获取）
   */
  isHolidayChina,
  stocksRemind,
  remindSwitch,
  labelFormat,
  showStockErrorInfo,
  immersiveBackground,
  isDevelopment,
};
