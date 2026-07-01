/*--------------------------------------------------------------
 *  Copyright (c) Nicky<giscafer@outlook.com>. All rights reserved.
 *  Github: https://github.com/giscafer
 *-------------------------------------------------------------*/

import { window, workspace } from 'vscode';
import { uniq, events } from './utils';
import { compact, flattenDeep } from 'lodash';
import { StockCategory, StockGroupConfig } from './typed';

type StockGroupMoveDirection = 'up' | 'down' | 'top' | 'bottom';

export class BaseConfig {
  /**
   * 获取全局（用户）配置对象
   */
  protected static getGlobalConfig() {
    return workspace.getConfiguration(undefined, null);
  }

  /**
   * 获取全局配置值（字符串数组类型）
   */
  protected static getGlobalConfigArray(key: string, defaultValue: string[] = []): string[] {
    const config = this.getGlobalConfig();
    const configInspect = config.inspect(key);
    return (configInspect?.globalValue as string[]) ?? config.get(key, defaultValue);
  }

  static getConfig(key: string, defaultValue?: any): any {
    const value = this.getGlobalConfigArray(key);
    return value === undefined ? defaultValue : value;
  }

  static setConfig(cfgKey: string, cfgValue: Array<any> | string | number | Object) {
    events.emit('updateConfig:' + cfgKey, cfgValue);
    const config = this.getGlobalConfig();
    return config.update(cfgKey, cfgValue, true);
  }

  static async updateConfig(cfgKey: string, codes: Array<string>) {
    const config = this.getGlobalConfig();
    // 优先使用全局配置值
    const origin = this.getGlobalConfigArray(cfgKey);
    let newCodes = uniq(compact(origin.concat(codes)));
    console.log(`🚀 ~ BaseConfig ~ updateConfig ~ ${cfgKey}:`, newCodes);
    await config.update(cfgKey, newCodes, true);
    return newCodes;
  }

  static removeConfig(cfgKey: string, code: string) {
    const config = this.getGlobalConfig();
    // 优先使用全局配置值
    const sourceCfg = this.getGlobalConfigArray(cfgKey);
    const newCfg = sourceCfg.filter((item: string) => item !== code);
    if (sourceCfg.length === newCfg.length) {
      window.showInformationMessage(`未找到要删除的配置项：${code}`);
    }
    return config.update(cfgKey, newCfg, true);
  }
}

export class LeekFundConfig extends BaseConfig {
  constructor() {
    super();
  }

  // Stock Begin
  static getStockGroups(): StockGroupConfig[] {
    const groups = this.getConfig('leek-fund.stockGroups', []);
    if (!Array.isArray(groups)) {
      return [];
    }

    return groups
      .map((group: any) => this.normalizeStockGroup(group))
      .filter((group: StockGroupConfig | undefined): group is StockGroupConfig => Boolean(group));
  }

  static setStockGroups(groups: StockGroupConfig[]) {
    return this.setConfig(
      'leek-fund.stockGroups',
      groups.map((group) => ({
        id: group.id,
        name: group.name,
        category: group.category,
        stockCodes: uniq(group.stockCodes || []),
      }))
    );
  }

  static createStockGroup(name: string, category: StockGroupConfig['category'], cb?: Function) {
    const trimmedName = name.trim();
    const groups = this.getStockGroups();
    const exists = groups.some(
      (group) => group.category === category && group.name === trimmedName
    );
    if (exists) {
      window.showWarningMessage(`分组「${trimmedName}」已存在。`);
      return Promise.resolve(groups);
    }

    const group: StockGroupConfig = {
      id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmedName,
      category,
      stockCodes: [],
    };
    const nextGroups = [...groups, group];
    return this.setStockGroups(nextGroups).then(() => {
      window.showInformationMessage(`股票分组创建成功。`);
      if (cb && typeof cb === 'function') {
        cb(group, nextGroups);
      }
      return nextGroups;
    });
  }

  static moveStockGroup(groupId: string, direction: StockGroupMoveDirection, cb?: Function) {
    const groups = this.getStockGroups();
    const group = groups.find((item) => item.id === groupId);
    if (!group) {
      window.showWarningMessage(`未找到股票分组。`);
      return Promise.resolve(groups);
    }

    const categoryGroups = groups.filter((item) => item.category === group.category);
    const currentIndex = categoryGroups.findIndex((item) => item.id === groupId);
    let nextIndex = currentIndex;
    if (direction === 'up') {
      nextIndex = Math.max(0, currentIndex - 1);
    } else if (direction === 'down') {
      nextIndex = Math.min(categoryGroups.length - 1, currentIndex + 1);
    } else if (direction === 'top') {
      nextIndex = 0;
    } else if (direction === 'bottom') {
      nextIndex = categoryGroups.length - 1;
    }

    if (nextIndex === currentIndex) {
      window.showInformationMessage(`分组顺序未变化。`);
      return Promise.resolve(groups);
    }

    const nextCategoryGroups = [...categoryGroups];
    const [movingGroup] = nextCategoryGroups.splice(currentIndex, 1);
    nextCategoryGroups.splice(nextIndex, 0, movingGroup);

    let categoryIndex = 0;
    const nextGroups = groups.map((item) => {
      if (item.category !== group.category) {
        return item;
      }
      const nextGroup = nextCategoryGroups[categoryIndex];
      categoryIndex += 1;
      return nextGroup;
    });

    return this.setStockGroups(nextGroups).then(() => {
      window.showInformationMessage(`股票分组顺序已更新。`);
      if (cb && typeof cb === 'function') {
        cb(group, nextGroups);
      }
      return nextGroups;
    });
  }

  static deleteStockGroup(groupId: string, cb?: Function) {
    const groups = this.getStockGroups();
    const group = groups.find((item) => item.id === groupId);
    if (!group) {
      window.showWarningMessage(`未找到股票分组。`);
      return Promise.resolve(groups);
    }

    const nextGroups = groups.filter((item) => item.id !== groupId);
    return this.setStockGroups(nextGroups).then(() => {
      window.showInformationMessage(`股票分组已删除，组内股票不会删除。`);
      if (cb && typeof cb === 'function') {
        cb(group, nextGroups);
      }
      return nextGroups;
    });
  }

  static renameStockGroup(groupId: string, newName: string, cb?: Function) {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      window.showWarningMessage(`分组名称不能为空。`);
      return Promise.resolve(this.getStockGroups());
    }

    const groups = this.getStockGroups();
    const group = groups.find((item) => item.id === groupId);
    if (!group) {
      window.showWarningMessage(`未找到股票分组。`);
      return Promise.resolve(groups);
    }

    // 检查同类别下是否有重名
    const nameExists = groups.some(
      (item) => item.category === group.category && item.name === trimmedName && item.id !== groupId
    );
    if (nameExists) {
      window.showWarningMessage(`同一市场分类下分组名称「${trimmedName}」已存在。`);
      return Promise.resolve(groups);
    }

    if (group.name === trimmedName) {
      window.showInformationMessage(`分组名称未变化。`);
      return Promise.resolve(groups);
    }

    const nextGroups = groups.map((item) =>
      item.id === groupId ? { ...item, name: trimmedName } : item
    );

    return this.setStockGroups(nextGroups).then(() => {
      window.showInformationMessage(`分组「${trimmedName}」已保存。`);
      if (cb && typeof cb === 'function') {
        cb(group, nextGroups);
      }
      return nextGroups;
    });
  }

  static setStockGroupForStock(code: string, groupId: string | undefined, cb?: Function) {
    const groups = this.getStockGroups();
    const targetGroup = groupId ? groups.find((item) => item.id === groupId) : undefined;
    if (groupId && !targetGroup) {
      window.showWarningMessage(`未找到股票分组。`);
      return Promise.resolve(groups);
    }

    const nextGroups = groups.map((group) => {
      const withoutStock = group.stockCodes.filter((item) => item !== code);
      if (group.id !== groupId) {
        return {
          ...group,
          stockCodes: withoutStock,
        };
      }
      return {
        ...group,
        stockCodes: group.stockCodes.includes(code) ? group.stockCodes : [...withoutStock, code],
      };
    });

    if (JSON.stringify(groups) === JSON.stringify(nextGroups)) {
      window.showInformationMessage(`股票分组未变化。`);
      return Promise.resolve(groups);
    }

    return this.setStockGroups(nextGroups).then(() => {
      window.showInformationMessage(
        targetGroup ? `已移动到分组「${targetGroup.name}」。` : `已移动到未分组。`
      );
      if (cb && typeof cb === 'function') {
        cb(code, targetGroup, nextGroups);
      }
      return nextGroups;
    });
  }

  static updateStockCfg(list: string, cb?: Function) {
    const cfgKey = 'leek-fund.stocks';
    const config = this.getGlobalConfig();
    // 优先使用全局配置值
    const origin = this.getGlobalConfigArray(cfgKey);
    let codes = typeof list === 'string' ? list.split(',') : list;
    let newCodes = uniq(compact(flattenDeep(origin).concat(codes))) as string[];
    newCodes = newCodes.map((code: string) => {
      if (code.startsWith('hk')) {
        return code.toLowerCase();
      }
      return code;
    });
    config.update(cfgKey, newCodes, true).then(() => {
      window.showInformationMessage(`Stock Successfully add.`);
      if (cb && typeof cb === 'function') {
        cb(codes, newCodes);
      }
    });
  }

  // ETF Begin
  static getEtfStocks(): string[] {
    return this.getConfig('leek-fund.etfStocks', []);
  }

  static updateEtfStockCfg(list: string, cb?: Function) {
    const cfgKey = 'leek-fund.etfStocks';
    const config = this.getGlobalConfig();
    const origin = this.getGlobalConfigArray(cfgKey);
    let codes = typeof list === 'string' ? list.split(',') : list;
    let newCodes = uniq(compact(flattenDeep(origin).concat(codes))) as string[];
    config.update(cfgKey, newCodes, true).then(() => {
      window.showInformationMessage(`ETF Successfully add.`);
      if (cb && typeof cb === 'function') {
        cb(codes, newCodes);
      }
    });
  }

  static removeEtfStockCfg(code: string, cb?: Function) {
    const cfgKey = 'leek-fund.etfStocks';
    const config = this.getGlobalConfig();
    const sourceCfg = this.getGlobalConfigArray(cfgKey);
    const newCfg = sourceCfg.filter((item: string) => item !== code);
    if (sourceCfg.length === newCfg.length) {
      window.showInformationMessage(`未找到要删除的 ETF：${code}`);
    } else {
      window.showInformationMessage(`ETF Successfully delete.`);
    }
    config.update(cfgKey, newCfg, true).then(() => {
      if (cb && typeof cb === 'function') {
        cb(code);
      }
    });
  }
  // ETF End

  static removeStockCfg(code: string, cb?: Function) {
    this.removeConfig('leek-fund.stocks', code).then(() => {
      this.removeStockFromGroups(code).then(() => {
        window.showInformationMessage(`Stock Successfully delete.`);
        if (cb && typeof cb === 'function') {
          cb(code);
        }
      });
    });
  }

  static setStatusBarStockVisibleCfg(code: string, visible: boolean, cb?: Function) {
    const setStatusBarStockVisible = () => {
      const configArr: string[] = this.getConfig('leek-fund.statusBarStock') || [];
      const nextConfig = visible
        ? uniq([...configArr, code])
        : configArr.filter((item) => item !== code);
      const updateStatusBarStock = () =>
        this.setConfig('leek-fund.statusBarStock', nextConfig).then(() => {
          window.showInformationMessage(
            visible ? `已加入状态栏轮播展示。` : `已取消状态栏轮播展示。`
          );
          if (cb && typeof cb === 'function') {
            cb(code, nextConfig);
          }
        });

      if (!visible && nextConfig.length === 0 && !this.getConfig('leek-fund.hideStatusBarStock')) {
        this.setConfig('leek-fund.hideStatusBarStock', true).then(updateStatusBarStock);
      } else {
        updateStatusBarStock();
      }
    };

    if (visible && this.getConfig('leek-fund.hideStatusBarStock')) {
      this.setConfig('leek-fund.hideStatusBarStock', false).then(() => {
        setStatusBarStockVisible();
      });
    } else {
      setStatusBarStockVisible();
    }
  }

  static setStockTopCfg(code: string, cb?: Function) {
    let arr: string[] = this.getConfig('leek-fund.stocks');
    // 临时解决3.10.1~3.10.3 pr产生的分组bug
    const stockList = flattenDeep(arr).filter?.((item) => item !== code);
    stockList.unshift(code);

    this.setConfig('leek-fund.stocks', stockList).then(() => {
      const groups = this.getStockGroups();
      const nextGroups = groups.map((group) => {
        if (!group.stockCodes.includes(code)) {
          return group;
        }
        return {
          ...group,
          stockCodes: [code, ...group.stockCodes.filter((item) => item !== code)],
        };
      });
      const groupChanged = JSON.stringify(groups) !== JSON.stringify(nextGroups);
      const updateGroups = groupChanged ? this.setStockGroups(nextGroups) : Promise.resolve();
      updateGroups.then(() => {
        window.showInformationMessage(`Stock successfully set to top.`);
        if (cb && typeof cb === 'function') {
          cb(code);
        }
      });
    });
  }

  private static normalizeStockGroup(group: any): StockGroupConfig | undefined {
    if (!group || typeof group !== 'object') {
      return undefined;
    }
    if (![StockCategory.A, StockCategory.HK, StockCategory.US].includes(group.category)) {
      return undefined;
    }
    const id = typeof group.id === 'string' ? group.id.trim() : '';
    const name = typeof group.name === 'string' ? group.name.trim() : '';
    if (!id || !name) {
      return undefined;
    }
    const stockCodes: string[] = Array.isArray(group.stockCodes)
      ? (uniq(group.stockCodes.filter((code: any) => typeof code === 'string' && code)) as string[])
      : [];
    return {
      id,
      name,
      category: group.category,
      stockCodes,
    };
  }

  private static removeStockFromGroups(code: string) {
    const groups = this.getStockGroups();
    const nextGroups = groups.map((group) => ({
      ...group,
      stockCodes: group.stockCodes.filter((item) => item !== code),
    }));
    if (JSON.stringify(groups) === JSON.stringify(nextGroups)) {
      return Promise.resolve();
    }
    return this.setStockGroups(nextGroups);
  }

  // Stock End

  // Binance Begin
  static updateBinanceCfg(codes: string, cb?: Function) {
    this.updateConfig('leek-fund.binance', codes.split(',')).then(() => {
      window.showInformationMessage(`Pair Successfully add.`);
      if (cb && typeof cb === 'function') {
        cb(codes);
      }
    });
  }
  static removeBinanceCfg(code: string, cb?: Function) {
    this.removeConfig('leek-fund.binance', code).then(() => {
      window.showInformationMessage(`Pair Successfully delete.`);
      if (cb && typeof cb === 'function') {
        cb(code);
      }
    });
  }
  static setBinanceTopCfg(code: string, cb?: Function) {
    let configArr: string[] = this.getConfig('leek-fund.binance');
    configArr = [code, ...configArr.filter((item) => item !== code)];
    this.setConfig('leek-fund.binance', configArr).then(() => {
      window.showInformationMessage(`Pair successfully set to top.`);
      if (cb && typeof cb === 'function') {
        cb(code);
      }
    });
  }
  // Binance end

  // StatusBar Begin
  static updateStatusBarStockCfg(codes: Array<string>, cb?: Function) {
    const updateStatusBarStock = () => {
      this.setConfig('leek-fund.statusBarStock', codes).then(() => {
        window.showInformationMessage(`Status Bar Stock Successfully update.`);
        if (cb && typeof cb === 'function') {
          cb(codes);
        }
      });
    };

    if (codes.length) {
      if (this.getConfig('leek-fund.hideStatusBarStock')) {
        this.setConfig('leek-fund.hideStatusBarStock', false).then(() => {
          updateStatusBarStock();
        });
      } else {
        updateStatusBarStock();
      }
    } else {
      if (!this.getConfig('leek-fund.hideStatusBarStock')) {
        this.setConfig('leek-fund.hideStatusBarStock', true).then(() => {
          updateStatusBarStock();
        });
      } else {
        updateStatusBarStock();
      }
    }
  }
  // StatusBar End
}
