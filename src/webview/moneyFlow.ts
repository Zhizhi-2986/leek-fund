import { ExtensionContext, ViewColumn } from 'vscode';
import { getTemplateFileContent } from '../shared/utils';
import ReusedWebviewPanel from './ReusedWebviewPanel';

function moneyFlow(context?: ExtensionContext) {
  const panel = ReusedWebviewPanel.create('leek-fund.moneyFlow', '沪深通资金流向', ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  panel.webview.html = getTemplateFileContent('hsgt.html', panel.webview);
}

export function mainMoneyFlow() {
  const panel = ReusedWebviewPanel.create(
    'leek-fund.mainMoneyFlow',
    '主力资金流向',
    ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );
  panel.webview.html = getTemplateFileContent('main-flow.html', panel.webview);
}

export default moneyFlow;
