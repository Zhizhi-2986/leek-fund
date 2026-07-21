import { commands, ExtensionContext, window, Uri, workspace } from 'vscode';
import * as os from 'os';
import * as path from 'path';

/**
 * 获取设置文件的默认路径
 * 优先选择当前工作区目录，如果没有工作区则选择下载目录
 */
function getDefaultSettingsPath(filename: string = 'leek-fund.settings.json'): string {
  const workspaceFolders = workspace.workspaceFolders;

  if (workspaceFolders && workspaceFolders.length > 0) {
    // 使用当前工作区目录
    return path.join(workspaceFolders[0].uri.fsPath, filename);
  } else {
    // 使用下载目录作为备选
    return path.join(os.homedir(), 'Downloads', filename);
  }
}
import { StockProvider } from './explorer/stockProvider';
import StockService from './explorer/stockService';
import globalState from './globalState';
import { LeekFundConfig } from './shared/leekConfig';
import { LeekTreeItem } from './shared/leekTreeItem';
import { isStockTreeHolding, setStockTreeHolding } from './shared/stockHoldingState';
import { isStockTreeWatch, setStockTreeWatch } from './shared/stockWatchState';
import { StockCategory } from './shared/typed';
import { colorOptionList, randomColor } from './shared/utils';

import { StatusBar } from './statusbar/statusBar';
import stockDetailView from './webview/stockDetailView';
import strategyCenter from './webview/strategyCenter';

function getTargetStockCode(target: LeekTreeItem | undefined): string | undefined {
  if (target?.isCategory || target?.isStockGroup) {
    window.showWarningMessage('请从股票列表中选择股票。');
    return undefined;
  }
  const code = target?.info?.code;
  if (!code) {
    window.showWarningMessage('请从股票列表中选择股票。');
  }
  return code;
}

function isMarketStockCategory(
  category: StockCategory | undefined
): category is StockCategory.A | StockCategory.HK | StockCategory.US {
  return (
    category === StockCategory.A || category === StockCategory.HK || category === StockCategory.US
  );
}

function getStockCategoryFromTarget(
  target: LeekTreeItem | undefined
): StockCategory.A | StockCategory.HK | StockCategory.US | undefined {
  if (!target) return undefined;
  if (target.isStockGroup && isMarketStockCategory(target.stockGroupCategory)) {
    return target.stockGroupCategory;
  }
  if (target.isCategory && isMarketStockCategory(target.id as StockCategory)) {
    return target.id as StockCategory.A | StockCategory.HK | StockCategory.US;
  }
  const code = target.info?.code || String(target.id || '');
  if (/^(sh|sz|bj)/.test(code)) return StockCategory.A;
  if (/^(hk)/.test(code)) return StockCategory.HK;
  if (/^(usr_)/.test(code)) return StockCategory.US;
  return undefined;
}

type StockGroupMoveDirection = 'up' | 'down' | 'top' | 'bottom';

function getTargetStockGroupId(target: LeekTreeItem | undefined): string | undefined {
  const isCustomGroup =
    target?.contextValue === 'stockGroup' || target?.contextValue === 'stockSubGroup';
  if (!target?.isStockGroup || !isCustomGroup || !target.stockGroupId) {
    window.showWarningMessage('请从自定义分组上执行该操作。');
    return undefined;
  }
  return target.stockGroupId;
}

export function registerViewEvent(
  context: ExtensionContext,
  stockService: StockService,
  stockProvider: StockProvider
) {
  // Stock operation
  context.subscriptions.push(
    commands.registerCommand('leek-fund.refreshStock', () => {
      stockProvider.refresh();
      const handler = window.setStatusBarMessage(`股票数据已刷新`);
      setTimeout(() => {
        handler.dispose();
      }, 1000);
    })
  );
  context.subscriptions.push(
    commands.registerCommand('leek-fund.deleteStock', (target) => {
      const code = getTargetStockCode(target);
      if (!code) return;
      LeekFundConfig.removeStockCfg(code, () => {
        stockProvider.refresh();
      });
    })
  );
  context.subscriptions.push(
    commands.registerCommand('leek-fund.showStockInStatusBar', (target) => {
      const code = getTargetStockCode(target);
      if (!code) return;
      LeekFundConfig.setStatusBarStockVisibleCfg(code, true);
    })
  );
  context.subscriptions.push(
    commands.registerCommand('leek-fund.hideStockFromStatusBar', (target) => {
      const code = getTargetStockCode(target);
      if (!code) return;
      LeekFundConfig.setStatusBarStockVisibleCfg(code, false);
    })
  );
  context.subscriptions.push(
    commands.registerCommand('leek-fund.toggleHoldingStock', async (target) => {
      const code = getTargetStockCode(target);
      if (!code) return;
      const nextHolding = !isStockTreeHolding(code);
      try {
        await setStockTreeHolding(code, nextHolding);
        window.showInformationMessage(nextHolding ? '已标记为持仓股。' : '已取消持仓标记。');
        stockProvider.refresh();
      } catch (err) {
        window.showWarningMessage(err instanceof Error ? err.message : '持仓状态更新失败。');
      }
    })
  );
  context.subscriptions.push(
    commands.registerCommand('leek-fund.toggleWatchStock', async (target) => {
      const code = getTargetStockCode(target);
      if (!code) return;
      const nextWatch = !isStockTreeWatch(code);
      try {
        await setStockTreeWatch(code, nextWatch);
        window.showInformationMessage(nextWatch ? '已标记为关注。' : '已取消关注标记。');
        stockProvider.refresh();
      } catch (err) {
        window.showWarningMessage(err instanceof Error ? err.message : '关注状态更新失败。');
      }
    })
  );
  context.subscriptions.push(
    commands.registerCommand('leek-fund.addStock', () => {
      // vscode QuickPick 不支持动态查询，只能用此方式解决
      // https://github.com/microsoft/vscode/issues/23633
      const qp = window.createQuickPick();
      qp.items = [{ label: '请输入关键词查询，如：000001 或 上证指数' }];
      let code: string | undefined;
      let timer: NodeJS.Timeout | null = null;
      qp.onDidChangeValue((value) => {
        qp.busy = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        timer = setTimeout(async () => {
          const res = await stockService.getStockSuggestList(value);
          qp.items = res;
          qp.busy = false;
        }, 100); // 简单防抖
      });
      qp.onDidChangeSelection((e) => {
        if (e[0].description) {
          code = e[0].label && e[0].label.split(' | ')[0];
        }
      });
      qp.show();
      qp.onDidAccept(() => {
        if (!code) {
          return;
        }
        // 存储到配置的时候是接口的参数格式，接口请求时不需要再转换
        const newCode = code.replace('gb', 'gb_').replace('us', 'usr_');
        LeekFundConfig.updateStockCfg(newCode, () => {
          stockProvider.refresh();
        });
        qp.hide();
        qp.dispose();
      });
    })
  );
  context.subscriptions.push(
    commands.registerCommand('leek-fund.createStockGroup', async () => {
      const category = StockCategory.A;
      const groups = LeekFundConfig.getStockGroups();
      const name = await window.showInputBox({
        prompt: '输入股票分组名称',
        placeHolder: '例如：短线观察',
        validateInput: (value) => {
          const trimmed = value.trim();
          if (!trimmed) return '分组名称不能为空';
          if (
            groups.some(
              (group) =>
                group.category === category && !group.parentId && group.name === trimmed
            )
          ) {
            return '同一市场分类下分组名称不能重复';
          }
          return undefined;
        },
      });
      if (!name) return;
      LeekFundConfig.createStockGroup(name, category, () => {
        stockProvider.refresh();
      });
    })
  );
  context.subscriptions.push(
    commands.registerCommand('leek-fund.createStockSubGroup', async (target?: LeekTreeItem) => {
      const parentGroupId = getTargetStockGroupId(target);
      if (!parentGroupId) return;
      const groups = LeekFundConfig.getStockGroups();
      const parentGroup = groups.find((group) => group.id === parentGroupId);
      if (!parentGroup || parentGroup.parentId) {
        window.showWarningMessage('二级分组只能创建在一级分组下。');
        return;
      }
      const name = await window.showInputBox({
        prompt: `在「${parentGroup.name}」下创建二级分组`,
        placeHolder: '例如：重点跟踪',
        validateInput: (value) => {
          const trimmed = value.trim();
          if (!trimmed) return '二级分组名称不能为空';
          if (
            groups.some(
              (group) => group.parentId === parentGroup.id && group.name === trimmed
            )
          ) {
            return '同一一级分组下二级分组名称不能重复';
          }
          return undefined;
        },
      });
      if (!name) return;
      LeekFundConfig.createStockGroup(
        name,
        parentGroup.category,
        () => stockProvider.refresh(),
        parentGroup.id
      );
    })
  );
  context.subscriptions.push(
    commands.registerCommand('leek-fund.expandAllStockGroups', () => {
      stockProvider.setAllStockGroupsExpanded(true);
    })
  );
  context.subscriptions.push(
    commands.registerCommand('leek-fund.collapseAllStockGroups', () => {
      stockProvider.setAllStockGroupsExpanded(false);
    })
  );
  const registerChildGroupExpansionCommand = (command: string, expanded: boolean) => {
    context.subscriptions.push(
      commands.registerCommand(command, (target?: LeekTreeItem) => {
        const groupId = getTargetStockGroupId(target);
        if (!groupId) return;
        if (!stockProvider.setChildStockGroupsExpanded(groupId, expanded)) {
          window.showWarningMessage('请从一级自定义分组上执行该操作。');
        }
      })
    );
  };
  registerChildGroupExpansionCommand('leek-fund.expandStockSubGroups', true);
  registerChildGroupExpansionCommand('leek-fund.collapseStockSubGroups', false);
  context.subscriptions.push(
    commands.registerCommand('leek-fund.selectStockGroup', async (target?: LeekTreeItem) => {
      const code = getTargetStockCode(target);
      if (!code) return;
      const category = getStockCategoryFromTarget(target);
      if (!category) {
        window.showWarningMessage('仅支持 A 股、港股、美股选择分组。');
        return;
      }

      const groups = LeekFundConfig.getStockGroups().filter((group) => group.category === category);
      if (!groups.length) {
        window.showWarningMessage('当前市场暂无自定义分组，请先创建分组。');
        return;
      }

      const currentGroup = groups.find((group) => group.stockCodes.includes(code));
      const topLevelGroups = groups.filter((group) => !group.parentId);
      const groupOptions = topLevelGroups.flatMap((parentGroup) => [
        {
          label: parentGroup.name,
          description:
            parentGroup.id === currentGroup?.id
              ? '当前分组 · 一级分组'
              : `一级分组 · ${parentGroup.stockCodes.length}只`,
          stockGroupId: parentGroup.id as string | undefined,
        },
        ...groups
          .filter((group) => group.parentId === parentGroup.id)
          .map((group) => ({
            label: `${parentGroup.name} / ${group.name}`,
            description:
              group.id === currentGroup?.id
                ? '当前分组 · 二级分组'
                : `二级分组 · ${group.stockCodes.length}只`,
            stockGroupId: group.id as string | undefined,
          })),
      ]);
      const selected = await window.showQuickPick(
        [
          {
            label: '未分组',
            description: currentGroup ? '移出自定义分组' : '当前分组',
            stockGroupId: undefined as string | undefined,
          },
          ...groupOptions,
        ],
        {
          placeHolder: '选择股票所属分组',
        }
      );
      if (!selected) return;

      LeekFundConfig.setStockGroupForStock(code, selected.stockGroupId, () => {
        stockProvider.refresh();
      });
    })
  );
  const registerStockGroupMoveCommand = (command: string, direction: StockGroupMoveDirection) => {
    context.subscriptions.push(
      commands.registerCommand(command, (target?: LeekTreeItem) => {
        const groupId = getTargetStockGroupId(target);
        if (!groupId) return;
        LeekFundConfig.moveStockGroup(groupId, direction, () => {
          stockProvider.refresh();
        });
      })
    );
  };
  registerStockGroupMoveCommand('leek-fund.moveStockGroupUp', 'up');
  registerStockGroupMoveCommand('leek-fund.moveStockGroupDown', 'down');
  registerStockGroupMoveCommand('leek-fund.moveStockGroupTop', 'top');
  registerStockGroupMoveCommand('leek-fund.moveStockGroupBottom', 'bottom');
  context.subscriptions.push(
    commands.registerCommand('leek-fund.deleteStockGroup', async (target?: LeekTreeItem) => {
      const groupId = getTargetStockGroupId(target);
      if (!groupId) return;
      const group = LeekFundConfig.getStockGroups().find((item) => item.id === groupId);
      if (!group) {
        window.showWarningMessage('未找到股票分组。');
        return;
      }
      const childGroupCount = LeekFundConfig.getStockGroups().filter(
        (item) => item.parentId === group.id
      ).length;
      const confirm = await window.showWarningMessage(
        childGroupCount
          ? `确认删除一级分组「${group.name}」及其 ${childGroupCount} 个二级分组？组内股票不会删除。`
          : `确认删除分组「${group.name}」？组内股票不会删除。`,
        { modal: true },
        '删除'
      );
      if (confirm !== '删除') return;
      LeekFundConfig.deleteStockGroup(groupId, () => {
        stockProvider.refresh();
      });
    })
  );
  context.subscriptions.push(
    commands.registerCommand('leek-fund.renameStockGroup', async (target?: LeekTreeItem) => {
      const groupId = getTargetStockGroupId(target);
      if (!groupId) return;
      const groups = LeekFundConfig.getStockGroups();
      const group = groups.find((item) => item.id === groupId);
      if (!group) {
        window.showWarningMessage('未找到股票分组。');
        return;
      }
      const newName = await window.showInputBox({
        prompt: '输入新的分组名称',
        value: group.name,
        validateInput: (value) => {
          const trimmed = value.trim();
          if (!trimmed) return '分组名称不能为空';
          if (
            groups.some(
              (item) =>
                item.category === group.category &&
                item.parentId === group.parentId &&
                item.name === trimmed &&
                item.id !== groupId
            )
          ) {
            return group.parentId
              ? '同一一级分组下二级分组名称不能重复'
              : '同一市场分类下一级分组名称不能重复';
          }
          return undefined;
        },
      });
      if (!newName) return;
      LeekFundConfig.renameStockGroup(groupId, newName, () => {
        stockProvider.refresh();
      });
    })
  );
  // 股票置顶
  context.subscriptions.push(
    commands.registerCommand('leek-fund.setStockTop', (target) => {
      const code = getTargetStockCode(target);
      if (!code) return;
      LeekFundConfig.setStockTopCfg(code, () => {
        stockProvider.refresh();
      });
    })
  );
  /**
   * Settings command
   */
  context.subscriptions.push(
    commands.registerCommand('leek-fund.hideText', () => {
      stockService.toggleLabel();
      stockProvider.refresh();
    })
  );

  context.subscriptions.push(
    commands.registerCommand('leek-fund.setStockStatusBar', () => {
      const stockList = stockService.stockList;
      if (!stockList.length) {
        window.showWarningMessage('股票数据尚未加载，无法设置状态栏轮播股票。');
        return;
      }
      const statusBarStocks: string[] = LeekFundConfig.getConfig('leek-fund.statusBarStock') || [];
      const stockNameList = stockList.map((item: LeekTreeItem) => {
        return {
          label: `${item.info.name}`,
          description: `${item.info.code}`,
          picked: statusBarStocks.includes(item.info.code),
        };
      });
      window
        .showQuickPick(stockNameList, {
          placeHolder: '输入过滤选择，支持多选；选中的股票会在状态栏轮播展示',
          canPickMany: true,
        })
        .then((res) => {
          if (!res) {
            return;
          }
          const codes = res.map((item) => item.description);
          LeekFundConfig.updateStatusBarStockCfg(codes, () => {
            const handler = window.setStatusBarMessage(
              codes.length ? `状态栏轮播列表已更新` : `状态栏轮播已清空`
            );
            setTimeout(() => {
              handler.dispose();
            }, 1500);
          });
        });
    })
  );

  context.subscriptions.push(
    commands.registerCommand('leek-fund.customSetting', () => {
      const colorList = colorOptionList();

      window
        .showQuickPick(
          [
            { label: '📌 状态栏轮播股票设置', description: 'statusbar-stock' },
            {
              label: `🟦 状态栏显示或隐藏 ${
                process.platform === 'darwin' ? '(Cmd+Opt+T)' : '(Ctrl+Alt+T)'
              }`,
              description: 'toggle-status-bar',
            },
            { label: '🟥 状态栏轮播显示或隐藏', description: 'toggle-stock-bar' },
            {
              label: '🧩 状态栏图标显示或隐藏',
              description: 'toggle-status-bar-icon',
            },
            { label: '📈 状态栏股票涨时文字颜色', description: 'statusbar-rise' },
            { label: '📉 状态栏股票跌时文字颜色', description: 'statusbar-fall' },
            { label: '🍖 股票涨跌图标更换', description: 'icontype' },
            { label: '👀 显示/隐藏文本', description: 'hideText' },
            {
              label: globalState.remindSwitch ? '⏱️ 关闭提醒' : '⏰ 打开提醒',
              description: 'remindSwitch',
            },
            {
              label: '📤 导出设置',
              description: 'exportSettings',
            },
            {
              label: '📥 导入设置',
              description: 'importSettings',
            },
          ],
          {
            placeHolder: '第一步：选择设置项',
          }
        )
        .then((item: any) => {
          if (!item) {
            return;
          }
          const type = item.description;
          // 状态栏颜色设置
          if (type === 'statusbar-rise' || type === 'statusbar-fall') {
            window
              .showQuickPick(colorList, {
                placeHolder: `第二步：设置颜色（${item.label}）`,
              })
              .then((colorItem: any) => {
                if (!colorItem) {
                  return;
                }
                let color = colorItem.description;
                if (color === 'random') {
                  color = randomColor();
                }
                LeekFundConfig.setConfig(
                  type === 'statusbar-rise' ? 'leek-fund.riseColor' : 'leek-fund.fallColor',
                  color
                );
              });
          } else if (type === 'statusbar-stock') {
            // 状态栏轮播股票设置
            commands.executeCommand('leek-fund.setStockStatusBar');
          } else if (type === 'toggle-status-bar') {
            commands.executeCommand('leek-fund.toggleStatusBarVisibility');
          } else if (type === 'toggle-stock-bar') {
            commands.executeCommand('leek-fund.toggleStockBarVisibility');
          } else if (type === 'toggle-status-bar-icon') {
            commands.executeCommand('leek-fund.toggleStatusBarIconVisibility');
          } else if (type === 'icontype') {
            // 股票涨跌图标
            window
              .showQuickPick(
                [
                  {
                    label: '箭头图标（红涨绿跌）',
                    description: 'arrow',
                  },
                  {
                    label: '箭头图标（绿涨红跌）',
                    description: 'arrow1',
                  },
                  {
                    label: '无图标',
                    description: 'none',
                  },
                ],
                {
                  placeHolder: `第二步：选择股票涨跌图标`,
                }
              )
              .then((iconItem: any) => {
                if (!iconItem) {
                  return;
                }
                if (globalState.iconType !== iconItem.description) {
                  LeekFundConfig.setConfig('leek-fund.iconType', iconItem.description);
                  globalState.iconType = iconItem.description;
                }
              });
          } else if (type === 'hideText') {
            commands.executeCommand('leek-fund.hideText');
          } else if (type === 'remindSwitch') {
            commands.executeCommand('leek-fund.toggleRemindSwitch');
          } else if (type === 'exportSettings') {
            commands.executeCommand('leek-fund.exportSettings');
          } else if (type === 'importSettings') {
            commands.executeCommand('leek-fund.importSettings');
          }
        });
    })
  );

  context.subscriptions.push(
    commands.registerCommand('leek-fund.toggleRemindSwitch', (on?: number) => {
      const newValue = on !== undefined ? (on ? 1 : 0) : globalState.remindSwitch === 1 ? 0 : 1;
      LeekFundConfig.setConfig('leek-fund.stockRemindSwitch', newValue);
      globalState.remindSwitch = newValue;
    })
  );

  context.subscriptions.push(
    commands.registerCommand('leek-fund.changeStatusBarItem', (stockId) => {
      const stockList = stockService.stockList;
      const stockNameList = stockList
        .filter((stock) => stock.info.code !== stockId)
        .map((item: LeekTreeItem) => {
          return {
            label: `${item.info.name}`,
            description: `${item.info.code}`,
          };
        });
      stockNameList.unshift({
        label: `删除`,
        description: `-1`,
      });
      window
        .showQuickPick(stockNameList, {
          placeHolder: '更换状态栏个股',
        })
        .then((res) => {
          if (!res) return;
          const statusBarStocks = LeekFundConfig.getConfig('leek-fund.statusBarStock');
          const newCfg = [...statusBarStocks];
          const newStockId = res.description;
          const index = newCfg.indexOf(stockId);
          if (newStockId === '-1') {
            if (index > -1) {
              newCfg.splice(index, 1);
            }
          } else {
            if (statusBarStocks.includes(newStockId)) {
              window.showWarningMessage(`「${res.label}」已在状态栏`);
              return;
            }
            if (index > -1) {
              newCfg[index] = res.description;
            } else {
              newCfg.push(res.description);
            }
          }
          LeekFundConfig.updateStatusBarStockCfg(newCfg, () => {
            const handler = window.setStatusBarMessage(
              newCfg.length ? `状态栏轮播列表已更新` : `状态栏轮播已清空`
            );
            setTimeout(() => {
              handler.dispose();
            }, 1500);
          });
        });
    })
  );

  context.subscriptions.push(
    commands.registerCommand('leek-fund.immersiveBackground', (isChecked: boolean) => {
      LeekFundConfig.setConfig('leek-fund.immersiveBackground', isChecked);
      globalState.immersiveBackground = isChecked;
    })
  );

  context.subscriptions.push(
    commands.registerCommand('leek-fund.stockWindVane', () => {
      strategyCenter(stockService);
    })
  );
  context.subscriptions.push(
    commands.registerCommand('leek-fund.openStockDetail', (target) => {
      const code = typeof target === 'string' ? target : getTargetStockCode(target);
      if (!code) return;
      stockDetailView(stockService, code);
    })
  );

  // Settings Import/Export Commands
  context.subscriptions.push(
    commands.registerCommand('leek-fund.exportSettings', async () => {
      try {
        const workspaceConfig = workspace.getConfiguration();
        const allSettings: any = {};

        // Get all leek-fund settings dynamically from extension context
        const extensionManifest = globalState.context.extension.packageJSON;
        const configurationProperties =
          extensionManifest.contributes?.configuration?.properties || {};

        // Filter to only leek-fund configuration keys
        const leekFundConfigKeys = Object.keys(configurationProperties).filter((key) =>
          key.startsWith('leek-fund.')
        );

        // Get all leek-fund settings that have actual values
        leekFundConfigKeys.forEach((key) => {
          const value = workspaceConfig.get(key);
          if (value !== undefined) {
            allSettings[key] = value;
          }
        });

        // Additional inspection method as fallback to catch any dynamically created settings
        const leekFundInspection = workspaceConfig.inspect('leek-fund');
        const inspectionSources = [
          leekFundInspection?.globalValue,
          leekFundInspection?.workspaceValue,
          leekFundInspection?.workspaceFolderValue,
        ];

        inspectionSources.forEach((source) => {
          if (source && typeof source === 'object') {
            Object.keys(source).forEach((key) => {
              const fullKey = `leek-fund.${key}`;
              if (!allSettings[fullKey]) {
                const value = workspaceConfig.get(fullKey);
                if (value !== undefined) {
                  allSettings[fullKey] = value;
                }
              }
            });
          }
        });

        if (Object.keys(allSettings).length === 0) {
          window.showInformationMessage('没有找到任何以 "leek-fund." 开头的设置');
          return;
        }

        // Show save dialog
        const uri = await window.showSaveDialog({
          defaultUri: Uri.file(getDefaultSettingsPath()),
          filters: {
            'JSON files': ['json'],
            'All files': ['*'],
          },
        });

        if (uri) {
          const settingsJson = JSON.stringify(allSettings, null, 2);
          await workspace.fs.writeFile(uri, Buffer.from(settingsJson));
          window.showInformationMessage(`设置已导出到: ${uri.fsPath}`);
        }
      } catch (error) {
        window.showErrorMessage(`导出设置失败: ${error}`);
      }
    })
  );

  context.subscriptions.push(
    commands.registerCommand('leek-fund.importSettings', async () => {
      try {
        // Show open dialog
        const uris = await window.showOpenDialog({
          defaultUri: Uri.file(getDefaultSettingsPath()),
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: {
            'JSON files': ['json'],
            'All files': ['*'],
          },
        });

        if (!uris || uris.length === 0) {
          return;
        }

        const uri = uris[0];
        const content = await workspace.fs.readFile(uri);
        const settingsText = Buffer.from(content).toString('utf8');

        let importedSettings: any;
        try {
          importedSettings = JSON.parse(settingsText);
        } catch (parseError) {
          window.showErrorMessage('无法解析 JSON 文件，请检查文件格式');
          return;
        }

        // Filter settings that start with 'leek-fund.'
        const leekFundSettings: any = {};
        Object.keys(importedSettings).forEach((key) => {
          if (key.startsWith('leek-fund.')) {
            leekFundSettings[key] = importedSettings[key];
          }
        });

        if (Object.keys(leekFundSettings).length === 0) {
          window.showInformationMessage('文件中没有找到任何以 "leek-fund." 开头的设置');
          return;
        }

        // Confirm import
        const result = await window.showInformationMessage(
          `将导入 ${Object.keys(leekFundSettings).length} 个设置项，这将覆盖现有的设置。是否继续？`,
          '确认导入',
          '取消'
        );

        if (result !== '确认导入') {
          return;
        }

        // Import settings
        const workspaceConfig = workspace.getConfiguration();
        let successCount = 0;
        let failCount = 0;

        for (const [key, value] of Object.entries(leekFundSettings)) {
          try {
            await workspaceConfig.update(key, value, true);
            successCount++;
          } catch (error) {
            console.error(`Failed to import setting ${key}:`, error);
            failCount++;
          }
        }

        if (successCount > 0) {
          window.showInformationMessage(
            `设置导入完成：成功 ${successCount} 项${failCount > 0 ? `，失败 ${failCount} 项` : ''}`
          );

          // Refresh the extension state
          commands.executeCommand('leek-fund.refreshStock');
        } else {
          window.showErrorMessage('导入设置失败');
        }
      } catch (error) {
        window.showErrorMessage(`导入设置失败: ${error}`);
      }
    })
  );

  // checkForUpdate();
}

export function registerCommandPaletteEvent(context: ExtensionContext, statusbar: StatusBar) {
  context.subscriptions.push(
    commands.registerCommand('leek-fund.toggleStatusBarIconVisibility', () => {
      statusbar.toggleStatusBarIconVisibility();
    })
  );
  context.subscriptions.push(
    commands.registerCommand('leek-fund.toggleStatusBarVisibility', () => {
      statusbar.toggleVisibility();
    })
  );
  context.subscriptions.push(
    commands.registerCommand('leek-fund.toggleStockBarVisibility', () => {
      statusbar.toggleStockBarVisibility();
    })
  );
}
