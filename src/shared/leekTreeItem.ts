import { join } from 'path';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import globalState from '../globalState';
import { IconType, MarketItemInfo, TreeItemType } from './typed';
import { toFixed } from './utils';

export class LeekTreeItem extends TreeItem {
  info: MarketItemInfo;
  type: string | undefined;
  isCategory: boolean;
  contextValue: string | undefined;
  _itemType?: TreeItemType;

  constructor(info: MarketItemInfo, context: ExtensionContext | undefined, isCategory = false) {
    super('', TreeItemCollapsibleState.None);
    this.info = info;
    this.isCategory = isCategory;
    const {
      showLabel,
      isStock,
      name,
      code,
      type,
      symbol,
      percent,
      price,
      open,
      yestclose,
      high,
      low,
      updown,
      volume,
      amount = 0,
      time,
      afterPrice,
      afterPercent,
      isStop,
      contextValue,
      _itemType,
      spotBuyPrice = 0,
      spotSellPrice = 0,
      cashBuyPrice = 0,
      cashSellPrice = 0,
      conversionPrice = 0,
      publishDateTime = '',
    } = info;

    if (_itemType) {
      this._itemType = _itemType;
    } else {
      this._itemType = TreeItemType.STOCK;
    }

    const isStockItem = this._itemType === TreeItemType.STOCK;
    const isBinanceItem = this._itemType === TreeItemType.BINANCE;
    const isForex = this._itemType === TreeItemType.FOREX;

    this.type = type;
    this.contextValue = contextValue;
    let _percent: number | string = Math.abs(percent);
    if (isNaN(_percent)) {
      _percent = '--';
    } else {
      _percent = _percent.toFixed(2);
    }
    let icon = 'up';
    const grow = percent?.indexOf('-') === 0 ? false : true;
    const val = Math.abs(percent);
    if (grow) {
      if (IconType.ARROW === globalState.iconType) {
        icon = val >= 2 ? 'up' : 'up1';
      } else if (IconType.ARROW1 === globalState.iconType) {
        icon = val >= 2 ? 'up2' : 'up3';
      } else if (IconType.NONE === globalState.iconType) {
        icon = '';
      }
      _percent = '+' + _percent;
    } else {
      if (IconType.ARROW === globalState.iconType) {
        icon = val >= 2 ? 'down' : 'down1';
      } else if (IconType.ARROW1 === globalState.iconType) {
        icon = val >= 2 ? 'down2' : 'down3';
      } else if (IconType.NONE === globalState.iconType) {
        icon = '';
      }
      _percent = '-' + _percent;
    }
    if (isStop) {
      icon = 'stop';
    }
    let iconPath: string | undefined = '';
    if (showLabel) {
      iconPath =
        globalState.iconType !== IconType.NONE
          ? context?.asAbsolutePath(join('resources', `${icon}.svg`))
          : icon;
    }
    const isIconPath = iconPath?.lastIndexOf('.svg') !== -1;
    if (isIconPath && type !== 'nodata') {
      this.iconPath = iconPath;
    }
    let text = '';
    let desc = '';

    if (showLabel) {
      if (isStockItem) {
        const risePercent = isStop ? '停牌' : `${_percent}%`;
        if (type === 'nodata') {
          text = info.name;
        } else {
          text = `「${name}」`;
          desc = `${risePercent}  ${price}`;
        }
      } else if (isBinanceItem) {
        text = `「${name}」`;
        desc = `${_percent}%  ${price}`;
      } else if (isForex) {
        text = `「${name}」`;
        desc = `${spotBuyPrice}/${spotSellPrice}`;
      }
    } else {
      text = isStockItem
        ? `${_percent}%  ${price}  「${code}」`
        : `${_percent}%  「${code}」`;
    }
    this.label = text;
    this.description = desc || undefined;
    this.id = info.id || code;
    if (!isCategory && isBinanceItem) {
      let typeAndSymbol = `${type}${symbol}`;
      this.command = {
        title: name, // 标题
        command: 'leek-fund.binanceItemClick',
        arguments: [
          code,
          name,
          text,
          typeAndSymbol,
        ],
      };
      if (type === 'nodata') {
        this.command.command = '';
      }
    }

    if (isStockItem) {
      const labelText = !showLabel ? name : '';

      const typeText = type;

      if (type === 'nodata') {
        this.tooltip = '接口不支持，右键删除关注';
      } else {
        this.tooltip = `【今日行情】${labelText}${typeText}${symbol}\n 涨跌：${updown}   百分比：${_percent}%\n 最高：${high}   最低：${low}\n 今开：${open}   昨收：${yestclose}${
          afterPrice ? `\n 盘后：${afterPrice}   涨跌幅：${afterPercent}%` : ''
        }\n 成交量：${volume}   成交额：${amount}`;
      }
    } else if (isBinanceItem) {
      this.tooltip = `【今日行情】${name}\n 涨跌：${updown}   百分比：${_percent}%\n 最高：${high}   最低：${low}\n 今开：${open}   昨收：${yestclose}\n 成交量：${volume}   成交额：${amount}`;
    } else if (isForex) {
      this.tooltip = `现汇买入价：${spotBuyPrice}\n现钞买入价：${cashBuyPrice}\n现汇卖出价：${spotSellPrice}\n现钞卖出价：${cashSellPrice}\n中行折算价：${conversionPrice}\n发布日期：${publishDateTime}`;
    } else {
      this.tooltip = `「${name}」(${code})`;
    }
  }
}
