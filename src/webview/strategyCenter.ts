import { ViewColumn, window } from 'vscode';
import StockService from '../explorer/stockService';
import { LeekFundConfig } from '../shared/leekConfig';
import {
  buildStrategySnapshot,
  refreshRecommendedAStocks,
  saveHoldingStocks,
  saveStrategyAccountConfig,
} from '../shared/tradingStrategy';
import { SortType } from '../shared/typed';
import { getTemplateFileContent } from '../shared/utils';
import ReusedWebviewPanel from './ReusedWebviewPanel';

export class StrategyCenterView {
  private static instance: StrategyCenterView;
  private panel: any = null;
  private stockService: StockService | null = null;

  private constructor() {}

  public static getInstance(): StrategyCenterView {
    if (!StrategyCenterView.instance) {
      StrategyCenterView.instance = new StrategyCenterView();
    }
    return StrategyCenterView.instance;
  }

  public show(stockService: StockService): void {
    this.stockService = stockService;
    if (this.panel) {
      this.panel.reveal();
      this.postSnapshot();
      return;
    }

    this.panel = ReusedWebviewPanel.create('strategyCenterWebview', '策略中心', ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    this.panel.webview.html = getTemplateFileContent('strategy-center.html', this.panel.webview);

    this.panel.webview.onDidReceiveMessage(async (msg: any) => {
      try {
        switch (msg?.command) {
          case 'pageReady':
            await this.ensureStockSnapshot();
            this.postSnapshot();
            break;
          case 'saveHoldings':
            await saveHoldingStocks(Array.isArray(msg.data) ? msg.data : []);
            await this.ensureStockSnapshot(true);
            this.postSnapshot();
            break;
          case 'saveAccount':
            await saveStrategyAccountConfig(msg.data || {});
            this.postSnapshot();
            break;
          case 'runSelection':
            await this.ensureStockSnapshot();
            if (this.stockService) {
              await refreshRecommendedAStocks(this.stockService.stockList || [], 'manual');
            }
            this.postSnapshot();
            break;
          case 'alert':
            window.showWarningMessage(String(msg.message || '输入不完整'));
            break;
          default:
            break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        window.showWarningMessage(`策略中心操作失败：${message}`);
        this.panel?.webview.postMessage({
          command: 'operationFailed',
          message,
        });
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = null;
    });
  }

  private async ensureStockSnapshot(force = false): Promise<void> {
    if (!this.stockService) {
      return;
    }
    if (!force && this.stockService.stockList.length) {
      return;
    }
    const codes = LeekFundConfig.getConfig('leek-fund.stocks');
    if (Array.isArray(codes) && codes.length) {
      await this.stockService.getData(codes, SortType.NORMAL);
    }
  }

  private postSnapshot(): void {
    if (!this.panel || !this.stockService) {
      return;
    }
    this.panel.webview.postMessage({
      command: 'strategySnapshot',
      data: buildStrategySnapshot(this.stockService.stockList || []),
    });
  }
}

export default function strategyCenter(stockService: StockService): void {
  StrategyCenterView.getInstance().show(stockService);
}
