import { commands, window } from 'vscode';
import globalState from '../globalState';
import { setStocksRemindCfgCb } from './stocksRemindConfig';
import { LeekTreeItem } from './leekTreeItem';
import { MarketItemInfo, StockRemindCondition } from './typed';
import { multi1000 } from './utils';

/**
 * 执行股票提醒检测
 * 支持的提醒类型：
 * - price: 价格提醒（上涨到/下跌到）
 * - percent: 涨跌幅提醒（日涨幅达/日跌幅达）
 * - volume_ratio: 成交量放大提醒
 * - price_change: 价格变动提醒
 * - high_break: 突破日内高点提醒
 * - low_break: 跌破日内低点提醒
 */
export function executeStocksRemind(
  newStockList: Array<LeekTreeItem>,
  oldStockList: Array<LeekTreeItem>
) {
  if (!oldStockList.length || +globalState.remindSwitch === 0) {
    return;
  }
  const stocksRemind = globalState.stocksRemind;
  if (!stocksRemind || typeof stocksRemind !== 'object') {
    return;
  }

  const remindCodes = Object.keys(stocksRemind);
  if (!remindCodes.length) {
    return;
  }

  const oldStocksMap: Record<string, MarketItemInfo> = {};
  oldStockList.forEach(({ info }) => {
    oldStocksMap[info.code] = info;
  });

  newStockList.forEach((stock) => {
    try {
      const { info } = stock;
      if (!remindCodes.includes(info.code)) {
        return;
      }

      const oldStockInfo = oldStocksMap[info.code];
      if (!oldStockInfo) {
        return;
      }

      const remindConfig = stocksRemind[info.code] as StockRemindCondition;
      if (!remindConfig) {
        return;
      }

      // 获取当前数据
      const currentPrice = multi1000(parseFloat(info.price || '0'));
      const currentPercent = multi1000(parseFloat(info.percent || '0'));
      const currentHigh = multi1000(parseFloat(String(info.high || '0')));
      const currentLow = multi1000(parseFloat(String(info.low || '0')));
      const currentVolume = multi1000(parseFloat(info.volume || '0'));

      const oldPrice = multi1000(parseFloat(oldStockInfo.price || '0'));
      const oldPercent = multi1000(parseFloat(oldStockInfo.percent || '0'));
      const oldHigh = multi1000(parseFloat(String(oldStockInfo.high || '0')));
      const oldLow = multi1000(parseFloat(String(oldStockInfo.low || '0')));
      const oldVolume = multi1000(parseFloat(oldStockInfo.volume || '0'));

      const currentUpdown = currentPrice - oldPrice >= 0 ? 1 : -1;

      // 价格提醒检测
      checkPriceRemind(info, remindConfig, currentPrice, currentUpdown);

      // 涨跌幅提醒检测
      checkPercentRemind(info, remindConfig, currentPercent, currentUpdown);

      // 成交量放大提醒检测
      checkVolumeRatioRemind(info, remindConfig, currentVolume, oldVolume);

      // 价格变动提醒检测
      checkPriceChangeRemind(info, remindConfig, currentPrice, oldPrice, currentUpdown);

      // 突破日内高点提醒检测
      checkHighBreakRemind(info, remindConfig, currentPrice, currentHigh, oldHigh);

      // 跌破日内低点提醒检测
      checkLowBreakRemind(info, remindConfig, currentPrice, currentLow, oldLow);
    } catch (err) {
      console.error('Stock remind error:', err);
    }
  });
}

/**
 * 检测价格提醒
 */
function checkPriceRemind(
  info: MarketItemInfo,
  remindConfig: StockRemindCondition,
  currentPrice: number,
  currentUpdown: number
) {
  const { price1, price0 } = remindConfig;
  const remindPrices: string[] = [];

  if (price1 !== undefined && price1 > 0) {
    remindPrices.push(String(price1));
  }
  if (price0 !== undefined && price0 > 0) {
    remindPrices.push(String(-price0));
  }

  // 兼容旧格式 price 数组
  const legacyPrices = (remindConfig as any).price || [];
  remindPrices.push(...legacyPrices);

  if (!remindPrices.length) return;

  remindPrices.forEach((remindPriceStr) => {
    const remindPrice = Math.abs(multi1000(parseFloat(remindPriceStr)));
    const expectedUpdown = parseFloat(remindPriceStr) >= 0 ? 1 : -1;

    if (expectedUpdown !== currentUpdown) {
      return;
    }

    if (currentPrice === 0) return;

    const priceDiff = Math.abs(currentPrice - remindPrice);
    const threshold = Math.round(remindPrice * 0.001); // 0.1% 容差

    if (priceDiff <= threshold) {
      console.log('价格提醒触发:', info.name, currentPrice, remindPrice);
      showRemindNotice(
        info,
        `价格提醒：「${info.name}」${expectedUpdown > 0 ? '上涨' : '下跌'}至 ${info.price}`
      );
    }
  });
}

/**
 * 检测涨跌幅提醒
 */
function checkPercentRemind(
  info: MarketItemInfo,
  remindConfig: StockRemindCondition,
  currentPercent: number,
  currentUpdown: number
) {
  const { percent1, percent0 } = remindConfig;
  const remindPercents: string[] = [];

  if (percent1 !== undefined && percent1 > 0) {
    remindPercents.push(String(percent1));
  }
  if (percent0 !== undefined && percent0 < 0) {
    remindPercents.push(String(percent0));
  }

  // 兼容旧格式 percent 数组
  const legacyPercents = (remindConfig as any).percent || [];
  remindPercents.push(...legacyPercents);

  if (!remindPercents.length) return;

  remindPercents.forEach((remindPercentStr) => {
    const remindPercent = multi1000(parseFloat(remindPercentStr));
    const expectedUpdown = parseFloat(remindPercentStr) >= 0 ? 1 : -1;

    if (expectedUpdown !== currentUpdown) {
      return;
    }

    if (currentPercent === 0) return;

    const percentDiff = Math.abs(currentPercent - remindPercent);
    const threshold = Math.round(remindPercent * 0.01); // 1% 容差

    if (percentDiff <= threshold) {
      console.log('涨跌幅提醒触发:', info.name, currentPercent, remindPercent);
      showRemindNotice(
        info,
        `涨跌幅提醒：「${info.name}」${remindPercent >= 0 ? '上涨' : '下跌'}超 ${
          info.percent
        }%，现报：${info.price}`
      );
    }
  });
}

/**
 * 检测成交量放大提醒
 * volume_ratio: 成交量放大倍数（如 1.5 表示成交量是昨日同时段的1.5倍）
 */
function checkVolumeRatioRemind(
  info: MarketItemInfo,
  remindConfig: StockRemindCondition,
  currentVolume: number,
  oldVolume: number
) {
  const { volume_ratio } = remindConfig;
  if (volume_ratio === undefined || volume_ratio <= 0) return;

  if (oldVolume === 0) return;

  const ratio = currentVolume / oldVolume;
  if (ratio >= volume_ratio) {
    console.log('成交量放大提醒触发:', info.name, ratio, volume_ratio);
    showRemindNotice(
      info,
      `成交量提醒：「${info.name}」成交量放大 ${ratio.toFixed(2)} 倍（阈值：${volume_ratio}倍）`
    );
  }
}

/**
 * 检测价格变动提醒
 * price_change: 价格变动超过N元
 */
function checkPriceChangeRemind(
  info: MarketItemInfo,
  remindConfig: StockRemindCondition,
  currentPrice: number,
  oldPrice: number,
  currentUpdown: number
) {
  const { price_change } = remindConfig;
  if (price_change === undefined || price_change <= 0) return;

  const priceChangeAbs = Math.abs(currentPrice - oldPrice);
  if (priceChangeAbs >= multi1000(price_change)) {
    console.log('价格变动提醒触发:', info.name, priceChangeAbs, price_change);
    showRemindNotice(
      info,
      `价格变动提醒：「${info.name}」价格变动 ${currentUpdown > 0 ? '+' : ''}${(
        (currentPrice - oldPrice) /
        1000
      ).toFixed(2)} 元（阈值：${price_change}元）`
    );
  }
}

/**
 * 检测突破日内高点提醒
 */
function checkHighBreakRemind(
  info: MarketItemInfo,
  remindConfig: StockRemindCondition,
  currentPrice: number,
  currentHigh: number,
  oldHigh: number
) {
  if (!remindConfig.high_break) return;

  // 价格创新高（即当前价格等于或接近日内高点，且高于之前的日内高点）
  if (currentHigh > oldHigh && currentPrice >= currentHigh * 0.999) {
    console.log('突破日内高点提醒触发:', info.name, currentHigh, oldHigh);
    showRemindNotice(
      info,
      `新高提醒：「${info.name}」价格突破日内高点 ${info.high}`
    );
  }
}

/**
 * 检测跌破日内低点提醒
 */
function checkLowBreakRemind(
  info: MarketItemInfo,
  remindConfig: StockRemindCondition,
  currentPrice: number,
  currentLow: number,
  oldLow: number
) {
  if (!remindConfig.low_break) return;

  // 价格创新低（即当前价格等于或接近日内低点，且低于之前的日内低点）
  if (currentLow < oldLow && currentLow > 0 && currentPrice <= currentLow * 1.001) {
    console.log('跌破日内低点提醒触发:', info.name, currentLow, oldLow);
    showRemindNotice(
      info,
      `新低提醒：「${info.name}」价格跌破日内低点 ${info.low}`
    );
  }
}

const _remindedCache: Record<string, boolean> = {};

function showRemindNotice(info: MarketItemInfo, msg: string) {
  const { code } = info;
  if (_remindedCache[code]) {
    return;
  }
  // 避免波动反复频繁提醒，3分钟内不再提醒
  _remindedCache[code] = true;
  setTimeout(() => {
    _remindedCache[code] = false;
  }, 3 * 60 * 1000);

  window.showWarningMessage(msg, '删除该股提醒', '关闭所有提醒').then((res) => {
    switch (res) {
      case '关闭所有提醒':
        commands.executeCommand('leek-fund.toggleRemindSwitch', 0);
        break;
      case '删除该股提醒': {
        let newCfg = { ...globalState.stocksRemind };
        delete newCfg[code];
        setStocksRemindCfgCb(newCfg);
      }
      default:
        break;
    }
  });
}
