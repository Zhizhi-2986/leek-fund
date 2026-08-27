import { ExtensionContext, QuickPickItem } from 'vscode';
import globalState from '../globalState';
import { LeekTreeItem } from '../shared/leekTreeItem';
import { LeekFundConfig } from '../shared/leekConfig';
import { MarketItemInfo } from '../shared/typed';
import { executeStocksRemind } from '../shared/remindNotification';
import { events, formatNumber, sortData } from '../shared/utils';
import { LeekService } from './leekService';
import Log from '../shared/log';
import { getQuotes, searchStocks, type QuoteResult } from '../data-source';

export default class StockService extends LeekService {
  public stockList: Array<LeekTreeItem> = [];
  private context: ExtensionContext;

  constructor(context: ExtensionContext) {
    super();
    this.context = context;
  }
  /**
   * 获取自选,去掉大盘数据
   * @returns
   */
  getSelfSelected() {
    const s = 'sh000001,sh000300,sh000016,sh000688,usr_ixic,usr_dji,usr_inx';
    const maps = s.split(',');
    return this.stockList.filter((item) => !maps.includes(item.info.code));
  }

  async getData(codes: Array<string>, order: number): Promise<Array<LeekTreeItem>> {
    if (!codes || codes.length === 0) return [];

    // 收集所有需要查询的代码
    // A 股（含指数）+ ETF 走东方财富 → 新浪备
    // 全球指数（usr_/b_/int_/gb_）走新浪
    const stockCodes = codes.filter((code) => /^(sh|sz|bj|usr_|gb_|b_|int_)/.test(code));
    const etfCodes = LeekFundConfig.getEtfStocks();
    const allCodes = [...new Set([...stockCodes, ...etfCodes])];

    globalState.noDataStockCount = 0;
    globalState.etfStockCount = etfCodes.length;

    // 统一获取行情
    const quoteMap = await getQuotes(allCodes);

    // 转换为 LeekTreeItem
    const stockList: Array<LeekTreeItem> = [];
    for (const code of allCodes) {
      const quote = quoteMap.get(code);
      if (quote) {
        stockList.push(this.quoteToTreeItem(quote));
      } else {
        globalState.noDataStockCount += 1;
        const nodataItem = new LeekTreeItem(
          {
            code,
            name: `接口不支持该股票 ${code}`,
            showLabel: this.showLabel,
            isStock: true,
            percent: '',
            type: 'nodata',
            contextValue: 'nodata',
          },
          this.context
        );
        stockList.push(nodataItem);
      }
    }

    // 更新计数
    globalState.aStockCount = stockList.filter(
      (item) => item.info.type !== 'nodata' && /^(sh|sz|bj)/.test(item.info.code || '')
    ).length;
    globalState.usStockCount = stockList.filter(
      (item) => /^usr_/.test(item.info.code || '')
    ).length;

    const res = sortData(stockList, order);
    executeStocksRemind(res, this.stockList);
    const oldStockList = this.stockList;
    this.stockList = res;
    this.syncStatusBarContext();
    events.emit('stockListUpdate', this.stockList, oldStockList);
    return res;
  }

  /** 将 QuoteResult 转为 LeekTreeItem */
  private quoteToTreeItem(quote: QuoteResult): LeekTreeItem {
    const { code, name, price, yestclose, open, high, low, volume, amount, time, updown: rawUpdown } = quote;

    // 确定小数精度（替代 calcFixedPriceNumber 逻辑）
    const decs = [open, yestclose, price, high, low].map((v) => {
      const s = String(v);
      const dot = s.indexOf('.');
      return dot < 0 ? 0 : s.length - dot - 1;
    });
    const fixed = Math.max(Math.min(Math.max(...decs), 4), 0);

    // 市场前缀 & 符号
    let type = 'sh';
    let symbol = code;
    if (/^(sh|sz|bj)/.test(code)) {
      type = code.substring(0, 2);
      symbol = code.substring(2);
    } else if (/^usr_/.test(code)) {
      type = 'usr_';
      symbol = code.substring(4);
    } else if (/^gb_/.test(code)) {
      type = 'gb_';
      symbol = code.substring(3);
    }

    // 格式化（与原有格式一致）
    const updownStr = formatNumber(rawUpdown, fixed, false);
    const pct = yestclose > 0 ? (Math.abs(rawUpdown) / yestclose) * 100 : 0;
    const percentStr = (rawUpdown >= 0 ? '+' : '-') + formatNumber(pct, 2, false);

    const stockItem: MarketItemInfo = {
      code,
      name,
      open: formatNumber(open, fixed, false),
      yestclose: formatNumber(yestclose, fixed, false),
      price: formatNumber(price, fixed, false),
      low: formatNumber(low, fixed, false),
      high: formatNumber(high, fixed, false),
      volume: formatNumber(volume, 2),
      amount: formatNumber(amount, 2),
      time,
      updown: updownStr,
      percent: percentStr,
      contextValue: 'statusBarStockHidden',
      showLabel: this.showLabel,
      isStock: true,
      type,
      symbol,
    };

    return new LeekTreeItem(stockItem, this.context);
  }

  syncStatusBarContext(
    statusBarStocks: string[] = LeekFundConfig.getConfig('leek-fund.statusBarStock') || []
  ): void {
    this.stockList.forEach((stock) => {
      if (stock.contextValue !== 'nodata') {
        stock.contextValue = this.getStockContextValue(stock.info.code, statusBarStocks);
      }
    });
  }

  private getStockContextValue(code: string, statusBarStocks: string[]): string {
    return statusBarStocks.includes(code) ? 'statusBarStockVisible' : 'statusBarStockHidden';
  }

  // https://github.com/LeekHub/leek-fund/issues/266
  async getStockSuggestList(searchText = ''): Promise<QuickPickItem[]> {
    if (!searchText) {
      return [{ label: '请输入关键词查询，如：0000001 或 上证指数' }];
    }

    const result: QuickPickItem[] = [];

    try {
      const stocks = await searchStocks(searchText);
      stocks.forEach((item: any) => {
        const { code, name, market } = item;
        // 兼容新旧格式：code 可能是 'sh600519' 或 '600519'
        const hasPrefix = /^(sh|sz|bj|hk)/.test(code);
        const _code = hasPrefix ? code : `${market}${code}`.toLowerCase();
        if (/^(sh|sz|bj)/.test(_code)) {
          result.push({
            label: `${_code} | ${name}`,
            description: `A股`,
          });
        } else if (/^hk/.test(_code)) {
          result.push({
            label: `${_code} | ${name}`,
            description: `港股`,
          });
        } else {
          result.push({
            label: `${_code} | ${name}`,
            description: `其他`,
          });
        }
      });
      if (result.length === 0) {
        return [{ label: '未找到匹配结果' }];
      }
      return result;
    } catch (err) {
      Log.info('searchStockList error: ', searchText);
      console.error(err);
      return [{ label: '股票查询失败，请重试' }];
    }
  }
}
