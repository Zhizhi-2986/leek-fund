import * as vscode from 'vscode';
import { Event, EventEmitter, TreeDataProvider, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { flattenDeep } from 'lodash';
import globalState from '../globalState';
import { LeekTreeItem } from '../shared/leekTreeItem';
import { defaultMarketInfo, SortType, StockCategory } from '../shared/typed';
import { LeekFundConfig } from '../shared/leekConfig';
import StockService from './stockService';

const STOCK_TREE_DRAG_MIME = 'application/vnd.code.tree.leekFundView.stock';

export class StockProvider implements TreeDataProvider<LeekTreeItem> {
  private _onDidChangeTreeData: EventEmitter<any> = new EventEmitter<any>();

  readonly onDidChangeTreeData: Event<any> = this._onDidChangeTreeData.event;
  readonly dragMimeTypes = [STOCK_TREE_DRAG_MIME];
  readonly dropMimeTypes = [STOCK_TREE_DRAG_MIME];

  private service: StockService;
  private expandAStock: boolean;
  private expandHKStock: boolean;
  private expandUSStock: boolean;

  constructor(service: StockService) {
    this.service = service;
    this.expandAStock = LeekFundConfig.getConfig('leek-fund.expandAStock', true);
    this.expandHKStock = LeekFundConfig.getConfig('leek-fund.expandHKStock', false);
    this.expandUSStock = LeekFundConfig.getConfig('leek-fund.expandUSStock', false);
  }

  refresh(): any {
    this._onDidChangeTreeData.fire(undefined);
  }

  getChildren(element?: LeekTreeItem | undefined): LeekTreeItem[] | Thenable<LeekTreeItem[]> {
    if (!element) {
      // Root view
      const stockCodes = LeekFundConfig.getConfig('leek-fund.stocks') || [];
      // const stockList: string[] = uniq(compact(flattenDeep(stockCodes)));
      return this.service.getData(stockCodes, SortType.NORMAL).then(() => {
        return this.getRootNodes();
      });
    } else {
      const resultPromise = Promise.resolve(this.service.stockList || []);
      switch (
        element.id // First-level
      ) {
        case StockCategory.A:
          return this.getAStockNodes(resultPromise);
        case StockCategory.HK:
          return this.getHkStockNodes(resultPromise);
        case StockCategory.US:
          return this.getUsStockNodes(resultPromise);
        case StockCategory.NODATA:
          return this.getNoDataStockNodes(resultPromise);
        default:
          return [];
        // return this.getChildrenNodesById(element.id);
      }
    }
  }

  getParent(): LeekTreeItem | undefined {
    return undefined;
  }

  async handleDrag(source: LeekTreeItem[], dataTransfer: any): Promise<void> {
    const stockIds = source
      .filter((item) => this.isSortableStockItem(item))
      .map((item) => String(item.id));
    if (!stockIds.length) return;

    dataTransfer.set(
      STOCK_TREE_DRAG_MIME,
      new (vscode as any).DataTransferItem(JSON.stringify(stockIds))
    );
  }

  async handleDrop(target: LeekTreeItem | undefined, dataTransfer: any): Promise<void> {
    if (!target) return;
    const transferItem = dataTransfer.get(STOCK_TREE_DRAG_MIME);
    if (!transferItem) return;

    const raw = await this.readDataTransferItem(transferItem);
    const draggedIds = this.parseDraggedStockIds(raw);
    if (!draggedIds.length) return;

    const currentConfig = flattenDeep(LeekFundConfig.getConfig('leek-fund.stocks') || []) as string[];
    const draggedIdSet = new Set(draggedIds);
    const movingIds = currentConfig.filter((code) => draggedIdSet.has(code));
    if (!movingIds.length) return;

    const targetCategory = target.isCategory
      ? this.getCategoryById(String(target.id || ''))
      : this.getStockCategoryByCode(String(target.id || ''));
    if (!targetCategory || movingIds.some((code) => this.getStockCategoryByCode(code) !== targetCategory)) {
      vscode.window.showWarningMessage('只能在同一市场分类内拖动排序。');
      return;
    }

    const remainingConfig = currentConfig.filter((code) => !draggedIdSet.has(code));
    let insertIndex = remainingConfig.length;
    if (target.isCategory) {
      insertIndex = this.findCategoryTailIndex(remainingConfig, targetCategory);
    } else {
      const targetIndex = remainingConfig.indexOf(String(target.id));
      if (targetIndex < 0) return;
      insertIndex = targetIndex;
    }

    const nextConfig = [
      ...remainingConfig.slice(0, insertIndex),
      ...movingIds,
      ...remainingConfig.slice(insertIndex),
    ];
    if (nextConfig.join(',') === currentConfig.join(',')) return;

    await LeekFundConfig.setConfig('leek-fund.stocks', nextConfig);
    this.refresh();
  }

  getTreeItem(element: LeekTreeItem): TreeItem {
    if (!element.isCategory) {
      return element;
    } else {
      // 计算该类别下的涨跌统计
      const stocks = this.getCategoryStocks(element.id || '');
      const upCount = stocks.filter(
        (item) => item.info.percent !== undefined && item.info.percent > 0
      ).length;
      const downCount = stocks.filter(
        (item) => item.info.percent !== undefined && item.info.percent < 0
      ).length;
      const desc =
        upCount + downCount > 0 ? `涨${upCount} 跌${downCount}` : undefined;

      return {
        id: element.id,
        label: element.info.name,
        description: desc,
        collapsibleState:
          (element.id === StockCategory.A && this.expandAStock) ||
          (element.id === StockCategory.HK && this.expandHKStock) ||
          (element.id === StockCategory.US && this.expandUSStock)
            ? TreeItemCollapsibleState.Expanded
            : TreeItemCollapsibleState.Collapsed,
        command: undefined,
        contextValue: element.contextValue,
      };
    }
  }

  private getCategoryStocks(categoryId: string): LeekTreeItem[] {
    const stocks = this.service.stockList || [];
    switch (categoryId) {
      case StockCategory.A:
        return stocks.filter((item) => /^(sh|sz|bj)/.test(item.type || ''));
      case StockCategory.HK:
        return stocks.filter((item) => /^(hk)/.test(item.type || ''));
      case StockCategory.US:
        return stocks.filter((item) => /^(usr_)/.test(item.type || ''));
      default:
        return [];
    }
  }

  getRootNodes(): LeekTreeItem[] {
    const nodes = [
      new LeekTreeItem(
        Object.assign({ contextValue: 'category' }, defaultMarketInfo, {
          id: StockCategory.A,
          name: `${StockCategory.A}${
            globalState.aStockCount > 0 ? `(${globalState.aStockCount})` : ''
          }`,
        }),
        undefined,
        true
      ),
      new LeekTreeItem(
        Object.assign({ contextValue: 'category' }, defaultMarketInfo, {
          id: StockCategory.HK,
          name: `${StockCategory.HK}${
            globalState.hkStockCount > 0 ? `(${globalState.hkStockCount})` : ''
          }`,
        }),
        undefined,
        true
      ),
      new LeekTreeItem(
        Object.assign({ contextValue: 'category' }, defaultMarketInfo, {
          id: StockCategory.US,
          name: `${StockCategory.US}${
            globalState.usStockCount > 0 ? `(${globalState.usStockCount})` : ''
          }`,
        }),
        undefined,
        true
      ),
    ];
    // 显示接口不支持的股票，避免用户老问为什么添加了股票没反应
    if (globalState.noDataStockCount) {
      nodes.push(
        new LeekTreeItem(
          Object.assign({ contextValue: 'category' }, defaultMarketInfo, {
            id: StockCategory.NODATA,
            name: `${StockCategory.NODATA}(${globalState.noDataStockCount})`,
          }),
          undefined,
          true
        )
      );
    }
    return nodes;
  }
  getAStockNodes(stocks: Promise<LeekTreeItem[]>): Promise<LeekTreeItem[]> {
    const aStocks: Promise<LeekTreeItem[]> = stocks.then((res: LeekTreeItem[]) => {
      const arr = res.filter((item: LeekTreeItem) => /^(sh|sz|bj)/.test(item.type || ''));
      return arr;
    });

    return aStocks;
  }
  getHkStockNodes(stocks: Promise<LeekTreeItem[]>): Promise<LeekTreeItem[]> {
    return stocks.then((res: LeekTreeItem[]) =>
      res.filter((item: LeekTreeItem) => /^(hk)/.test(item.type || ''))
    );
  }
  getUsStockNodes(stocks: Promise<LeekTreeItem[]>): Promise<LeekTreeItem[]> {
    return stocks.then((res: LeekTreeItem[]) =>
      res.filter((item: LeekTreeItem) => /^(usr_)/.test(item.type || ''))
    );
  }
  getNoDataStockNodes(stocks: Promise<LeekTreeItem[]>): Promise<LeekTreeItem[]> {
    return stocks.then((res: LeekTreeItem[]) => {
      return res.filter((item: LeekTreeItem) => {
        return /^(nodata)/.test(item.type || '');
      });
    });
  }

  private isSortableStockItem(item: LeekTreeItem): boolean {
    return !item.isCategory && item.contextValue !== 'nodata' && Boolean(item.id);
  }

  private async readDataTransferItem(item: any): Promise<string> {
    if (typeof item.asString === 'function') {
      return item.asString();
    }
    return String(item.value || '');
  }

  private parseDraggedStockIds(raw: string): string[] {
    try {
      const value = JSON.parse(raw);
      return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
    } catch (err) {
      return [];
    }
  }

  private getCategoryById(id: string): StockCategory | undefined {
    return [StockCategory.A, StockCategory.HK, StockCategory.US].find((category) => category === id);
  }

  private getStockCategoryByCode(code: string): StockCategory | undefined {
    if (/^(sh|sz|bj)/.test(code)) return StockCategory.A;
    if (/^(hk)/.test(code)) return StockCategory.HK;
    if (/^(usr_)/.test(code)) return StockCategory.US;
    return undefined;
  }

  private findCategoryTailIndex(config: string[], category: StockCategory): number {
    const lastIndex = config.reduce((last, code, index) => {
      return this.getStockCategoryByCode(code) === category ? index : last;
    }, -1);
    return lastIndex < 0 ? config.length : lastIndex + 1;
  }
}
