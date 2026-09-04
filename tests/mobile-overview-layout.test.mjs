import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [pageSource, layoutSource, overviewStyles, routeSource] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/overview-compact.css", import.meta.url), "utf8"),
  readFile(new URL("../app/api/assets/route.ts", import.meta.url), "utf8"),
]);

test("keeps the mobile analysis title and four equal controls on one row", () => {
  assert.match(pageSource, /<h2>资产分析<\/h2>/);
  assert.ok(
    layoutSource.indexOf('import "./overview-compact.css"') > layoutSource.indexOf('import "./globals.css"'),
    "the scoped overview layer must load after legacy global styles",
  );
  assert.match(
    overviewStyles,
    /@media\s*\(max-width:\s*780px\)[\s\S]*?\.app-shell\.overview-only \.trend-head\s*\{[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\)/,
  );
  assert.match(
    overviewStyles,
    /@media\s*\(max-width:\s*780px\)[\s\S]*?\.app-shell\.overview-only \.trend-head p\s*\{[^}]*display:\s*none/,
  );
  assert.match(
    overviewStyles,
    /@media\s*\(max-width:\s*780px\)[\s\S]*?\.app-shell\.overview-only \.trend-switch\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
  );
});

test("uses a single holding drawer instead of a full-page editor", () => {
  assert.match(pageSource, /holding-editor-drawer/);
  assert.match(pageSource, /管理持仓/);
  assert.match(pageSource, /新增持仓/);
  assert.match(pageSource, /删除持仓/);
  assert.match(overviewStyles, /\.holding-editor-drawer/);
});

test("keeps the quiet wealth terminal tokens and white compact hero", () => {
  assert.match(overviewStyles, /--overview-bg:\s*#F6F9FC/i);
  assert.match(overviewStyles, /--overview-navy:\s*#0B2742/i);
  assert.match(overviewStyles, /--overview-profit:\s*#9F332E/i);
  assert.match(overviewStyles, /--overview-loss:\s*#176549/i);
  assert.match(overviewStyles, /\.overview-hero\s*\{[\s\S]*background:\s*var\(--overview-surface\)/);
  assert.match(overviewStyles, /\.overview-hero \.summary-card[^\{]*\{[\s\S]*background:\s*var\(--overview-surface\)/);
  assert.match(pageSource, /className="topbar-title-line"/);
  assert.match(pageSource, /className="long-term-inline"/);
  assert.doesNotMatch(pageSource, /className="long-term-counter"/);
});

test("formats chart axes from their actual range without duplicate labels", () => {
  assert.match(pageSource, /function trendAxisLabel\(value: number, mode: TrendMode, step: number/);
  assert.match(pageSource, /const axisStep = \(max - min\) \/ 4/);
  assert.match(pageSource, /const axisValues = Array\.from\(\{length:5\}/);
  assert.match(pageSource, /trendAxisLabel\(value, mode, axisStep\)/);
  assert.match(pageSource, /new Set\(labels\)\.size < labels\.length/);
  assert.match(pageSource, /absolute >= 10000/);
});

test("keeps mobile code input raw until lookup or save", () => {
  assert.doesNotMatch(
    pageSource,
    /onChange=\{\(event\)=>patch\(\{symbol:event\.target\.value\.toUpperCase\(\),name:""\}\)\}/,
    "code input must not rewrite the controlled value on every keystroke",
  );
  assert.match(pageSource, /autoCapitalize="characters"/);
  assert.match(pageSource, /autoCorrect="off"/);
  assert.match(pageSource, /spellCheck=\{false\}/);
  assert.match(pageSource, /autoComplete="off"/);
});

test("keeps small treemap labels readable without changing their value-based geometry", () => {
  assert.match(pageSource, /const tight = rectangle\.h < 12 \|\| rectangle\.w < 18/);
  assert.match(pageSource, /treemap-tile-tight/);
  assert.match(
    overviewStyles,
    /\.portfolio-treemap \.treemap-tile-tight\s*\{[^}]*padding:\s*2px 4px[^}]*line-height:\s*1/,
  );
  assert.match(overviewStyles, /\.portfolio-treemap\s*\{[^}]*height:\s*300px/);
  assert.match(overviewStyles, /@media\s*\(max-width:\s*390px\)[\s\S]*?\.portfolio-treemap\s*\{[^}]*height:\s*285px/);
  assert.match(overviewStyles, /--modern-readable-muted/);
});

test("supports cash aliases without requiring a market lookup", () => {
  assert.match(pageSource, /function isCashSymbol\(/);
  for (const alias of ["CNY", "RMB", "人民币", "USD", "美元", "USDT", "TETHER"]) assert.match(pageSource, new RegExp(alias));
  assert.match(pageSource, /suggestedCategory:\s*"现金\/类现金"/);
  assert.match(pageSource, /price:\s*1/);
  assert.match(pageSource, /provider:\s*"固定面值"/);
  assert.match(routeSource, /function resolveCashAsset\(/);
  assert.match(routeSource, /market:\s*"现金"/);
  assert.match(routeSource, /provider:\s*"固定面值"/);
});

test("uses stable latest NAV endpoints for Chinese funds", () => {
  assert.match(routeSource, /function fetchEastmoneyFundQuote\(/);
  assert.match(routeSource, /fund\.eastmoney\.com\/pingzhongdata/);
  assert.match(routeSource, /Data_netWorthTrend/);
  assert.match(routeSource, /function fetchEastmoneyFundHistoryQuote\(/);
  assert.match(routeSource, /api\.fund\.eastmoney\.com\/f10\/lsjz/);
  assert.match(routeSource, /fetchEastmoneyFundQuote\(symbol\)/);
  assert.match(routeSource, /timestamp \+ 8 \* 60 \* 60 \* 1000/);
});

test("refreshes stale A-share caches after the market close", () => {
  assert.match(pageSource, /function quoteDateKey\(/);
  assert.match(pageSource, /filter\(\(\[, quote\]\) => quote\.market !== "A股"\)/);
  assert.match(pageSource, /let cachedQuotes: Record<string, MarketQuote> = \{\}/);
  assert.match(pageSource, /let forceChineseRefresh = true/);
  assert.match(pageSource, /if \(forceChineseRefresh\) return true/);
  assert.match(pageSource, /if \(market === "基金"\) return hour < 20/);
  assert.match(pageSource, /return hour < 15 \|\| quoteDate === today/);
});

test("prioritizes holding value and history in the quick card", () => {
  assert.match(pageSource, /quick-card-value/);
  assert.match(pageSource, /quick-card-returns/);
  assert.match(pageSource, /持仓市值/);
  assert.match(pageSource, /历史收益率/);
  assert.match(pageSource, /历史收益/);
  assert.match(pageSource, /function conciseUSCompanyName\(/);
  assert.match(pageSource, /TSLA:"Tesla"/);
  assert.match(pageSource, /common stock/i);
  assert.doesNotMatch(pageSource, /holding && <div className="quick-card-market"/);
  assert.doesNotMatch(pageSource, /quick-card-edit/);
  assert.doesNotMatch(pageSource, /onEdit/);
  assert.match(overviewStyles, /quick-card-value/);
  assert.match(overviewStyles, /quick-card-returns/);
  assert.doesNotMatch(overviewStyles, /quick-card-edit/);
  assert.match(overviewStyles, /quick-card-close[^{]*\{[^}]*position:\s*static/);
});
