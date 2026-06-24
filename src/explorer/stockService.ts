import Axios from 'axios';
import { decode } from 'iconv-lite';
import { ExtensionContext, QuickPickItem, window } from 'vscode';
import globalState from '../globalState';
import { LeekTreeItem } from '../shared/leekTreeItem';
import { LeekFundConfig } from '../shared/leekConfig';
import { executeStocksRemind } from '../shared/remindNotification';
import { calcFixedPriceNumber, events, formatNumber, randHeader, sortData } from '../shared/utils';
import { LeekService } from './leekService';
import moment = require('moment');
import momentTz = require('moment-timezone');
import Log from '../shared/log';
import { getTencentHKStockData, searchStockList } from '../shared/tencentStock';

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
    // Log.info('fetching stock data…');
    if ((codes && codes.length === 0) || !codes) {
      return [];
    }

    let stockCodes = codes.filter((code) => /^(sh|sz|bj|hk|usr_|gb_)/.test(code));
    const hkCodes: Array<string> = []; // 港股单独请求腾讯港股数据源
    stockCodes = stockCodes.filter((code) => {
      if (code.startsWith('hk')) {
        hkCodes.push('hk' + code.substring(2).toUpperCase()); // 指数去掉'hk'并转为大写，适配腾讯港股接口
        return false;
      } else {
        return true;
      }
    });

    let stockList: Array<LeekTreeItem> = [];
    globalState.noDataStockCount = 0; // 重置无数据股票计数
    const result = await Promise.allSettled([
      this.getStockData(stockCodes),
      this.getHKStockData(hkCodes),
    ]);
    result.forEach((item) => {
      if (item.status === 'fulfilled') {
        stockList = stockList.concat(item.value);
      }
    });

    const res = sortData(stockList, order);
    executeStocksRemind(res, this.stockList);
    const oldStockList = this.stockList;
    this.stockList = res;
    this.syncStatusBarContext();
    events.emit('stockListUpdate', this.stockList, oldStockList);
    return res;
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

  async getStockData(codes: Array<string>): Promise<Array<LeekTreeItem>> {
    if ((codes && codes.length === 0) || !codes) {
      return [];
    }

    let aStockCount = 0;
    let usStockCount = 0;
    let noDataStockCount = 0;
    let stockList: Array<LeekTreeItem> = [];

    const url = `https://hq.sinajs.cn/list=${codes
      .map((code) => code.replace('.', '$')) // 新浪接口中点号替换为$
      .join(',')}`;
    try {
      const resp = await Axios.get(url, {
        // axios 乱码解决
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
      if (/FAILED/.test(resp.data)) {
        if (codes.length === 1) {
          window.showErrorMessage(
            `fail: error Stock code in ${codes}, please delete error Stock code.`
          );
          return [];
        }
        for (const code of codes) {
          stockList = stockList.concat(await this.getStockData(new Array(code)));
        }
      } else {
        const splitData = resp.data.split('";\n');

        const estTime = momentTz().tz('America/New_York');
        // 判断美东时间的时间是否在4:00AM到9:30AM之间
        const isUsrPreMarket = estTime.isBetween(
          estTime.clone().set({ hour: 4, minute: 0, second: 0, millisecond: 0 }),
          estTime.clone().set({ hour: 9, minute: 30, second: 0, millisecond: 0 })
        );
        // 判断美东时间的时间是否在9:30AM到4:00PM之间
        const isUsrMainMarket = estTime.isBetween(
          estTime.clone().set({ hour: 9, minute: 30, second: 0, millisecond: 0 }),
          estTime.clone().set({ hour: 16, minute: 0, second: 0, millisecond: 0 })
        );
        // 判断美东时间的时间是否在4:00PM到8:00PM之间
        const isUsrAfterMarket = estTime.isBetween(
          estTime.clone().set({ hour: 16, minute: 0, second: 0, millisecond: 0 }),
          estTime.clone().set({ hour: 20, minute: 0, second: 0, millisecond: 0 })
        );

        for (let i = 0; i < splitData.length - 1; i++) {
          let code = splitData[i].split('="')[0].split('var hq_str_')[1];
          if (code.includes('$')) {
            code = code.replace('$', '.'); // 新浪接口中$替换回点号,否则会造成无法匹配删除的结果
          }
          const params = splitData[i].split('="')[1].split(',');
          let type = code.substr(0, 2) || 'sh';
          let symbol = code.substr(2);
          let stockItem: any;
          let fixedNumber = 2;
          if (params.length > 1) {
            if (/^(sh|sz|bj)/.test(code)) {
              // A股
              let open = params[1];
              let yestclose = params[2];
              let price = params[3];
              if (Number(price) === 0) {
                const buy1 = params[6];
                if (Number(buy1) !== 0) {
                  price = buy1;
                } else {
                  price = yestclose;
                }
              }
              let high = params[4];
              let low = params[5];
              fixedNumber = calcFixedPriceNumber(open, yestclose, price, high, low);

              if (
                Number(price) === 0 &&
                Number(high) === 0 &&
                Number(low) === 0 &&
                Number(yestclose) === 0
              ) {
                noDataStockCount += 1;
                const stockItemTemp = {
                  code: code,
                  name: `接口不支持该股票 ${params[0] ? params[0] : code}`,
                  showLabel: this.showLabel,
                  isStock: true,
                  percent: '',
                  type: 'nodata',
                  contextValue: 'nodata',
                };
                const treeItem = new LeekTreeItem(stockItemTemp, this.context);
                stockList.push(treeItem);
              } else {
                stockItem = {
                  code,
                  name: params[0],
                  open: formatNumber(open, fixedNumber, false),
                  yestclose: formatNumber(yestclose, fixedNumber, false),
                  price: formatNumber(price, fixedNumber, false),
                  low: formatNumber(low, fixedNumber, false),
                  high: formatNumber(high, fixedNumber, false),
                  volume: formatNumber(params[8], 2),
                  amount: formatNumber(params[9], 2),
                  time: `${params[30]} ${params[31]}`,
                  percent: '',
                  contextValue: 'statusBarStockHidden',
                };
                aStockCount += 1;
              }
            } else if (/^gb_/.test(code)) {
              symbol = code.substr(3);
              let open = params[5];
              let yestclose = params[26];
              let price = params[1];
              let high = params[6];
              let low = params[7];
              fixedNumber = calcFixedPriceNumber(open, yestclose, price, high, low);
              stockItem = {
                code,
                name: params[0],
                open: formatNumber(open, fixedNumber, false),
                yestclose: formatNumber(yestclose, fixedNumber, false),
                price: formatNumber(price, fixedNumber, false),
                low: formatNumber(low, fixedNumber, false),
                high: formatNumber(high, fixedNumber, false),
                volume: formatNumber(params[10], 2),
                amount: '接口无数据',
                percent: '',
                contextValue: 'statusBarStockHidden',
              };
              type = code.substr(0, 3);
              noDataStockCount += 1;
            } else if (/^usr_/.test(code)) {
              // 0 名称，1 最新价 2 涨跌百分比
              // var hq_str_usr_nvda="英伟达,198.6900,-3.96,
              // 3 更新时间 4 涨跌数字 5 今开 6 最高 7 最低
              // 2025-11-05 17:27:07,-8.1900,203.0000,203.9699,197.9300,
              // 8 9 10 成交量 11
              // 212.1900,86.6000,188919320,189303100,4837505430000,
              // 13 14 15 16 17 18 19 20
              // 3.54,56.130000,0.00,0.00,0.01,0.00,24347000000,69,
              // 21 盘前最新价 22 盘前涨跌幅 23 盘前涨跌 24 美东时间 25 昨日美东收盘时间 26 昨日收盘价
              // 197.6300,-0.53,-1.06,Nov 05 04:27AM EST,Nov 04 04:00PM EST,206.8800,
              // 27 28 29 30 31 32 33 34 35 新一天盘前时昨日收盘价
              // 388870,1,2025,37901854538.6275,198.4000,196.5900,76916423.7300,197.1100,198.6900";

              symbol = code.substr(4);
              let open = params[5];
              let yestclose = params[26];
              let price = params[1];
              let afterPrice: any = '';
              let afterPercent = '';
              if (isUsrMainMarket) {
                price = params[1]; // 盘中价格
                yestclose = params[26]; // 昨收盘
              } else if (isUsrPreMarket) {
                // 兼容纳指等无盘前价格的情况
                if (Number(params[21]) !== 0) {
                  price = params[21]; // 盘前价格
                }
                // 兼容纳指等无盘前价格的情况
                if (Number(params[35]) !== 0) {
                  yestclose = params[35]; // 新一天盘前时昨日收盘价
                }
              } else if (isUsrAfterMarket) {
                // 兼容纳指等无盘后价格的情况
                if (Number(params[21]) !== 0) {
                  price = params[21]; // 盘后价格
                }
                // 兼容纳指等无盘后价格的情况
                if (Number(params[1]) !== 0) {
                  yestclose = params[1]; // 盘后的收盘价为盘中价
                }
              } else {
                // 夜盘时间取盘后价格
                if (Number(params[21]) !== 0) {
                  afterPrice = params[21]; // 盘后价格
                  afterPercent = params[22]; // 盘后涨跌幅
                }
              }
              let high = params[6];
              let low = params[7];
              fixedNumber = calcFixedPriceNumber(open, yestclose, price, high, low);
              stockItem = {
                code,
                name: params[0],
                open: formatNumber(open, fixedNumber, false),
                yestclose: formatNumber(yestclose, fixedNumber, false),
                price: formatNumber(price, fixedNumber, false),
                low: formatNumber(low, fixedNumber, false),
                high: formatNumber(high, fixedNumber, false),
                volume: formatNumber(params[10], 2),
                amount: '接口无数据',
                time: params[3],
                percent: '',
                contextValue: 'statusBarStockHidden',
                afterPrice: afterPrice ? formatNumber(afterPrice, fixedNumber, false) : '',
                afterPercent: afterPercent,
              };
              type = code.substr(0, 4);
              usStockCount += 1;
            }
            if (stockItem) {
              const { yestclose, open } = stockItem;
              let { price } = stockItem;
              /*  if (open === price && price === '0.00') {
              stockItem.isStop = true;
            } */

              // 竞价阶段部分开盘和价格为0.00导致显示 -100%
              try {
                if (Number(open) <= 0 && Number(price) <= 0) {
                  price = yestclose;
                }
              } catch (err) {
                console.error(err);
              }
              stockItem.showLabel = this.showLabel;
              stockItem.isStock = true;
              stockItem.type = type;
              stockItem.symbol = symbol;
              stockItem.updown = formatNumber(+price - +yestclose, fixedNumber, false);
              stockItem.percent =
                (stockItem.updown >= 0 ? '+' : '-') +
                formatNumber((Math.abs(stockItem.updown) / +yestclose) * 100, 2, false);

              const treeItem = new LeekTreeItem(stockItem, this.context);
              stockList.push(treeItem);
            }
          } else {
            // 接口不支持的
            noDataStockCount += 1;
            stockItem = {
              code: code,
              name: `接口不支持该股票 ${code}`,
              showLabel: this.showLabel,
              isStock: true,
              percent: '',
              type: 'nodata',
              contextValue: 'nodata',
            };
            const treeItem = new LeekTreeItem(stockItem, this.context);
            stockList.push(treeItem);
          }
        }
      }
    } catch (err) {
      console.info(url);
      console.error(err);
      if (globalState.showStockErrorInfo) {
        window.showErrorMessage(`fail: Stock error ` + url);
        globalState.showStockErrorInfo = false;
        globalState.telemetry.sendEvent('error: stockService', {
          url,
          error: err,
        });
      }
    }

    globalState.aStockCount = aStockCount;
    globalState.usStockCount = usStockCount;
    globalState.noDataStockCount += noDataStockCount;
    return stockList;
  }

  async getHKStockData(codes: Array<string>): Promise<Array<LeekTreeItem>> {
    if ((codes && codes.length === 0) || !codes) {
      return [];
    }

    let hkStockCount = 0;
    let noDataStockCount = 0;
    let stockList: Array<LeekTreeItem> = [];

    try {
      const stockData = await getTencentHKStockData(codes);
      if (!stockData) {
        return [];
      } else {
        const stocks = stockData;
        stocks.forEach((item: any) => {
          if (item.name === 'NODATA') {
            noDataStockCount += 1;
            const stockItem = {
              code: item.code,
              name: `接口不支持该股票 ${item.code}`,
              showLabel: this.showLabel,
              isStock: true,
              percent: '',
              type: 'nodata',
              contextValue: 'nodata',
            };
            const treeItem = new LeekTreeItem(stockItem, this.context);
            stockList.push(treeItem);
            return;
          }
          const { open, yestclose, price, high, low, volume, amount, time } = item;
          const fixedNumber = calcFixedPriceNumber(open, yestclose, price, high, low);
          const stockItem: any = {
            ...item,
            open: formatNumber(open, fixedNumber, false),
            yestclose: formatNumber(yestclose, fixedNumber, false),
            price: formatNumber(price, fixedNumber, false),
            low: formatNumber(low, fixedNumber, false),
            high: formatNumber(high, fixedNumber, false),
            volume: formatNumber(volume || 0, 2),
            amount: formatNumber(amount || 0, 2),
            percent: '',
            time: `${moment(time).format('YYYY-MM-DD HH:mm:ss')}`,
          };
          hkStockCount += 1;
          if (stockItem) {
            const { yestclose, open } = stockItem;
            let { price } = stockItem;
            // 竞价阶段部分开盘和价格为0.00导致显示 -100%
            if (Number(open) <= 0 && Number(price) <= 0) {
              price = yestclose;
            }
            stockItem.showLabel = this.showLabel;
            stockItem.isStock = true;
            stockItem.type = 'hk';
            stockItem.symbol = stockItem.code.replace('hk', '');
            stockItem.contextValue = 'statusBarStockHidden';
            stockItem.updown = formatNumber(+price - +yestclose, fixedNumber, false);
            stockItem.percent =
              (stockItem.updown >= 0 ? '+' : '-') +
              formatNumber((Math.abs(stockItem.updown) / +yestclose) * 100, 2, false);

            const treeItem = new LeekTreeItem(stockItem, this.context);
            stockList.push(treeItem);
          }
        });
      }
    } catch (err) {
      console.info(codes);
      console.error(err);
      if (globalState.showStockErrorInfo) {
        window.showErrorMessage(`fail: HK Stock error ` + codes);
        globalState.showStockErrorInfo = false;
        globalState.telemetry.sendEvent('error: stockService', {
          codes,
          error: err,
        });
      }
    }

    globalState.hkStockCount = hkStockCount;
    globalState.noDataStockCount += noDataStockCount;
    return stockList;
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
      const stocks = await searchStockList(searchText);
      stocks.forEach((item: any) => {
        const { code, name, market } = item;
        const _code = `${market}${code}`;
        if (['sz', 'sh', 'bj'].includes(market)) {
          result.push({
            label: `${_code} | ${name}`,
            description: `A股`,
          });
        } else if (['hk'].includes(market)) {
          // 港股个股 || 港股指数
          result.push({
            label: `${_code} | ${name}`,
            description: `港股`,
          });
        } else if (['us'].includes(market)) {
          const codeSplit = _code.split('.');
          let usCode = codeSplit[0];
          if (codeSplit.length > 2) {
            // 有些美股代码会有多个点，如 BRK.B
            usCode = codeSplit.slice(0, codeSplit.length - 1).join('.');
          }
          result.push({
            label: `${usCode} | ${name}`,
            description: `美股`,
          });
        }
      });
      return result;
    } catch (err) {
      Log.info('searchStockList error: ', searchText);
      console.error(err);
      return [{ label: '股票查询失败，请重试' }];
    }
  }
}
