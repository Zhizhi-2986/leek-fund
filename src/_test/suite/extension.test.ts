import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import StockService from '../../explorer/stockService';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.equal(-1, [1, 2, 3].indexOf(5));
		assert.equal(-1, [1, 2, 3].indexOf(0));
	});

	test('Sync status bar context with latest selection', () => {
		const stockService = Object.create(StockService.prototype) as StockService;
		stockService.stockList = [
			{ info: { code: 'sh000001' }, contextValue: 'statusBarStockHidden' },
			{ info: { code: 'sz000001' }, contextValue: 'statusBarStockVisible' },
			{ info: { code: 'invalid' }, contextValue: 'nodata' },
		] as any;

		stockService.syncStatusBarContext(['sh000001']);

		assert.equal(stockService.stockList[0].contextValue, 'statusBarStockVisible');
		assert.equal(stockService.stockList[1].contextValue, 'statusBarStockHidden');
		assert.equal(stockService.stockList[2].contextValue, 'nodata');
	});

	test('Status bar context commands handle missing stock target', async () => {
		await vscode.commands.executeCommand('leek-fund.showStockInStatusBar');
		await vscode.commands.executeCommand('leek-fund.hideStockFromStatusBar');
	});
});
