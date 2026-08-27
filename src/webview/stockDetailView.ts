import { ViewColumn, window } from 'vscode';
import StockService from '../explorer/stockService';
import { LeekFundConfig } from '../shared/leekConfig';
import { getAStockDetailData, getMarketOverview } from '../shared/stockDetailData';
import { SortType } from '../shared/typed';
import { getTemplateFileContent } from '../shared/utils';
import ReusedWebviewPanel from './ReusedWebviewPanel';

export class StockDetailView {
  private static instance: StockDetailView;
  private panel: any = null;
  private stockService: StockService | null = null;
  private pendingInitialCode = '';

  private constructor() {}

  public static getInstance(): StockDetailView {
    if (!StockDetailView.instance) {
      StockDetailView.instance = new StockDetailView();
    }
    return StockDetailView.instance;
  }

  public show(stockService: StockService, selectedCode = ''): void {
    this.stockService = stockService;
    this.pendingInitialCode = normalizeCode(selectedCode);

    if (this.panel) {
      this.panel.reveal();
      this.postStockList();
      return;
    }

    this.panel = ReusedWebviewPanel.create('stockDetailWebview', '股票详情', ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    this.panel.webview.html = getTemplateFileContent('stock-detail.html', this.panel.webview);

    this.panel.webview.onDidReceiveMessage(async (msg: any) => {
      try {
        switch (msg?.command) {
          case 'pageReady':
            await this.ensureStockSnapshot();
            this.postStockList();
            break;
          case 'getStockDetail':
            await this.postStockDetail(String(msg.code || ''), Number(msg.requestId || 0));
            break;
          case 'getMarketOverview':
            await this.postMarketOverview();
            break;
          default:
            break;
        }
      } catch (err) {
        this.panel?.webview.postMessage({
          command: 'stockDetailError',
          requestId: Number(msg?.requestId || 0),
          code: normalizeCode(msg?.code || ''),
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = null;
      this.pendingInitialCode = '';
    });
  }

  private async ensureStockSnapshot(): Promise<void> {
    if (!this.stockService) {
      return;
    }
    if (this.stockService.stockList.length) {
      return;
    }

    const codes = LeekFundConfig.getConfig('leek-fund.stocks');
    if (Array.isArray(codes) && codes.length) {
      await this.stockService.getData(codes, SortType.NORMAL);
    }
  }

  private postStockList(): void {
    if (!this.panel || !this.stockService) {
      return;
    }

    const stockList = (this.stockService.stockList || [])
      .filter((item) => /^(sh|sz|bj)\d{6}$/.test(item.info.code || '') && item.info.type !== 'nodata')
      .map((item) => ({
        id: item.info.code,
        info: item.info,
      }));

    // 如果当前选中的是指数但不在 stockList 中，也加入列表
    const hasPendingCode = this.pendingInitialCode &&
      /^(sh|sz|bj)\d{6}$/.test(this.pendingInitialCode) &&
      !stockList.some((s) => s.id === this.pendingInitialCode);
    if (hasPendingCode) {
      const stockItem = this.stockService.stockList.find(
        (item) => item.info.code === this.pendingInitialCode
      );
      if (stockItem) {
        stockList.unshift({
          id: stockItem.info.code,
          info: stockItem.info,
        });
      }
    }

    this.panel.webview.postMessage({
      command: 'stockListReady',
      data: {
        stockList,
        selectedCode: this.pendingInitialCode,
      },
    });
    this.pendingInitialCode = '';
  }

  private async postStockDetail(code: string, requestId: number): Promise<void> {
    const normalizedCode = normalizeCode(code);
    if (!/^(sh|sz|bj)\d{6}$/.test(normalizedCode)) {
      throw new Error(`仅支持 A 股（含指数）详情：${code}`);
    }

    const detail = await getAStockDetailData(normalizedCode);
    this.panel?.webview.postMessage({
      command: 'stockDetailReady',
      requestId,
      code: normalizedCode,
      data: detail,
    });
  }

  private async postMarketOverview(): Promise<void> {
    const overview = await getMarketOverview();
    this.panel?.webview.postMessage({
      command: 'marketOverviewReady',
      data: overview,
    });
  }
}

export default function stockDetailView(stockService: StockService, selectedCode = ''): void {
  StockDetailView.getInstance().show(stockService, selectedCode);
}

function normalizeCode(code: string): string {
  return String(code || '').trim().toLowerCase();
}
