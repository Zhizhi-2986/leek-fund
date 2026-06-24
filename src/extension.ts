/*--------------------------------------------------------------
 *  Copyright (c) Nicky<giscafer@outlook.com>. All rights reserved.
 *  Licensed under the BSD-3-Clause License.
 *  Github: https://github.com/giscafer
 *-------------------------------------------------------------*/

import { ConfigurationChangeEvent, ExtensionContext, TreeView, window, workspace } from 'vscode';
import { StockProvider } from './explorer/stockProvider';
import StockService from './explorer/stockService';
import globalState, { reloadFromConfig } from './globalState';
import { registerCommandPaletteEvent, registerViewEvent } from './registerCommand';
import { HolidayHelper } from './shared/holidayHelper';
import { LeekFundConfig } from './shared/leekConfig';
import Log from './shared/log';
import { Telemetry } from './shared/telemetry';
import { SortType } from './shared/typed';
import { events, isStockTime } from './shared/utils';
import { StatusBar } from './statusbar/statusBar';
import { cacheStocksRemindData } from './shared/stocksRemindConfig';
import { startStrategyScheduler, stopStrategyScheduler } from './shared/strategyScheduler';

let loopTimer: NodeJS.Timeout | null = null;
let stockTreeView: TreeView<any> | null = null;

export async function activate(context: ExtensionContext) {
  globalState.isDevelopment = process.env.NODE_ENV === 'development';
  globalState.context = context;

  const telemetry = new Telemetry();
  globalState.telemetry = telemetry;

  let intervalTimeConfig = LeekFundConfig.getConfig('leek-fund.interval', 5000);
  let intervalTime = intervalTimeConfig;

  // 节假日，异步会存在延迟判断准确问题，设置成同步影响插件激活速度，暂使用异步
  HolidayHelper.isHolidayInChina().then((isHoliday) => {
    globalState.isHolidayChina = isHoliday;
  });

  setGlobalVariable();

  const stockService = new StockService(context);
  startStrategyScheduler(stockService);

  const nodeStockProvider = new StockProvider(stockService);

  const statusBar = new StatusBar(stockService);

  stockTreeView = window.createTreeView('leekFundView.stock', {
    treeDataProvider: nodeStockProvider,
    dragAndDropController: nodeStockProvider,
  } as any);

  // fix when TreeView collapse https://github.com/giscafer/leek-fund/issues/31
  const manualRequest = () => {
    stockService.getData(LeekFundConfig.getConfig('leek-fund.stocks'), SortType.NORMAL);
  };

  manualRequest();

  // loop
  const loopCallback = () => {
    if (isStockTime()) {
      // 重置定时器
      if (intervalTime !== intervalTimeConfig) {
        intervalTime = intervalTimeConfig;
        setIntervalTime();
        return;
      }

      if (stockTreeView?.visible) {
        nodeStockProvider.refresh();
        // statusBar.refresh();
      } else {
        manualRequest();
      }
    } else {
      Log.info('StockMarket Closed! Polling closed!');
      // 闭市时增加轮询间隔时长
      if (intervalTime === intervalTimeConfig) {
        intervalTime = intervalTimeConfig * 100;
        setIntervalTime();
      }
    }
  };

  const setIntervalTime = () => {
    // prevent qps
    if (intervalTime < 3000) {
      intervalTime = 3000;
    }
    if (loopTimer) {
      clearInterval(loopTimer);
      loopTimer = null;
    }

    loopTimer = setInterval(loopCallback, intervalTime);
  };

  setIntervalTime();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  workspace.onDidChangeConfiguration((e: ConfigurationChangeEvent) => {
    Log.info('Configuration changed');
    const statusBarStockChanged = e.affectsConfiguration('leek-fund.statusBarStock');
    const stockBarVisibilityChanged = e.affectsConfiguration('leek-fund.hideStatusBarStock');
    const stockConfigChanged = e.affectsConfiguration('leek-fund.stocks');
    const statusBarSelectionChanged = statusBarStockChanged || stockBarVisibilityChanged;
    const indexStatusBarChanged =
      e.affectsConfiguration('leek-fund.hideStatusBar') ||
      e.affectsConfiguration('leek-fund.hideStatusBarIcon') ||
      e.affectsConfiguration('leek-fund.riseColor') ||
      e.affectsConfiguration('leek-fund.fallColor');

    intervalTimeConfig = LeekFundConfig.getConfig('leek-fund.interval');
    setIntervalTime();
    setGlobalVariable();
    if (statusBarStockChanged) {
      nodeStockProvider.refreshStatusBarContext();
    }
    if (statusBarSelectionChanged && !indexStatusBarChanged) {
      statusBar.refreshStockStatusBar();
    } else {
      statusBar.refresh();
    }
    if (!statusBarSelectionChanged || stockConfigChanged) {
      nodeStockProvider.refresh();
    }
    events.emit('onDidChangeConfiguration');
  });

  // register event
  registerViewEvent(
    context,
    stockService,
    nodeStockProvider
  );

  // register command
  registerCommandPaletteEvent(context, statusBar);

  // Telemetry Event
  telemetry.sendEvent('activate');
}

function setGlobalVariable() {
  reloadFromConfig();
  cacheStocksRemindData(globalState.stocksRemind);
}

// this method is called when your extension is deactivated
export function deactivate() {
  Log.info('deactivate');
  stopStrategyScheduler();
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
}
