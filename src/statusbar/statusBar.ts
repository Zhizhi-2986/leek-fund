import Axios from 'axios';
import { decode } from 'iconv-lite';
import { StatusBarAlignment, StatusBarItem, window } from 'vscode';
import StockService from '../explorer/stockService';
import globalState from '../globalState';
import { DEFAULT_LABEL_FORMAT } from '../shared/constant';
import { LeekFundConfig } from '../shared/leekConfig';
import { LeekTreeItem } from '../shared/leekTreeItem';
import {
  calcFixedPriceNumber,
  events,
  formatLabelString,
  formatNumber,
  randHeader,
} from '../shared/utils';

const STOCK_STATUS_BAR_PRIORITY = 4;
const INDEX_STATUS_BAR_START_PRIORITY = 3;
const DEFAULT_STATUS_BAR_INDEX_CODES = ['sh000001', 'sz399006', 'sh000680', 'int_nikkei', 'b_KOSPI'];

type StatusBarIndexInfo = {
  code: string;
  name: string;
  open: string;
  yestclose: string;
  price: string;
  high: string;
  low: string;
  updown: string;
  updownValue: number;
  percent: string;
  amount: string;
  time: string;
};

export class StatusBar {
  private stockService: StockService;
  private stockBarItem: StatusBarItem | null = null;
  private indexBarItems = new Map<string, StatusBarItem>();
  private carouselStocks: LeekTreeItem[] = [];
  private indexStocks: StatusBarIndexInfo[] = [];
  private carouselIndex = 0;
  private carouselTimer: NodeJS.Timeout | null = null;
  private statusBarItemLabelFormat: string = '';
  constructor(stockService: StockService) {
    this.stockService = stockService;
    this.refresh();
    this.bindEvents();
  }

  get riseColor(): string {
    return LeekFundConfig.getConfig('leek-fund.riseColor');
  }

  get fallColor(): string {
    return LeekFundConfig.getConfig('leek-fund.fallColor');
  }

  /** 隐藏股市状态栏 */
  get hideStatusBarStock(): boolean {
    return LeekFundConfig.getConfig('leek-fund.hideStatusBarStock');
  }

  /** 隐藏状态栏 */
  get hideStatusBar(): boolean {
    return LeekFundConfig.getConfig('leek-fund.hideStatusBar');
  }

  /** 隐藏图标 */
  get hideStatusBarIcon(): boolean {
    return LeekFundConfig.getConfig('leek-fund.hideStatusBarIcon');
  }

  get carouselInterval(): number {
    const interval = Number(LeekFundConfig.getConfig('leek-fund.interval', 5000));
    return Math.max(Number.isNaN(interval) ? 5000 : interval, 3000);
  }

  bindEvents() {
    events.on('stockListUpdate', () => {
      this.refresh();
    });
  }

  refresh() {
    this.refreshStockStatusBar();
    this.refreshIndexStatusBar();
  }

  /** 切换状态栏显示 */
  toggleVisibility() {
    LeekFundConfig.setConfig('leek-fund.hideStatusBar', !this.hideStatusBar);
    this.refresh();
  }

  /** 切换股票状态栏显示 */
  toggleStockBarVisibility() {
    LeekFundConfig.setConfig('leek-fund.hideStatusBarStock', !this.hideStatusBarStock);
    this.refreshStockStatusBar();
  }

  /** 切换图标显示 */
  toggleStatusBarIconVisibility() {
    LeekFundConfig.setConfig('leek-fund.hideStatusBarIcon', !this.hideStatusBarIcon);
    this.refresh();
  }

  refreshStockStatusBar() {
    if (this.hideStatusBar || this.hideStatusBarStock || !this.stockService.stockList.length) {
      this.disposeStockBar();
      return;
    }

    const statusBarStocks: string[] = LeekFundConfig.getConfig('leek-fund.statusBarStock') || [];
    const barStockList: LeekTreeItem[] = [];

    this.statusBarItemLabelFormat =
      globalState.labelFormat?.['statusBarLabelFormat'] ??
      DEFAULT_LABEL_FORMAT.statusBarLabelFormat;

    this.stockService.stockList.forEach((stockItem) => {
      const { code } = stockItem.info;
      if (statusBarStocks.includes(code)) {
        barStockList[statusBarStocks.indexOf(code)] = stockItem;
      }
    });

    this.carouselStocks = barStockList.filter(Boolean);
    if (!this.carouselStocks.length) {
      this.disposeStockBar();
      return;
    }

    if (this.carouselIndex >= this.carouselStocks.length) {
      this.carouselIndex = 0;
    }
    this.ensureStockBarItem();
    this.updateCurrentStockBar();
    this.resetCarouselTimer();
  }

  private ensureStockBarItem() {
    if (!this.stockBarItem) {
      this.stockBarItem = window.createStatusBarItem(
        StatusBarAlignment.Left,
        STOCK_STATUS_BAR_PRIORITY
      );
    }
  }

  private updateCurrentStockBar() {
    if (!this.stockBarItem || !this.carouselStocks.length) return;
    this.updateBarInfo(this.stockBarItem, this.carouselStocks[this.carouselIndex]);
  }

  private resetCarouselTimer() {
    this.stopCarouselTimer();
    if (this.carouselStocks.length <= 1) return;
    this.carouselTimer = setInterval(() => {
      this.carouselIndex = (this.carouselIndex + 1) % this.carouselStocks.length;
      this.updateCurrentStockBar();
    }, this.carouselInterval);
  }

  private stopCarouselTimer() {
    if (this.carouselTimer) {
      clearInterval(this.carouselTimer);
      this.carouselTimer = null;
    }
  }

  private disposeStockBar() {
    this.stopCarouselTimer();
    this.carouselStocks = [];
    this.carouselIndex = 0;
    this.stockBarItem?.hide();
    this.stockBarItem?.dispose();
    this.stockBarItem = null;
  }

  updateBarInfo(stockBarItem: StatusBarItem, item: LeekTreeItem | null) {
    if (!item) return;
    const {
      code,
      percent,
      open,
      yestclose,
      high,
      low,
      updown,
      amount,
      volume,
      afterPrice,
      afterPercent,
      time,
      name,
    } = item.info;
    const deLow = percent.indexOf('-') === -1;
    // Respect hideStatusBarIcon config
    const icon = this.hideStatusBarIcon ? '' : (deLow ? '📈' : '📉');

    // 格式化 updown 加上符号
    const updownFormatted = updown
      ? `${updown.startsWith('-') ? '' : '+'}${updown}`
      : '';

    stockBarItem.text = formatLabelString(this.statusBarItemLabelFormat, {
      ...item.info,
      name,
      code,
      price: item.info.price,
      percent: `${percent}%`,
      icon,
      updown: updownFormatted,
      open: open || '0',
      high: high || '0',
      low: low || '0',
      yestclose: yestclose || '0',
      volume: volume || '0',
      amount: amount || '0',
      time: time || '',
    });
    let afterText = '';
    if (afterPrice) {
      afterText = `盘后：${afterPrice}   涨跌幅：${afterPercent}%\n`;
    }
    stockBarItem.tooltip = `「今日行情」 ${
      name ?? '今日行情'
    }（${code}）\n涨跌：${updown}   百分：${percent}%\n最高：${high}   最低：${low}\n今开：${open}   昨收：${yestclose}\n${afterText}成交额：${amount}\n更新时间：${time}`;
    stockBarItem.color = deLow ? this.riseColor : this.fallColor;
    stockBarItem.command = {
      title: 'Change stock',
      command: 'leek-fund.changeStatusBarItem',
      arguments: [item.info.code],
    };

    stockBarItem.show();
    return stockBarItem;
  }

  private async refreshIndexStatusBar() {
    if (this.hideStatusBar) {
      this.disposeIndexBars();
      return;
    }
    if (this.indexStocks.length && this.indexBarItems.size) {
      this.updateIndexBars();
    }

    try {
      const indexStocks = await this.fetchStatusBarIndexData();
      if (this.hideStatusBar) {
        this.disposeIndexBars();
        return;
      }

      this.indexStocks = indexStocks;
      if (!this.indexStocks.length) {
        this.disposeIndexBars();
        return;
      }

      this.updateIndexBars();
    } catch (err) {
      console.error('refresh status bar index failed:', err);
      if (!this.indexStocks.length) {
        this.disposeIndexBars();
      }
    }
  }

  private async fetchStatusBarIndexData(): Promise<StatusBarIndexInfo[]> {
    const url = `https://hq.sinajs.cn/list=${DEFAULT_STATUS_BAR_INDEX_CODES.join(',')}`;
    const resp = await Axios.get<string>(url, {
      responseType: 'arraybuffer',
      transformResponse: [
        (data) => {
          const body = decode(data, 'GB18030');
          return body;
        },
      ],
      headers: {
        ...randHeader(),
        Referer: 'http://finance.sina.com.cn/',
      },
    });
    const indexMap = new Map<string, StatusBarIndexInfo>();
    String(resp.data || '')
      .split('\n')
      .forEach((line) => {
        const match = line.match(/^var hq_str_([^=]+)="([^"]*)";?$/);
        if (!match) return;
        const code = match[1].replace('$', '.');
        const params = match[2].split(',');
        if (!params[0]) return;
        const indexInfo = this.parseStatusBarIndexInfo(code, params);
        if (indexInfo) {
          indexMap.set(code, indexInfo);
        }
      });

    return DEFAULT_STATUS_BAR_INDEX_CODES.map((code) => indexMap.get(code)).filter(
      (item): item is StatusBarIndexInfo => Boolean(item)
    );
  }

  private parseStatusBarIndexInfo(
    code: string,
    params: string[]
  ): StatusBarIndexInfo | null {
    if (code.startsWith('int_')) {
      return this.parseSimpleGlobalIndexInfo(code, params);
    }
    if (code.startsWith('b_')) {
      return this.parseDetailedGlobalIndexInfo(code, params);
    }
    return this.parseCnIndexInfo(code, params);
  }

  private parseCnIndexInfo(code: string, params: string[]): StatusBarIndexInfo | null {
    if (params.length <= 5) {
      return null;
    }
    const open = params[1] || '0';
    const yestclose = params[2] || '0';
    const price = params[3] || '0';
    const high = params[4] || '0';
    const low = params[5] || '0';
    const amount = params[9] || '0';
    const time = [params[30], params[31]].filter(Boolean).join(' ');
    return this.buildStatusBarIndexInfo(code, params[0], open, yestclose, price, high, low, amount, time);
  }

  private parseSimpleGlobalIndexInfo(code: string, params: string[]): StatusBarIndexInfo | null {
    if (params.length <= 3) {
      return null;
    }
    const price = params[1] || '0';
    const updown = params[2] || '0';
    const yestclose = String(Number(price) - Number(updown));
    return this.buildStatusBarIndexInfo(code, params[0], price, yestclose, price, price, price, '0', '');
  }

  private parseDetailedGlobalIndexInfo(code: string, params: string[]): StatusBarIndexInfo | null {
    if (params.length <= 11) {
      return null;
    }
    const price = params[1] || '0';
    const updown = params[2] || '0';
    const yestclose = String(Number(price) - Number(updown));
    const open = params[8] || price;
    const high = params[10] || price;
    const low = params[11] || price;
    const amount = params[12] || '0';
    const time = [params[6], params[7] || params[5]].filter(Boolean).join(' ');
    return this.buildStatusBarIndexInfo(code, params[0], open, yestclose, price, high, low, amount, time);
  }

  private buildStatusBarIndexInfo(
    code: string,
    name: string,
    open: string,
    yestclose: string,
    price: string,
    high: string,
    low: string,
    amount: string,
    time: string
  ): StatusBarIndexInfo | null {
    const openValue = Number(open);
    const priceValue = Number(price);
    const yestcloseValue = Number(yestclose);
    const highValue = Number(high);
    const lowValue = Number(low);
    if (!name || !Number.isFinite(priceValue)) {
      return null;
    }

    const fixedNumber = calcFixedPriceNumber(open, yestclose, price, high, low);
    const updownValue = priceValue - yestcloseValue;
    const percentValue = yestcloseValue
      ? (Math.abs(updownValue) / yestcloseValue) * 100
      : 0;
    const sign = updownValue >= 0 ? '+' : '-';

    return {
      code,
      name,
      open: formatNumber(openValue, fixedNumber, false),
      yestclose: formatNumber(yestcloseValue, fixedNumber, false),
      price: formatNumber(priceValue, fixedNumber, false),
      high: formatNumber(highValue, fixedNumber, false),
      low: formatNumber(lowValue, fixedNumber, false),
      updown: formatNumber(updownValue, fixedNumber, false),
      updownValue,
      percent: `${sign}${formatNumber(percentValue, 2, false)}`,
      amount: formatNumber(Number(amount || 0), 2),
      time,
    };
  }

  private ensureIndexBarItem(code: string, priority: number): StatusBarItem {
    let indexBarItem = this.indexBarItems.get(code);
    if (!indexBarItem) {
      indexBarItem = window.createStatusBarItem(
        StatusBarAlignment.Left,
        priority
      );
      this.indexBarItems.set(code, indexBarItem);
    }
    return indexBarItem;
  }

  private updateIndexBars() {
    const currentCodes = new Set(this.indexStocks.map(({ code }) => code));
    this.indexBarItems.forEach((indexBarItem, code) => {
      if (!currentCodes.has(code)) {
        indexBarItem.hide();
        indexBarItem.dispose();
        this.indexBarItems.delete(code);
      }
    });

    this.indexStocks.forEach((item, index) => {
      const indexBarItem = this.ensureIndexBarItem(
        item.code,
        INDEX_STATUS_BAR_START_PRIORITY - index
      );
      this.updateIndexBar(indexBarItem, item);
    });
  }

  private updateIndexBar(indexBarItem: StatusBarItem, item: StatusBarIndexInfo) {
    const isRise = item.updownValue >= 0;
    const icon = this.hideStatusBarIcon ? '' : isRise ? '📈 ' : '📉 ';
    indexBarItem.text = `${icon}${item.name} ${item.price}（${item.percent}%）`;
    indexBarItem.color = isRise ? this.riseColor : this.fallColor;
    indexBarItem.tooltip = `「指数行情」 ${item.name}（${item.code}）\n涨跌：${item.updown}   百分：${item.percent}%\n最高：${item.high}   最低：${item.low}\n今开：${item.open}   昨收：${item.yestclose}\n成交额：${item.amount}\n更新时间：${item.time}`;
    indexBarItem.command = undefined;
    indexBarItem.show();
  }

  private disposeIndexBars() {
    this.indexStocks = [];
    this.indexBarItems.forEach((indexBarItem) => {
      indexBarItem.hide();
      indexBarItem.dispose();
    });
    this.indexBarItems.clear();
  }
}
