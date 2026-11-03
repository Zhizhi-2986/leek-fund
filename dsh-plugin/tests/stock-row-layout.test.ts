import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const tree = readFileSync(new URL('../src/client/StockTree.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/client/styles.module.css', import.meta.url), 'utf8')
const stockRow = tree.slice(tree.indexOf('function renderStockRow('), tree.indexOf('function renderSpeedRankingRow('))

// The test runner cannot import CSS Modules directly; these source contracts
// protect the row structure until the layout can be verified in the host GUI.
test('stock row places name and code in one left-hand two-line column', () => {
  assert.match(stockRow, /<span className={s\.stockIdentity}>\s*<span className={s\.stockName}>[\s\S]*?<\/span>\s*<span className={s\.stockCode}>{code}<\/span>\s*<\/span>/)
  assert.match(styles, /\.stockIdentity\s*\{[^}]*flex-direction:\s*column/)
})

test('stock row shows only price and percent in right-hand quote column', () => {
  const quoteColumn = stockRow.match(/<span className={s\.stockQuote}>([\s\S]*?)<\/span>\s*<button/)
  assert.ok(quoteColumn)
  assert.match(quoteColumn[1], /s\.stockPrice/)
  assert.match(quoteColumn[1], /s\.stockPercent/)
  assert.doesNotMatch(quoteColumn[1], /s\.quoteStatus|status\.label|quote\?\.time/)
})

test('stock row keeps market status and full quote time in hover tooltip', () => {
  assert.match(stockRow, /title={`行情 \${loadFailed \? '更新失败，显示上次数据' : status\.label} · \${quote\?\.time \|\| '时间未知'}`}/)
})

test('action button inherits the row hover tooltip instead of replacing it', () => {
  const actionButton = stockRow.match(/<button type="button" className={s\.rowAction}[^>]*>/)
  assert.ok(actionButton)
  assert.doesNotMatch(actionButton[0], /\stitle=/)
})

test('last update does not take a permanent line above the tree', () => {
  assert.doesNotMatch(tree, /<div className={s\.quoteStatusBar}>/)
})
