import { window } from 'vscode';
import globalState from '../globalState';
import { LeekFundConfig } from './leekConfig';

export function setStocksRemindCfgCb(cfg: Object) {
  LeekFundConfig.setConfig('leek-fund.stocksRemind', cfg).then(
    () => {
      window.showInformationMessage('价格预警保存成功！');
      cacheStocksRemindData(cfg);
    },
    (err) => {
      console.error(err);
    }
  );
}

export function cacheStocksRemindData(remindObj: Object) {
  globalState.stocksRemind = remindObj;
}
