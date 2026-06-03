import { ViewColumn } from 'vscode';
import ReusedWebviewPanel from './ReusedWebviewPanel';
import stockTrendPic from './stockTrendPic';
import globalState from '../globalState';
import { getEastMoneyHost } from './proxyService/proxyConfig';

function stockTrend(code: string, name: string, stockCode: string) {
  if (['0dji', '0ixic', '0inx'].includes(code)) {
    return stockTrendPic(code, name, stockCode);
  }
  if (/^恒生.*指数$/.test(name)) {
    return stockTrendPic(code, name, stockCode);
  }
  stockCode = stockCode.toLowerCase();
  let market = '1';
  if (stockCode.indexOf('hk') === 0) {
    market = '116';
  } else if (stockCode.indexOf('gb_') === 0) {
    stockCode = stockCode.replace('gb_', '.');
  } else if (stockCode.indexOf('usr_') === 0) {
    stockCode = stockCode.replace('usr_', '');
    market = '105';
  } else {
    market = stockCode.substring(0, 2) === 'sh' ? '1' : '0';
  }

  let mcid = market + '.' + code.substr(1);
  let url = `${getEastMoneyHost()}/basic/full.html?mcid=${mcid}`;

  if (!!globalState.kLineChartSwitch) {
    if (
      (market === '1' || market === '0') &&
      stockCode.indexOf('sh000') !== 0 &&
      stockCode.indexOf('sz399') !== 0
    ) {
      // 沪深股票详情地址可查看盘前盘后指数、买五卖五、筹码分布
      url = `${getEastMoneyHost()}/basic/h5chart-iframe.html?code=${code.substr(1)}&market=${market}`;
    }
  }

  let tabTitle = `股票实时走势(${code})`;
  const panel = ReusedWebviewPanel.create('stockTrendWebview', tabTitle, ViewColumn.One, {
    enableScripts: true,
  });

  panel.webview.html = panel.webview.html = `
  <!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>股票走势</title>
    <style>
    html.vscode-dark, body.vscode-dark, html.vscode-high-contrast, body.vscode-high-contrast {
      filter: invert(100%) hue-rotate(180deg);
    }
    </style>
  </head>
  <body>
    <div  style="min-width: 1320px; overflow-x:auto">
      <iframe
      src="${url}"
      frameborder="0"
      style="width: 100%; height: 900px"
    ></iframe>
    </div>
  </body>
</html>

  `;
}

export default stockTrend;
