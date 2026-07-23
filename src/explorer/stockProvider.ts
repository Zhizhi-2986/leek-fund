import * as vscode from 'vscode';
import { Event, EventEmitter, TreeDataProvider, TreeItem, TreeItemCollapsibleState } from 'vscode';
import * as fs from 'fs';
import { flattenDeep } from 'lodash';
import globalState from '../globalState';
import { LeekTreeItem } from '../shared/leekTreeItem';
import { defaultMarketInfo, SortType, StockCategory, StockGroupConfig } from '../shared/typed';
import { LeekFundConfig } from '../shared/leekConfig';
import { getStockTreeHoldingCodeSet } from '../shared/stockHoldingState';
import { getStockTreeWatchCodes, moveStockTreeWatchCodes } from '../shared/stockWatchState';
import StockService from './stockService';

const STOCK_TREE_DRAG_MIME = 'application/vnd.code.tree.leekfundview.stock';
const LEEK_STOCK_TREE_DRAG_MIME = 'application/vnd.leek-fund.stock-tree';
const STOCK_TREE_DND_LOG_FILE = '/tmp/leek-fund-dnd.log';
const HOLDING_GROUP_PREFIX = '__holding__';
const HOLDING_GROUP_NAME = '持仓股';
const WATCH_GROUP_PREFIX = '__watch__';
const WATCH_GROUP_NAME = '关注';
const UNGROUPED_GROUP_PREFIX = '__ungrouped__';
const UNGROUPED_GROUP_NAME = '未分组';

type SupportedStockCategory = StockCategory.A | StockCategory.HK | StockCategory.US;

type StockTreeDragPayload =
  | {
      type: 'stock';
      ids: string[];
      sourceGroupId?: string;
    }
  | {
      type: 'group';
      ids: string[];
      category: SupportedStockCategory;
      parentGroupId?: string;
    };

export class StockProvider implements TreeDataProvider<LeekTreeItem> {
  private _onDidChangeTreeData: EventEmitter<any> = new EventEmitter<any>();

  readonly onDidChangeTreeData: Event<any> = this._onDidChangeTreeData.event;
  readonly dragMimeTypes = [STOCK_TREE_DRAG_MIME, LEEK_STOCK_TREE_DRAG_MIME];
  readonly dropMimeTypes = [STOCK_TREE_DRAG_MIME, LEEK_STOCK_TREE_DRAG_MIME];

  private service: StockService;
  private expandAStock: boolean;
  private collapsedStockGroupIds = new Set<string>();
  private stockCategoryExpandedState = new Map<SupportedStockCategory, boolean>();
  private expansionStateRevision = 0;

  constructor(service: StockService) {
    this.service = service;
    this.expandAStock = LeekFundConfig.getConfig('leek-fund.expandAStock', true);
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

  setTreeItemExpanded(element: LeekTreeItem, expanded: boolean): void {
    if (element.isStockGroup && element.stockGroupId) {
      this.setStockGroupExpandedState(element.stockGroupId, expanded);
      return;
    }
    const category = element.isCategory
      ? this.normalizeSupportedStockCategory(element.id)
      : undefined;
    if (category) {
      this.stockCategoryExpandedState.set(category, expanded);
    }
  }

  setAllStockGroupsExpanded(expanded: boolean): void {
    const categories: SupportedStockCategory[] = [StockCategory.A];
    categories.forEach((category) => {
      this.stockCategoryExpandedState.set(category, expanded);
      [
        this.getHoldingGroupId(category),
        this.getWatchGroupId(category),
        this.getUngroupedGroupId(category),
      ].forEach((groupId) => this.setStockGroupExpandedState(groupId, expanded));
    });
    LeekFundConfig.getStockGroups()
      .filter((group) => group.category === StockCategory.A)
      .forEach((group) => this.setStockGroupExpandedState(group.id, expanded));
    this.refreshExpansionState();
  }

  setChildStockGroupsExpanded(parentGroupId: string, expanded: boolean): boolean {
    const groups = LeekFundConfig.getStockGroups();
    const parentGroup = groups.find((group) => group.id === parentGroupId);
    if (!parentGroup || parentGroup.parentId) return false;

    this.setStockGroupExpandedState(parentGroup.id, expanded);
    groups
      .filter((group) => group.parentId === parentGroup.id)
      .forEach((group) => this.setStockGroupExpandedState(group.id, expanded));
    this.refreshExpansionState();
    return true;
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
    const customGroups = source.filter((item) => this.isCustomStockGroupItem(item));
    if (source.length > 0 && customGroups.length === source.length) {
      const category = this.normalizeSupportedStockCategory(customGroups[0].stockGroupCategory);
      const parentGroupId = customGroups[0].stockGroupParentId;
      if (
        category &&
        customGroups.every(
          (item) =>
            this.normalizeSupportedStockCategory(item.stockGroupCategory) === category &&
            item.stockGroupParentId === parentGroupId
        )
      ) {
        dataTransfer.set(
          LEEK_STOCK_TREE_DRAG_MIME,
          new (vscode as any).DataTransferItem({
            type: 'group',
            ids: customGroups.map((item) => String(item.stockGroupId)),
            category,
            parentGroupId,
          })
        );
        this.reportDragAndDropEvent(
          `drag group ids=${customGroups
            .map((item) => item.stockGroupId)
            .join(',')} category=${category}`
        );
      }
      return;
    }

    const stockItems = source.filter((item) => this.isSortableStockItem(item));
    const stockIds = stockItems.map((item) => String(item.info?.code || item.id));
    if (!stockIds.length) return;
    dataTransfer.set(
      LEEK_STOCK_TREE_DRAG_MIME,
      new (vscode as any).DataTransferItem({
        type: 'stock',
        ids: stockIds,
        sourceGroupId: this.getCommonStockGroupId(stockItems),
      })
    );
    this.reportDragAndDropEvent(`drag stock ids=${stockIds.join(',')}`);
  }

  async handleDrop(target: LeekTreeItem | undefined, dataTransfer: any): Promise<void> {
    this.reportDragAndDropEvent(
      `drop target=${this.describeDropTarget(target)} mimes=${this.describeDataTransferMimeTypes(
        dataTransfer
      )}`
    );
    if (!target) return;
    const transferItem =
      dataTransfer.get(LEEK_STOCK_TREE_DRAG_MIME) || dataTransfer.get(STOCK_TREE_DRAG_MIME);
    if (!transferItem) {
      this.reportDragAndDropEvent('drop ignored: no supported transfer item');
      return;
    }

    const payload = await this.readDraggedPayload(transferItem);
    if (!payload || !payload.ids.length) {
      this.reportDragAndDropEvent('drop ignored: payload empty');
      return;
    }
    this.reportDragAndDropEvent(`drop payload type=${payload.type} ids=${payload.ids.join(',')}`);

    if (payload.type === 'group') {
      await this.handleGroupDrop(target, payload.ids, payload.category, payload.parentGroupId);
    } else {
      await this.handleStockDrop(target, payload.ids, payload.sourceGroupId);
    }
  }

  private async handleStockDrop(
    target: LeekTreeItem,
    draggedStockIds: string[],
    sourceGroupId?: string
  ): Promise<void> {
    const currentConfig = flattenDeep(
      LeekFundConfig.getConfig('leek-fund.stocks') || []
    ) as string[];
    const draggedIdSet = new Set(draggedStockIds);
    const movingIds = currentConfig.filter((code) => draggedIdSet.has(code));
    if (!movingIds.length) return;

    const targetCategory = this.getDropTargetCategory(target);
    if (!this.isSupportedStockCategory(targetCategory)) return;
    if (movingIds.some((code) => this.getStockCategoryByCode(code) !== targetCategory)) {
      vscode.window.showWarningMessage('只能在同一市场分类内拖动股票。');
      return;
    }

    const targetStockId =
      !target.isCategory && !target.isStockGroup
        ? String(target.info?.code || target.id || '')
        : '';
    const targetGroupId = target.stockGroupId;
    if (sourceGroupId && this.isWatchGroupId(sourceGroupId)) {
      if (targetGroupId !== sourceGroupId) {
        vscode.window.showInformationMessage('关注列表中的股票只能在当前关注列表内调整顺序。');
        return;
      }
      await moveStockTreeWatchCodes(movingIds, targetStockId || undefined);
      this.refresh();
      return;
    }
    if (
      targetGroupId &&
      (this.isHoldingGroupId(targetGroupId) || this.isWatchGroupId(targetGroupId))
    ) {
      vscode.window.showInformationMessage(
        '请通过股票右键的”切换持仓状态”或”切换关注状态”标记或取消标记。'
      );
      return;
    }
    if (targetGroupId && !this.isUngroupedGroupId(targetGroupId)) {
      await this.moveStocksToCustomGroup(movingIds, targetGroupId, targetStockId);
    } else {
      await this.moveStocksToUngrouped(movingIds, targetCategory, targetStockId);
    }
    this.refresh();
  }

  private async handleGroupDrop(
    target: LeekTreeItem,
    draggedGroupIds: string[],
    sourceCategory: SupportedStockCategory,
    sourceParentGroupId?: string
  ): Promise<void> {
    const targetCategory = this.getGroupDropTargetCategory(target);
    if (!targetCategory) {
      this.reportDragAndDropEvent(
        `group drop ignored: no target category raw=${String(
          target.stockGroupCategory
        )} id=${String(target.stockGroupId || target.id || '')}`
      );
      vscode.window.showWarningMessage('请将自定义分组拖动到同一市场分类或自定义分组上。');
      return;
    }
    if (targetCategory !== sourceCategory) {
      this.reportDragAndDropEvent(
        `group drop ignored: cross category target=${targetCategory} source=${sourceCategory}`
      );
      vscode.window.showWarningMessage('只能在同一市场分类内拖动分组。');
      return;
    }
    if (target.isStockGroup && target.contextValue !== 'stockGroup') {
      if (target.contextValue !== 'stockSubGroup') {
        this.reportDragAndDropEvent('group drop ignored: builtin group target');
        vscode.window.showInformationMessage('内置分组固定展示，不参与拖拽排序。');
        return;
      }
    }

    const groups = LeekFundConfig.getStockGroups();
    const targetParentGroupId = this.getGroupDropTargetParentId(
      target,
      groups,
      sourceParentGroupId
    );
    if (targetParentGroupId !== sourceParentGroupId) {
      this.reportDragAndDropEvent('group drop ignored: parent group mismatch');
      vscode.window.showWarningMessage('只能在同一父级的分组之间调整顺序。');
      return;
    }
    const draggedGroupIdSet = new Set(draggedGroupIds);
    const movingGroups = groups.filter((group) => draggedGroupIdSet.has(group.id));
    if (!movingGroups.length) {
      this.reportDragAndDropEvent(
        `group drop ignored: no moving groups ids=${draggedGroupIds.join(',')}`
      );
      return;
    }
    if (
      movingGroups.some(
        (group) => group.category !== sourceCategory || group.parentId !== sourceParentGroupId
      )
    ) {
      this.reportDragAndDropEvent('group drop ignored: moving group category mismatch');
      vscode.window.showWarningMessage('只能在同一市场分类内拖动分组。');
      return;
    }

    const categoryGroups = groups.filter(
      (group) => group.category === sourceCategory && group.parentId === sourceParentGroupId
    );
    const remainingCategoryGroups = categoryGroups.filter(
      (group) => !draggedGroupIdSet.has(group.id)
    );
    const targetIndex = this.getGroupDropInsertIndex(
      target,
      categoryGroups,
      remainingCategoryGroups,
      draggedGroupIdSet,
      sourceParentGroupId
    );
    if (targetIndex < 0) {
      this.reportDragAndDropEvent('group drop ignored: invalid insert target');
      return;
    }

    const nextCategoryGroups = [
      ...remainingCategoryGroups.slice(0, targetIndex),
      ...movingGroups,
      ...remainingCategoryGroups.slice(targetIndex),
    ];

    let categoryIndex = 0;
    const nextGroups = groups.map((group) => {
      if (group.category !== sourceCategory || group.parentId !== sourceParentGroupId) {
        return group;
      }
      const nextGroup = nextCategoryGroups[categoryIndex];
      categoryIndex += 1;
      return nextGroup;
    });

    if (JSON.stringify(groups) === JSON.stringify(nextGroups)) {
      this.reportDragAndDropEvent('group drop ignored: order unchanged');
      vscode.window.showInformationMessage('分组顺序未变化。');
      return;
    }
    await LeekFundConfig.setStockGroups(nextGroups);
    this.reportDragAndDropEvent(
      `group drop updated category=${sourceCategory} insertIndex=${targetIndex} ids=${draggedGroupIds.join(
        ','
      )}`
    );
    vscode.window.showInformationMessage('股票分组顺序已更新。');
    this.refresh();
  }

  getTreeItem(element: LeekTreeItem): TreeItem {
    if (element.isStockGroup) {
      const stocks = this.getStockGroupSummaryStocks(element);
      const upCount = stocks.filter((item) => Number(item.info.percent) > 0).length;
      const downCount = stocks.filter((item) => Number(item.info.percent) < 0).length;
      const childGroupCount = element.stockGroupId
        ? this.getChildGroups(element.stockGroupId).length
        : 0;
      const groupId = String(element.stockGroupId || element.id);
      const isChildGroup = Boolean(element.stockGroupParentId);
      let collapsibleState: TreeItemCollapsibleState;
      if (!stocks.length && !childGroupCount) {
        collapsibleState = TreeItemCollapsibleState.Collapsed;
      } else if (isChildGroup) {
        collapsibleState = TreeItemCollapsibleState.Collapsed;
      } else {
        collapsibleState = this.collapsedStockGroupIds.has(groupId)
          ? TreeItemCollapsibleState.Collapsed
          : TreeItemCollapsibleState.Expanded;
      }
      return {
        id: this.getExpandableTreeItemId(element),
        label: element.info.name,
        description: `涨${upCount} 跌${downCount}`,
        collapsibleState,
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
      const desc = upCount + downCount > 0 ? `涨${upCount} 跌${downCount}` : undefined;
      const category = this.normalizeSupportedStockCategory(element.id);
      const configuredExpanded = element.id === StockCategory.A && this.expandAStock;
      const expanded = category
        ? this.stockCategoryExpandedState.get(category) ?? configuredExpanded
        : configuredExpanded;

      return {
        id: this.getExpandableTreeItemId(element),
        label: element.info.name,
        description: desc,
        collapsibleState: expanded
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
      default:
        return [];
    }
  }

  getRootNodes(): LeekTreeItem[] {
    const nodes = [
      new LeekTreeItem(
        Object.assign({ contextValue: 'stockCategory' }, defaultMarketInfo, {
          id: StockCategory.A,
          name: `${StockCategory.A}${
            globalState.aStockCount + globalState.etfStockCount > 0
              ? `(${globalState.aStockCount + globalState.etfStockCount})`
              : ''
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
        this.createWatchGroupNode(category),
        this.createUngroupedGroupNode(category),
        ...this.getGroupsByCategory(category)
          .filter((group) => !group.parentId)
          .map((group) => this.createStockGroupNode(group)),
      ];
    });
  }

  getStockGroupNodes(
    stocks: Promise<LeekTreeItem[]>,
    groupNode: LeekTreeItem
  ): Promise<LeekTreeItem[]> {
    return stocks.then((res: LeekTreeItem[]) => {
      const stockNodes = this.assignStockGroup(
        this.getStockGroupStocks(groupNode, res),
        groupNode.stockGroupId,
        groupNode.stockGroupCategory
      );
      if (!groupNode.stockGroupId || groupNode.stockGroupParentId) {
        return stockNodes;
      }
      const childGroupNodes = this.getChildGroups(groupNode.stockGroupId).map((group) =>
        this.createStockGroupNode(group)
      );
      return [...childGroupNodes, ...stockNodes];
    });
  }

  getNoDataStockNodes(stocks: Promise<LeekTreeItem[]>): Promise<LeekTreeItem[]> {
    return stocks.then((res: LeekTreeItem[]) => {
      return res.filter((item: LeekTreeItem) => {
        return /^(nodata)/.test(item.type || '');
      });
    });
  }

  private createStockGroupNode(group: StockGroupConfig): LeekTreeItem {
    return new LeekTreeItem(
      Object.assign(
        { contextValue: group.parentId ? 'stockSubGroup' : 'stockGroup' },
        defaultMarketInfo,
        {
          id: group.id,
          name: group.name,
        }
      ),
      undefined,
      true,
      {
        isStockGroup: true,
        stockGroupId: group.id,
        stockGroupCategory: group.category,
        stockGroupParentId: group.parentId,
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

  private createWatchGroupNode(
    category: StockCategory.A | StockCategory.HK | StockCategory.US
  ): LeekTreeItem {
    const id = this.getWatchGroupId(category);
    return new LeekTreeItem(
      Object.assign({ contextValue: 'stockGroupBuiltin' }, defaultMarketInfo, {
        id,
        name: WATCH_GROUP_NAME,
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

  private getStockGroupStocks(
    groupNode: LeekTreeItem,
    stocks = this.service.stockList
  ): LeekTreeItem[] {
    const category = groupNode.stockGroupCategory;
    if (!this.isSupportedStockCategory(category)) {
      return [];
    }
    if (groupNode.stockGroupId && this.isHoldingGroupId(groupNode.stockGroupId)) {
      return this.getHoldingStocks(stocks, category);
    }
    if (groupNode.stockGroupId && this.isWatchGroupId(groupNode.stockGroupId)) {
      return this.getWatchStocks(stocks, category);
    }
    if (groupNode.stockGroupId && this.isUngroupedGroupId(groupNode.stockGroupId)) {
      return this.getUngroupedStocks(stocks, category);
    }

    const group = LeekFundConfig.getStockGroups().find(
      (item) => item.id === groupNode.stockGroupId
    );
    if (!group) {
      return [];
    }
    const stockMap = new Map(stocks.map((stock) => [stock.info.code, stock]));
    return group.stockCodes
      .map((code) => stockMap.get(code))
      .filter((stock: LeekTreeItem | undefined): stock is LeekTreeItem => Boolean(stock));
  }

  private getStockGroupSummaryStocks(
    groupNode: LeekTreeItem,
    stocks = this.service.stockList
  ): LeekTreeItem[] {
    const directStocks = this.getStockGroupStocks(groupNode, stocks);
    if (!groupNode.stockGroupId || groupNode.stockGroupParentId) {
      return directStocks;
    }
    const childStockCodes = this.getChildGroups(groupNode.stockGroupId).reduce((codes, group) => {
      codes.push(...group.stockCodes);
      return codes;
    }, [] as string[]);
    if (!childStockCodes.length) {
      return directStocks;
    }
    const allCodes = new Set([...directStocks.map((stock) => stock.info.code), ...childStockCodes]);
    return stocks.filter((stock) => allCodes.has(stock.info.code));
  }

  private getHoldingStocks(
    stocks: LeekTreeItem[],
    category: StockCategory.A | StockCategory.HK | StockCategory.US
  ): LeekTreeItem[] {
    const holdingCodes = this.getHoldingCodeSet(category);
    return stocks.filter(
      (stock) =>
        this.getStockCategoryByCode(stock.info.code) === category &&
        holdingCodes.has(stock.info.code)
    );
  }

  private getWatchStocks(
    stocks: LeekTreeItem[],
    category: StockCategory.A | StockCategory.HK | StockCategory.US
  ): LeekTreeItem[] {
    const stockMap = new Map(stocks.map((stock) => [stock.info.code, stock]));
    return getStockTreeWatchCodes()
      .filter((code) => this.getStockCategoryByCode(code) === category)
      .map((code) => stockMap.get(code))
      .filter((stock: LeekTreeItem | undefined): stock is LeekTreeItem => Boolean(stock));
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

  private getChildGroups(parentGroupId: string): StockGroupConfig[] {
    return LeekFundConfig.getStockGroups().filter((group) => group.parentId === parentGroupId);
  }

  private getGroupedCodeSet(
    category: StockCategory.A | StockCategory.HK | StockCategory.US
  ): Set<string> {
    const codes = this.getGroupsByCategory(category).reduce((result, group) => {
      result.push(...group.stockCodes);
      return result;
    }, [] as string[]);
    return new Set(codes);
  }

  private getHoldingCodeSet(
    category: StockCategory.A | StockCategory.HK | StockCategory.US
  ): Set<string> {
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
    return stocks.map((stock) => {
      const groupStock = new LeekTreeItem(stock.info, globalState.context, false, {
        stockGroupId,
        stockGroupCategory,
      });
      groupStock.id = `${stockGroupId || 'stock'}:${stock.info.code}`;
      groupStock.contextValue = stock.contextValue;
      return groupStock;
    });
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
    const currentConfig = flattenDeep(
      LeekFundConfig.getConfig('leek-fund.stocks') || []
    ) as string[];
    const remainingConfig = currentConfig.filter((code) => !movingSet.has(code));
    const targetIndex = targetStockId ? remainingConfig.indexOf(targetStockId) : -1;
    const insertIndex =
      targetIndex >= 0 ? targetIndex : this.findCategoryTailIndex(remainingConfig, category);
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
    return (
      !item.isCategory && !item.isStockGroup && item.contextValue !== 'nodata' && Boolean(item.id)
    );
  }

  private isCustomStockGroupItem(item: LeekTreeItem): boolean {
    return (
      item.isStockGroup &&
      (item.contextValue === 'stockGroup' || item.contextValue === 'stockSubGroup') &&
      Boolean(item.stockGroupId)
    );
  }

  private setStockGroupExpandedState(groupId: string, expanded: boolean): void {
    if (expanded) {
      this.collapsedStockGroupIds.delete(groupId);
    } else {
      this.collapsedStockGroupIds.add(groupId);
    }
  }

  private refreshExpansionState(): void {
    this.expansionStateRevision += 1;
    this.refresh();
  }

  private getExpandableTreeItemId(element: LeekTreeItem): string {
    const logicalId = String(element.stockGroupId || element.info?.id || element.id || '');
    return `${logicalId}:expansion-${this.expansionStateRevision}`;
  }

  private reportDragAndDropEvent(message: string): void {
    const text = `LeekFund DnD: ${message}`;
    vscode.window.setStatusBarMessage(text, 2000);
    console.log(text);
    try {
      fs.appendFileSync(STOCK_TREE_DND_LOG_FILE, `${new Date().toISOString()} ${text}\n`);
    } catch (err) {
      console.warn('LeekFund DnD log write failed', err);
    }
  }

  private describeDropTarget(target: LeekTreeItem | undefined): string {
    if (!target) return 'root';
    if (target.isStockGroup) {
      return `group:${target.stockGroupId || target.id}:${target.contextValue}:${
        target.stockGroupCategory
      }`;
    }
    if (target.isCategory) {
      return `category:${target.id}`;
    }
    return `stock:${target.id}`;
  }

  private describeDataTransferMimeTypes(dataTransfer: any): string {
    try {
      return Array.from(dataTransfer || [])
        .map((entry: any) => String(entry?.[0] || ''))
        .filter(Boolean)
        .join(',');
    } catch (err) {
      return 'unknown';
    }
  }

  private async readDraggedPayload(item: any): Promise<StockTreeDragPayload | undefined> {
    const valuePayload = this.parseDraggedPayload(item?.value);
    if (valuePayload) {
      return valuePayload;
    }

    if (typeof item?.asString === 'function') {
      const raw = await item.asString();
      return this.parseDraggedPayload(raw);
    }

    return this.parseDraggedPayload(item?.value);
  }

  private parseDraggedPayload(raw: unknown): StockTreeDragPayload | undefined {
    try {
      if (Array.isArray(raw)) {
        return this.parseDraggedTreeItems(raw);
      }

      const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (value && value.type === 'stock' && Array.isArray(value.ids)) {
        return {
          type: value.type,
          ids: value.ids.filter((item: any) => typeof item === 'string' && item),
          sourceGroupId:
            typeof value.sourceGroupId === 'string' && value.sourceGroupId
              ? value.sourceGroupId
              : undefined,
        };
      }
      if (
        value &&
        value.type === 'group' &&
        Array.isArray(value.ids) &&
        this.isSupportedStockCategory(value.category)
      ) {
        const category = this.normalizeSupportedStockCategory(value.category);
        if (!category) {
          return undefined;
        }
        return {
          type: value.type,
          ids: value.ids.filter((item: any) => typeof item === 'string' && item),
          category,
          parentGroupId:
            typeof value.parentGroupId === 'string' && value.parentGroupId
              ? value.parentGroupId
              : undefined,
        };
      }
      return undefined;
    } catch (err) {
      return undefined;
    }
  }

  private parseDraggedTreeItems(source: LeekTreeItem[]): StockTreeDragPayload | undefined {
    const customGroups = source.filter((item) => this.isCustomStockGroupItem(item));
    if (source.length > 0 && customGroups.length === source.length) {
      const category = this.normalizeSupportedStockCategory(customGroups[0].stockGroupCategory);
      const parentGroupId = customGroups[0].stockGroupParentId;
      if (
        category &&
        customGroups.every(
          (item) =>
            this.normalizeSupportedStockCategory(item.stockGroupCategory) === category &&
            item.stockGroupParentId === parentGroupId
        )
      ) {
        return {
          type: 'group',
          ids: customGroups.map((item) => String(item.stockGroupId)),
          category,
          parentGroupId,
        };
      }
    }

    const stockItems = source.filter((item) => this.isSortableStockItem(item));
    const stockIds = stockItems.map((item) => String(item.info?.code || item.id));
    if (!stockIds.length) {
      return undefined;
    }
    return {
      type: 'stock',
      ids: stockIds,
      sourceGroupId: this.getCommonStockGroupId(stockItems),
    };
  }

  private getCommonStockGroupId(stocks: LeekTreeItem[]): string | undefined {
    const groupIds = new Set(stocks.map((stock) => String(stock.stockGroupId || '')));
    if (groupIds.size !== 1) {
      return undefined;
    }
    const groupId = [...groupIds][0];
    return groupId || undefined;
  }

  private getDropTargetCategory(target: LeekTreeItem): SupportedStockCategory | undefined {
    if (target.isStockGroup) {
      return this.isSupportedStockCategory(target.stockGroupCategory)
        ? target.stockGroupCategory
        : undefined;
    }
    if (target.isCategory) {
      const category = this.getCategoryById(String(target.id || ''));
      return this.isSupportedStockCategory(category) ? category : undefined;
    }
    const category = this.getStockCategoryByCode(String(target.info?.code || target.id || ''));
    return this.isSupportedStockCategory(category) ? category : undefined;
  }

  private getCategoryById(id: string): StockCategory | undefined {
    return [StockCategory.A, StockCategory.HK, StockCategory.US].find(
      (category) => category === id
    );
  }

  private getGroupDropTargetCategory(target: LeekTreeItem): SupportedStockCategory | undefined {
    if (target.isStockGroup) {
      const groupCategory = this.getCategoryByStockGroupId(target.stockGroupId || target.id);
      if (groupCategory) {
        return groupCategory;
      }
      const category = this.normalizeSupportedStockCategory(target.stockGroupCategory);
      if (category) {
        return category;
      }
      return undefined;
    }
    if (target.isCategory) {
      return this.normalizeSupportedStockCategory(target.id);
    }
    const category = this.getStockCategoryByCode(String(target.info?.code || target.id || ''));
    return this.normalizeSupportedStockCategory(category);
  }

  private getGroupDropInsertIndex(
    target: LeekTreeItem,
    categoryGroups: StockGroupConfig[],
    remainingGroups: StockGroupConfig[],
    draggedGroupIdSet: Set<string>,
    sourceParentGroupId?: string
  ): number {
    if (
      (target.isCategory && !target.isStockGroup) ||
      (sourceParentGroupId && target.stockGroupId === sourceParentGroupId)
    ) {
      return remainingGroups.length;
    }
    const targetGroupId = this.getGroupDropTargetGroupId(target, categoryGroups);
    if (!targetGroupId || draggedGroupIdSet.has(targetGroupId)) {
      return -1;
    }
    const remainingTargetIndex = remainingGroups.findIndex((group) => group.id === targetGroupId);
    if (remainingTargetIndex < 0) {
      return -1;
    }
    const originalMovingIndex = categoryGroups.findIndex((group) =>
      draggedGroupIdSet.has(group.id)
    );
    const originalTargetIndex = categoryGroups.findIndex((group) => group.id === targetGroupId);
    if (originalMovingIndex < 0 || originalTargetIndex < 0) {
      return -1;
    }
    return originalMovingIndex < originalTargetIndex
      ? remainingTargetIndex + 1
      : remainingTargetIndex;
  }

  private getGroupDropTargetGroupId(
    target: LeekTreeItem,
    categoryGroups: StockGroupConfig[]
  ): string | undefined {
    if (target.stockGroupId) {
      return categoryGroups.some((group) => group.id === target.stockGroupId)
        ? target.stockGroupId
        : undefined;
    }
    if (target.isCategory || target.isStockGroup) {
      return undefined;
    }
    const targetStockId = String(target.info?.code || target.id || '');
    return categoryGroups.find((group) => group.stockCodes.includes(targetStockId))?.id;
  }

  private getGroupDropTargetParentId(
    target: LeekTreeItem,
    groups: StockGroupConfig[],
    sourceParentGroupId?: string
  ): string | undefined {
    const targetGroupId = target.stockGroupId;
    if (targetGroupId) {
      if (sourceParentGroupId && targetGroupId === sourceParentGroupId) {
        return sourceParentGroupId;
      }
      const targetGroup = groups.find((group) => group.id === targetGroupId);
      return targetGroup?.parentId;
    }
    if (target.isCategory) {
      return undefined;
    }
    return undefined;
  }

  private getStockCategoryByCode(code: string): StockCategory | undefined {
    if (/^(sh|sz|bj)/.test(code)) return StockCategory.A;
    if (/^(hk)/.test(code)) return StockCategory.HK;
    if (/^(usr_)/.test(code)) return StockCategory.US;
    return undefined;
  }

  private isSupportedStockCategory(category: unknown): category is SupportedStockCategory {
    return Boolean(this.normalizeSupportedStockCategory(category));
  }

  private normalizeSupportedStockCategory(category: unknown): SupportedStockCategory | undefined {
    const value = String(category || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (value === StockCategory.A) {
      return StockCategory.A;
    }
    if (value === StockCategory.HK) {
      return StockCategory.HK;
    }
    if (value === StockCategory.US) {
      return StockCategory.US;
    }
    return undefined;
  }

  private getCategoryByStockGroupId(groupId: unknown): SupportedStockCategory | undefined {
    const id = String(groupId || '').trim();
    if (!id) {
      return undefined;
    }
    const group = LeekFundConfig.getStockGroups().find((item) => item.id === id);
    return this.normalizeSupportedStockCategory(group?.category);
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

  private getWatchGroupId(category: StockCategory): string {
    return `${WATCH_GROUP_PREFIX}${category}`;
  }

  private isWatchGroupId(groupId: string): boolean {
    return groupId.startsWith(WATCH_GROUP_PREFIX);
  }

  private findCategoryTailIndex(config: string[], category: StockCategory): number {
    const lastIndex = config.reduce((last, code, index) => {
      return this.getStockCategoryByCode(code) === category ? index : last;
    }, -1);
    return lastIndex < 0 ? config.length : lastIndex + 1;
  }
}
