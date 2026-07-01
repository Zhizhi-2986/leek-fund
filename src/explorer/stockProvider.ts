import * as vscode from 'vscode';
import { Event, EventEmitter, TreeDataProvider, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { flattenDeep } from 'lodash';
import globalState from '../globalState';
import { LeekTreeItem } from '../shared/leekTreeItem';
import { defaultMarketInfo, SortType, StockCategory, StockGroupConfig } from '../shared/typed';
import { LeekFundConfig } from '../shared/leekConfig';
import { getStockTreeHoldingCodeSet } from '../shared/stockHoldingState';
import StockService from './stockService';

const STOCK_TREE_DRAG_MIME = 'application/vnd.code.tree.leekfundview.stock';
const HOLDING_GROUP_PREFIX = '__holding__';
const HOLDING_GROUP_NAME = '持仓股';
const UNGROUPED_GROUP_PREFIX = '__ungrouped__';
const UNGROUPED_GROUP_NAME = '未分组';

type StockTreeDragPayload = {
  type: 'stock';
  ids: string[];
};

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

  refreshStatusBarContext(): void {
    this.service.syncStatusBarContext();
    this.service.stockList.forEach((stock) => {
      this._onDidChangeTreeData.fire(stock);
    });
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
      if (element.isStockGroup) {
        return this.getStockGroupNodes(resultPromise, element);
      }
      switch (
        element.id // First-level
      ) {
        case StockCategory.A:
          return this.getMarketNodes(resultPromise, StockCategory.A);
        case StockCategory.ETF:
          return this.getEtfNodes(resultPromise);
        case StockCategory.HK:
          return this.getMarketNodes(resultPromise, StockCategory.HK);
        case StockCategory.US:
          return this.getMarketNodes(resultPromise, StockCategory.US);
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
      new (vscode as any).DataTransferItem(JSON.stringify({ type: 'stock', ids: stockIds }))
    );
  }

  async handleDrop(target: LeekTreeItem | undefined, dataTransfer: any): Promise<void> {
    if (!target) return;
    const transferItem = dataTransfer.get(STOCK_TREE_DRAG_MIME);
    if (!transferItem) return;

    const raw = await this.readDataTransferItem(transferItem);
    const payload = this.parseDraggedPayload(raw);
    if (!payload || !payload.ids.length) return;

    await this.handleStockDrop(target, payload.ids);
  }

  private async handleStockDrop(target: LeekTreeItem, draggedStockIds: string[]): Promise<void> {
    const currentConfig = flattenDeep(LeekFundConfig.getConfig('leek-fund.stocks') || []) as string[];
    const draggedIdSet = new Set(draggedStockIds);
    const movingIds = currentConfig.filter((code) => draggedIdSet.has(code));
    if (!movingIds.length) return;

    const targetCategory = this.getDropTargetCategory(target);
    if (!this.isSupportedStockCategory(targetCategory)) return;
    if (movingIds.some((code) => this.getStockCategoryByCode(code) !== targetCategory)) {
      vscode.window.showWarningMessage('只能在同一市场分类内拖动股票。');
      return;
    }

    const targetStockId = !target.isCategory && !target.isStockGroup ? String(target.id || '') : '';
    const targetGroupId = target.stockGroupId;
    if (targetGroupId && this.isHoldingGroupId(targetGroupId)) {
      vscode.window.showInformationMessage('请通过股票右键的“切换持仓状态”标记或取消持仓。');
      return;
    }
    if (targetGroupId && !this.isUngroupedGroupId(targetGroupId)) {
      await this.moveStocksToCustomGroup(movingIds, targetGroupId, targetStockId);
    } else {
      await this.moveStocksToUngrouped(movingIds, targetCategory, targetStockId);
    }
    this.refresh();
  }

  getTreeItem(element: LeekTreeItem): TreeItem {
    if (element.isStockGroup) {
      const stocks = this.getStockGroupStocks(element);
      return {
        id: element.id,
        label: element.info.name,
        description: `${stocks.length}只`,
        collapsibleState: stocks.length
          ? TreeItemCollapsibleState.Expanded
          : TreeItemCollapsibleState.Collapsed,
        command: undefined,
        contextValue: element.contextValue,
      };
    }
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
          id: StockCategory.ETF,
          name: `${StockCategory.ETF}${
            globalState.etfStockCount > 0 ? `(${globalState.etfStockCount})` : ''
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
  getMarketNodes(
    stocks: Promise<LeekTreeItem[]>,
    category: StockCategory.A | StockCategory.HK | StockCategory.US
  ): Promise<LeekTreeItem[]> {
    return stocks.then(() => {
      return [
        this.createHoldingGroupNode(category),
        this.createUngroupedGroupNode(category),
        ...this.getGroupsByCategory(category).map((group) => this.createStockGroupNode(group)),
      ];
    });
  }

  getStockGroupNodes(
    stocks: Promise<LeekTreeItem[]>,
    groupNode: LeekTreeItem
  ): Promise<LeekTreeItem[]> {
    return stocks.then((res: LeekTreeItem[]) => {
      return this.assignStockGroup(
        this.getStockGroupStocks(groupNode, res),
        groupNode.stockGroupId,
        groupNode.stockGroupCategory
      );
    });
  }

  getNoDataStockNodes(stocks: Promise<LeekTreeItem[]>): Promise<LeekTreeItem[]> {
    return stocks.then((res: LeekTreeItem[]) => {
      return res.filter((item: LeekTreeItem) => {
        return /^(nodata)/.test(item.type || '');
      });
    });
  }

  getEtfNodes(stocks: Promise<LeekTreeItem[]>): Promise<LeekTreeItem[]> {
    return stocks.then((res: LeekTreeItem[]) => {
      return res.filter((item: LeekTreeItem) => {
        return this.isEtfCode(item.info.code);
      });
    });
  }

  private isEtfCode(code: string): boolean {
    // ETF: sh5xxxxx, sz1xxxxxx, sz5xxxxxx
    return /^(sh5|sz1|sz5)/.test(code);
  }

  private createStockGroupNode(group: StockGroupConfig): LeekTreeItem {
    return new LeekTreeItem(
      Object.assign({ contextValue: 'stockGroup' }, defaultMarketInfo, {
        id: group.id,
        name: group.name,
      }),
      undefined,
      true,
      {
        isStockGroup: true,
        stockGroupId: group.id,
        stockGroupCategory: group.category,
      }
    );
  }

  private createUngroupedGroupNode(
    category: StockCategory.A | StockCategory.HK | StockCategory.US
  ): LeekTreeItem {
    const id = this.getUngroupedGroupId(category);
    return new LeekTreeItem(
      Object.assign({ contextValue: 'stockGroupBuiltin' }, defaultMarketInfo, {
        id,
        name: UNGROUPED_GROUP_NAME,
      }),
      undefined,
      true,
      {
        isStockGroup: true,
        stockGroupId: id,
        stockGroupCategory: category,
      }
    );
  }

  private createHoldingGroupNode(
    category: StockCategory.A | StockCategory.HK | StockCategory.US
  ): LeekTreeItem {
    const id = this.getHoldingGroupId(category);
    return new LeekTreeItem(
      Object.assign({ contextValue: 'stockGroupBuiltin' }, defaultMarketInfo, {
        id,
        name: HOLDING_GROUP_NAME,
      }),
      undefined,
      true,
      {
        isStockGroup: true,
        stockGroupId: id,
        stockGroupCategory: category,
      }
    );
  }

  private getStockGroupStocks(groupNode: LeekTreeItem, stocks = this.service.stockList): LeekTreeItem[] {
    const category = groupNode.stockGroupCategory;
    if (!this.isSupportedStockCategory(category)) {
      return [];
    }
    if (groupNode.stockGroupId && this.isHoldingGroupId(groupNode.stockGroupId)) {
      return this.getHoldingStocks(stocks, category);
    }
    if (groupNode.stockGroupId && this.isUngroupedGroupId(groupNode.stockGroupId)) {
      return this.getUngroupedStocks(stocks, category);
    }

    const group = LeekFundConfig.getStockGroups().find((item) => item.id === groupNode.stockGroupId);
    if (!group) {
      return [];
    }
    const stockMap = new Map(stocks.map((stock) => [stock.info.code, stock]));
    return group.stockCodes
      .map((code) => stockMap.get(code))
      .filter((stock: LeekTreeItem | undefined): stock is LeekTreeItem => Boolean(stock));
  }

  private getHoldingStocks(
    stocks: LeekTreeItem[],
    category: StockCategory.A | StockCategory.HK | StockCategory.US
  ): LeekTreeItem[] {
    const holdingCodes = this.getHoldingCodeSet(category);
    return stocks.filter(
      (stock) =>
        this.getStockCategoryByCode(stock.info.code) === category && holdingCodes.has(stock.info.code)
    );
  }

  private getUngroupedStocks(
    stocks: LeekTreeItem[],
    category: StockCategory.A | StockCategory.HK | StockCategory.US
  ): LeekTreeItem[] {
    const groupedCodes = this.getGroupedCodeSet(category);
    return stocks.filter(
      (stock) =>
        this.getStockCategoryByCode(stock.info.code) === category &&
        !groupedCodes.has(stock.info.code)
    );
  }

  private getGroupsByCategory(
    category: StockCategory.A | StockCategory.HK | StockCategory.US
  ): StockGroupConfig[] {
    return LeekFundConfig.getStockGroups().filter((group) => group.category === category);
  }

  private getGroupedCodeSet(category: StockCategory.A | StockCategory.HK | StockCategory.US): Set<string> {
    const codes = this.getGroupsByCategory(category).reduce((result, group) => {
      result.push(...group.stockCodes);
      return result;
    }, [] as string[]);
    return new Set(codes);
  }

  private getHoldingCodeSet(category: StockCategory.A | StockCategory.HK | StockCategory.US): Set<string> {
    const holdingCodes = [...getStockTreeHoldingCodeSet()].filter(
      (code) => this.getStockCategoryByCode(code) === category
    );
    return new Set(holdingCodes);
  }

  private assignStockGroup(
    stocks: LeekTreeItem[],
    stockGroupId: string | undefined,
    stockGroupCategory: StockCategory | undefined
  ): LeekTreeItem[] {
    stocks.forEach((stock) => {
      stock.stockGroupId = stockGroupId;
      stock.stockGroupCategory = stockGroupCategory;
    });
    return stocks;
  }

  private async moveStocksToCustomGroup(
    movingIds: string[],
    targetGroupId: string,
    targetStockId: string
  ): Promise<void> {
    const movingSet = new Set(movingIds);
    const groups = LeekFundConfig.getStockGroups();
    const nextGroups = groups.map((group) => {
      const withoutMoving = group.stockCodes.filter((code) => !movingSet.has(code));
      if (group.id !== targetGroupId) {
        return {
          ...group,
          stockCodes: withoutMoving,
        };
      }
      const targetIndex = targetStockId ? withoutMoving.indexOf(targetStockId) : -1;
      const insertIndex = targetIndex >= 0 ? targetIndex : withoutMoving.length;
      return {
        ...group,
        stockCodes: [
          ...withoutMoving.slice(0, insertIndex),
          ...movingIds,
          ...withoutMoving.slice(insertIndex),
        ],
      };
    });
    if (JSON.stringify(groups) === JSON.stringify(nextGroups)) return;
    await LeekFundConfig.setStockGroups(nextGroups);
  }

  private async moveStocksToUngrouped(
    movingIds: string[],
    category: StockCategory.A | StockCategory.HK | StockCategory.US,
    targetStockId: string
  ): Promise<void> {
    const movingSet = new Set(movingIds);
    const currentConfig = flattenDeep(LeekFundConfig.getConfig('leek-fund.stocks') || []) as string[];
    const remainingConfig = currentConfig.filter((code) => !movingSet.has(code));
    const targetIndex = targetStockId ? remainingConfig.indexOf(targetStockId) : -1;
    const insertIndex = targetIndex >= 0 ? targetIndex : this.findCategoryTailIndex(remainingConfig, category);
    const nextConfig = [
      ...remainingConfig.slice(0, insertIndex),
      ...movingIds,
      ...remainingConfig.slice(insertIndex),
    ];
    const groups = LeekFundConfig.getStockGroups();
    const nextGroups = groups.map((group) => ({
      ...group,
      stockCodes: group.stockCodes.filter((code) => !movingSet.has(code)),
    }));
    const configChanged = nextConfig.join(',') !== currentConfig.join(',');
    const groupsChanged = JSON.stringify(groups) !== JSON.stringify(nextGroups);
    if (configChanged) {
      await LeekFundConfig.setConfig('leek-fund.stocks', nextConfig);
    }
    if (groupsChanged) {
      await LeekFundConfig.setStockGroups(nextGroups);
    }
  }

  private isSortableStockItem(item: LeekTreeItem): boolean {
    return !item.isCategory && !item.isStockGroup && item.contextValue !== 'nodata' && Boolean(item.id);
  }

  private async readDataTransferItem(item: any): Promise<string> {
    if (typeof item.asString === 'function') {
      return item.asString();
    }
    return String(item.value || '');
  }

  private parseDraggedPayload(raw: string): StockTreeDragPayload | undefined {
    try {
      const value = JSON.parse(raw);
      if (!value || value.type !== 'stock' || !Array.isArray(value.ids)) {
        return undefined;
      }
      return {
        type: value.type,
        ids: value.ids.filter((item: any) => typeof item === 'string' && item),
      };
    } catch (err) {
      return undefined;
    }
  }

  private getDropTargetCategory(
    target: LeekTreeItem
  ): StockCategory.A | StockCategory.HK | StockCategory.US | undefined {
    if (target.isStockGroup) {
      return this.isSupportedStockCategory(target.stockGroupCategory)
        ? target.stockGroupCategory
        : undefined;
    }
    if (target.isCategory) {
      const category = this.getCategoryById(String(target.id || ''));
      return this.isSupportedStockCategory(category) ? category : undefined;
    }
    const category = this.getStockCategoryByCode(String(target.id || ''));
    return this.isSupportedStockCategory(category) ? category : undefined;
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

  private isSupportedStockCategory(
    category: StockCategory | undefined
  ): category is StockCategory.A | StockCategory.HK | StockCategory.US {
    return category === StockCategory.A || category === StockCategory.HK || category === StockCategory.US;
  }

  private getUngroupedGroupId(category: StockCategory): string {
    return `${UNGROUPED_GROUP_PREFIX}${category}`;
  }

  private isUngroupedGroupId(groupId: string): boolean {
    return groupId.startsWith(UNGROUPED_GROUP_PREFIX);
  }

  private getHoldingGroupId(category: StockCategory): string {
    return `${HOLDING_GROUP_PREFIX}${category}`;
  }

  private isHoldingGroupId(groupId: string): boolean {
    return groupId.startsWith(HOLDING_GROUP_PREFIX);
  }

  private findCategoryTailIndex(config: string[], category: StockCategory): number {
    const lastIndex = config.reduce((last, code, index) => {
      return this.getStockCategoryByCode(code) === category ? index : last;
    }, -1);
    return lastIndex < 0 ? config.length : lastIndex + 1;
  }

}
