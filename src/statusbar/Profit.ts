import { StatusBarAlignment, StatusBarItem, window } from 'vscode';
import { LeekFundConfig } from '../shared/leekConfig';
import { events, formatDate, toFixed } from '../shared/utils';
import StockService from '../explorer/stockService';
import globalState from '../globalState';

const PREFIX = '💰';

export class ProfitStatusBar {
  stockBarItem: StatusBarItem | undefined;
  isEnable: boolean = false;
  hideStatusBar: boolean = false;
  unsubscribe: Function = () => {};
  fallColor: string = 'green';
  riseColor: string = 'red';
  constructor() {
    this.init();
  }

  init() {
    this.isEnable = LeekFundConfig.getConfig('leek-fund.showEarnings');
    this.hideStatusBar = LeekFundConfig.getConfig('leek-fund.hideStatusBar');
    //如果显示收益 && 显示状态栏
    if (this.isEnable && !this.hideStatusBar) {
      this.riseColor = LeekFundConfig.getConfig('leek-fund.riseColor');
      this.fallColor = LeekFundConfig.getConfig('leek-fund.fallColor');
      this.stockBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 3);
      this.stockBarItem.text = `${PREFIX}  --`;
      this.stockBarItem.command = 'leek-fund.setStockPrice';
      this.stockBarItem.show();

      const profitStockUpdateListener = (data: StockService) => {
        this.updateStockBarItem(data);
      };
      events.on('updateBar:stock-profit-refresh', profitStockUpdateListener);
      this.unsubscribe = () => {
        events.off('updateBar:stock-profit-refresh', profitStockUpdateListener);
      };
    }
  }

  reload() {
    this.riseColor = LeekFundConfig.getConfig('leek-fund.riseColor');
    this.fallColor = LeekFundConfig.getConfig('leek-fund.fallColor');
    const enable: boolean = LeekFundConfig.getConfig('leek-fund.showEarnings');
    const hideStatusBar: boolean = LeekFundConfig.getConfig('leek-fund.hideStatusBar');
    if (this.isEnable !== enable || this.hideStatusBar !== hideStatusBar) {
      this.isEnable = enable;
      this.hideStatusBar = hideStatusBar;
      //如果隐藏状态栏 || 隐藏收益
      if (hideStatusBar || !enable) {
        this.destroy();
      } else {
        this.init();
      }
    }
  }

  updateStockBarItem(data: StockService) {
    if (this.stockBarItem) {
      const stockList = data.getSelfSelected();
      type StockInfoType = {
        id: string;
        name: string;
        low: number | string;
        high: number | string;
        open: number | string;
        percent: string;
        price: number | string;
        amount: number;
        incomeTotal: number;
        incomeToday: number;
        heldBase: number;
        yestBase: number;
        incomeTotalCNY: number;
        incomeTodayCNY: number;
        heldBaseCNY: number;
        yestBaseCNY: number;
        percentTotal: string;
      };
      const stockInfo: StockInfoType[] = [];

      const forexList = globalState.forexList;
      stockList.forEach((s) => {
        let tmp = {} as StockInfoType;
        const { id, info } = s;
        const {
          high,
          low,
          open,
          yestclose,
          percent,
          price,
          name,
          heldAmount,
          heldPrice,
          todayHeldPrice,
          isSellOut,
          code,
        } = info;
        if (id && open && price) {
          if (!heldAmount || !heldPrice) {
            return false;
          }
          // const incomeTotal = amount * (Number(price).toFixed(2) - unitPrice.toFixed(2));
          // const incomeToday = amount * (Number(price).toFixed(2) - Number(open).toFixed(2));
          const heldBase = heldPrice * heldAmount; // 持仓成本
          const yestBase = Number(yestclose || open) * heldAmount; // 昨日持仓市值
          const incomeTotal = heldAmount * (Number(price) - heldPrice);
          // fix #399，在昨日收盘价没有的时候使用今日开盘价
          let incomeToday =
            heldAmount * (Number(price) - Number(todayHeldPrice || yestclose || open));
          // 如果是清仓状态，今日收益为 持仓数 * (今日持仓价 - 昨日收盘价或今日开盘价)
          if (isSellOut) {
            incomeToday = heldAmount * (Number(todayHeldPrice) - Number(yestclose || open));
          }
          const percentTotal = ((Number(incomeTotal) / (heldPrice * heldAmount)) * 100).toFixed(2);

          let incomeTodayCNY = 0;
          let incomeTotalCNY = 0;
          let heldBaseCNY = 0;
          let yestBaseCNY = 0;

          const forex = forexList.find(({ filter }) => {
            if (typeof filter === 'function') {
              return filter(code);
            } else if (filter instanceof RegExp) {
              return filter.test(code);
            }
          });

          if (forex) {
            if (forex.spotSellPrice) {
              // 按现汇卖出价计算
              incomeTodayCNY = (forex.spotSellPrice * Number(incomeToday)) / 100;
              incomeTotalCNY = (forex.spotSellPrice * Number(incomeTotal)) / 100;
              heldBaseCNY = (forex.spotSellPrice * Number(heldBase)) / 100;
              yestBaseCNY = (forex.spotSellPrice * Number(yestBase)) / 100;
            }
          }

          tmp = {
            id,
            name,
            high: '' + high,
            low: '' + low,
            open,
            percent,
            price,
            amount: heldAmount,
            incomeTotal,
            incomeToday,
            heldBase,
            yestBase,
            incomeTodayCNY,
            incomeTotalCNY,
            heldBaseCNY,
            yestBaseCNY,
            percentTotal,
          };
          stockInfo.push(tmp);
        }
      });
      const date = formatDate(new Date());
      const allIncomeToday = stockInfo.reduce((prev, cur) => {
        return prev + Number(cur.incomeTodayCNY ? cur.incomeTodayCNY : cur.incomeToday);
      }, 0);
      const allIncomeTotal = stockInfo.reduce((prev, cur) => {
        return prev + Number(cur.incomeTotalCNY ? cur.incomeTotalCNY : cur.incomeTotal);
      }, 0);
      const heldBaseTotal = stockInfo.reduce((prev, cur) => {
        return prev + Number(cur.heldBaseCNY ? cur.heldBaseCNY : cur.heldBase);
      }, 0);
      const yestBaseTotal = stockInfo.reduce((prev, cur) => {
        return prev + Number(cur.yestBaseCNY ? cur.yestBaseCNY : cur.yestBase);
      }, 0);
      const heldPercentTotal = ((allIncomeTotal / heldBaseTotal) * 100).toFixed(2);
      const todayPercentTotal = ((allIncomeToday / yestBaseTotal) * 100).toFixed(2);
      // Use the year, month, and day variables as needed
      this.stockBarItem.text = `${PREFIX} ${toFixed(allIncomeTotal).toFixed(2)} | ${toFixed(
        allIncomeToday
      ).toFixed(2)}`;
      // this.stockBarItem.color = allIncomeTotal >= 0 ? this.riseColor : this.fallColor;
      this.stockBarItem.tooltip =
        `「股票收益统计 ${date}」\r\n` +
        `总市值: ${toFixed(allIncomeToday + yestBaseTotal)} 总收益: ${toFixed(
          allIncomeTotal
        )} (${heldPercentTotal}%) 今天${allIncomeToday >= 0 ? '盈利' : '亏损'}: ${toFixed(
          allIncomeToday
        )} (${todayPercentTotal}%)\r\n` +
        '-----------------------------\r\n' +
        stockInfo
          .sort((a, b) => b.incomeToday - a.incomeToday)
          .map((v) => {
            return `${v.name} 总收益: ${toFixed(v.incomeTotal)} ${
              v.incomeTotalCNY ? `(CNY: ${toFixed(v.incomeTotalCNY)})` : ''
            } (${v.percentTotal}%) 今天${Number(v.incomeToday) >= 0 ? '盈利' : '亏损'}: ${toFixed(
              v.incomeToday
            )} ${v.incomeTodayCNY ? `(CNY: ${toFixed(v.incomeTodayCNY)})` : ''} (${v.percent}%) `;
          })
          .join('\r\n-----------------------------\r\n');
      this.stockBarItem.show();
    }
  }

  destroy() {
    this.unsubscribe();
    this.stockBarItem?.dispose();
  }
}
