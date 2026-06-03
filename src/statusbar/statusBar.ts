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

const STOCK_STATUS_BAR_PRIORITY = 3;
const INDEX_STATUS_BAR_PRIORITY = 2;
const MARKET_BREADTH_STATUS_BAR_PRIORITY = 1;
const DEFAULT_STATUS_BAR_INDEX_CODES = ['sh000001', 'sz399006', 'sh000680'];
const MARKET_BREADTH_URL = 'https://emdatah5.eastmoney.com/dc/NXFXB/GetUpDownData?type=0';

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

type MarketBreadthInfo = {
  up: number;
  down: number;
  flat: number;
  total: number;
  limitUp: number;
  naturalLimitUp: number;
  limitDown: number;
  time: string;
};

export class StatusBar {
  private stockService: StockService;
  private stockBarItem: StatusBarItem | null = null;
  private indexBarItem: StatusBarItem | null = null;
  private marketBreadthBarItem: StatusBarItem | null = null;
  private carouselStocks: LeekTreeItem[] = [];
  private indexStocks: StatusBarIndexInfo[] = [];
  private marketBreadthInfo: MarketBreadthInfo | null = null;
  private carouselIndex = 0;
  private indexCarouselIndex = 0;
  private carouselTimer: NodeJS.Timeout | null = null;
  private indexCarouselTimer: NodeJS.Timeout | null = null;
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
    this.refreshMarketBreadthStatusBar();
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
      afterPrice,
      afterPercent,
      heldAmount,
      heldPrice,
    } = item.info;
    const deLow = percent.indexOf('-') === -1;
    // Respect hideStatusBarIcon config
    const icon = this.hideStatusBarIcon ? '' : (deLow ? '📈' : '📉');
    stockBarItem.text = formatLabelString(this.statusBarItemLabelFormat, {
      ...item.info,
      percent: `${percent}%`,
      icon,
    });
    let heldText = '';
    if (heldAmount && heldPrice) {
      heldText = `成本：${heldPrice}   持仓：${heldAmount}\n`;
    }
    let afterText = '';
    if (afterPrice) {
      afterText = `盘后：${afterPrice}   涨跌幅：${afterPercent}%\n`;
    }
    stockBarItem.tooltip = `「今日行情」 ${
      item.info?.name ?? '今日行情'
    }（${code}）\n涨跌：${updown}   百分：${percent}%\n最高：${high}   最低：${low}\n今开：${open}   昨收：${yestclose}\n${afterText}${heldText}成交额：${amount}\n更新时间：${
      item.info?.time
    }`;
    stockBarItem.color = deLow ? this.riseColor : this.fallColor;
    stockBarItem.command = {
      title: 'Change stock',
      command: 'leek-fund.changeStatusBarItem',
      arguments: [item.id],
    };

    stockBarItem.show();
    return stockBarItem;
  }

  private async refreshIndexStatusBar() {
    if (this.hideStatusBar) {
      this.disposeIndexBar();
      return;
    }
    if (this.indexStocks.length && this.indexBarItem) {
      this.updateCurrentIndexBar();
    }

    try {
      const indexStocks = await this.fetchStatusBarIndexData();
      if (this.hideStatusBar) {
        this.disposeIndexBar();
        return;
      }

      this.indexStocks = indexStocks;
      if (!this.indexStocks.length) {
        this.disposeIndexBar();
        return;
      }

      if (this.indexCarouselIndex >= this.indexStocks.length) {
        this.indexCarouselIndex = 0;
      }
      this.ensureIndexBarItem();
      this.updateCurrentIndexBar();
      this.resetIndexCarouselTimer();
    } catch (err) {
      console.error('refresh status bar index failed:', err);
      if (!this.indexStocks.length) {
        this.disposeIndexBar();
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
        if (params.length <= 5 || !params[0]) return;

        const open = params[1] || '0';
        const yestclose = params[2] || '0';
        const price = params[3] || '0';
        const high = params[4] || '0';
        const low = params[5] || '0';
        const fixedNumber = calcFixedPriceNumber(open, yestclose, price, high, low);
        const openValue = Number(open);
        const priceValue = Number(price);
        const yestcloseValue = Number(yestclose);
        const highValue = Number(high);
        const lowValue = Number(low);
        const updownValue = priceValue - yestcloseValue;
        const percentValue = yestcloseValue
          ? (Math.abs(updownValue) / yestcloseValue) * 100
          : 0;
        const sign = updownValue >= 0 ? '+' : '-';

        indexMap.set(code, {
          code,
          name: params[0],
          open: formatNumber(openValue, fixedNumber, false),
          yestclose: formatNumber(yestcloseValue, fixedNumber, false),
          price: formatNumber(priceValue, fixedNumber, false),
          high: formatNumber(highValue, fixedNumber, false),
          low: formatNumber(lowValue, fixedNumber, false),
          updown: formatNumber(updownValue, fixedNumber, false),
          updownValue,
          percent: `${sign}${formatNumber(percentValue, 2, false)}`,
          amount: formatNumber(Number(params[9] || 0), 2),
          time: [params[30], params[31]].filter(Boolean).join(' '),
        });
      });

    return DEFAULT_STATUS_BAR_INDEX_CODES.map((code) => indexMap.get(code)).filter(
      (item): item is StatusBarIndexInfo => Boolean(item)
    );
  }

  private ensureIndexBarItem() {
    if (!this.indexBarItem) {
      this.indexBarItem = window.createStatusBarItem(
        StatusBarAlignment.Left,
        INDEX_STATUS_BAR_PRIORITY
      );
    }
  }

  private updateCurrentIndexBar() {
    if (!this.indexBarItem || !this.indexStocks.length) return;
    const item = this.indexStocks[this.indexCarouselIndex];
    const isRise = item.updownValue >= 0;
    const icon = this.hideStatusBarIcon ? '' : isRise ? '📈 ' : '📉 ';
    this.indexBarItem.text = `${icon}${item.name} ${item.price}（${item.percent}%）`;
    this.indexBarItem.color = isRise ? this.riseColor : this.fallColor;
    this.indexBarItem.tooltip = `「指数行情」 ${item.name}（${item.code}）\n涨跌：${item.updown}   百分：${item.percent}%\n最高：${item.high}   最低：${item.low}\n今开：${item.open}   昨收：${item.yestclose}\n成交额：${item.amount}\n更新时间：${item.time}`;
    this.indexBarItem.command = undefined;
    this.indexBarItem.show();
  }

  private resetIndexCarouselTimer() {
    this.stopIndexCarouselTimer();
    if (this.indexStocks.length <= 1) return;
    this.indexCarouselTimer = setInterval(() => {
      this.indexCarouselIndex = (this.indexCarouselIndex + 1) % this.indexStocks.length;
      this.updateCurrentIndexBar();
    }, this.carouselInterval);
  }

  private stopIndexCarouselTimer() {
    if (this.indexCarouselTimer) {
      clearInterval(this.indexCarouselTimer);
      this.indexCarouselTimer = null;
    }
  }

  private disposeIndexBar() {
    this.stopIndexCarouselTimer();
    this.indexStocks = [];
    this.indexCarouselIndex = 0;
    this.indexBarItem?.hide();
    this.indexBarItem?.dispose();
    this.indexBarItem = null;
  }

  private async refreshMarketBreadthStatusBar() {
    if (this.hideStatusBar) {
      this.disposeMarketBreadthBar();
      return;
    }
    if (this.marketBreadthInfo && this.marketBreadthBarItem) {
      this.updateMarketBreadthBar();
    }

    try {
      const info = await this.fetchMarketBreadthData();
      if (this.hideStatusBar) {
        this.disposeMarketBreadthBar();
        return;
      }
      if (!info) {
        if (!this.marketBreadthInfo) {
          this.disposeMarketBreadthBar();
        }
        return;
      }

      this.marketBreadthInfo = info;
      this.ensureMarketBreadthBarItem();
      this.updateMarketBreadthBar();
    } catch (err) {
      console.error('refresh market breadth status bar failed:', err);
      if (!this.marketBreadthInfo) {
        this.disposeMarketBreadthBar();
      }
    }
  }

  private async fetchMarketBreadthData(): Promise<MarketBreadthInfo | null> {
    const resp = await Axios.get<any[]>(MARKET_BREADTH_URL, {
      headers: randHeader(),
    });
    const data = Array.isArray(resp.data) ? resp.data[0] : null;
    if (!data) return null;

    const up = Number(data.up || 0);
    const down = Number(data.down || 0);
    const flat = Number(data.r0 || 0);
    return {
      up,
      down,
      flat,
      total: up + down + flat,
      limitUp: Number(data.t || 0),
      naturalLimitUp: Number(data.tn || 0),
      limitDown: Number(data.b || 0),
      time: data.time ? String(data.time) : '',
    };
  }

  private ensureMarketBreadthBarItem() {
    if (!this.marketBreadthBarItem) {
      this.marketBreadthBarItem = window.createStatusBarItem(
        StatusBarAlignment.Left,
        MARKET_BREADTH_STATUS_BAR_PRIORITY
      );
    }
  }

  private updateMarketBreadthBar() {
    if (!this.marketBreadthBarItem || !this.marketBreadthInfo) return;
    const { up, down, flat, total, limitUp, naturalLimitUp, limitDown, time } =
      this.marketBreadthInfo;
    const icon = this.hideStatusBarIcon ? '' : '📊 ';
    this.marketBreadthBarItem.text = `${icon}全A 涨${up} 跌${down} 平${flat}`;
    this.marketBreadthBarItem.color = up >= down ? this.riseColor : this.fallColor;
    this.marketBreadthBarItem.tooltip = `「全市场涨跌统计」\n全部：${total}\n上涨：${up}   下跌：${down}   平盘：${flat}\n涨停：${limitUp}   自然涨停：${naturalLimitUp}   跌停：${limitDown}\n更新时间：${time}`;
    this.marketBreadthBarItem.command = undefined;
    this.marketBreadthBarItem.show();
  }

  private disposeMarketBreadthBar() {
    this.marketBreadthInfo = null;
    this.marketBreadthBarItem?.hide();
    this.marketBreadthBarItem?.dispose();
    this.marketBreadthBarItem = null;
  }
}
