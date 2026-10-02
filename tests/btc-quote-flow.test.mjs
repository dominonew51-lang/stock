import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [pageSource, routeSource, workerSource, productionWorkerSource] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/assets/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../worker-entry.mjs", import.meta.url), "utf8"),
]);

test("keeps Bitcoin out of the slow mixed quote batch and refreshes it independently", () => {
  assert.match(pageSource, /const bitcoinCodes = useMemo\(\(\) =>/);
  assert.match(pageSource, /const refreshBitcoinQuotes = \(\) =>/);
  assert.match(pageSource, /window\.setInterval\(refreshBitcoinQuotes, 30000\)/);
  assert.match(pageSource, /filter\(\(code\) => !isBitcoinSymbol\(code\)\)/);
});

test("canonicalizes Bitcoin aliases in the client quote map", () => {
  assert.match(pageSource, /function mergeQuoteRecords\(/);
  assert.match(pageSource, /quote\.symbol\.trim\(\)\.toUpperCase\(\)/);
  assert.match(pageSource, /price > 0/);
});

test("does not reuse a zero-price cached Bitcoin quote", () => {
  assert.match(pageSource, /if \(cached && cached\.price > 0\) return cached/);
});

test("keeps Bitcoin aliases and crypto category on the server", () => {
  assert.match(routeSource, /\[\"BTC\", \"BTCUSDT\", \"BITCOIN\", \"比特币\"\]/);
  assert.match(routeSource, /symbol: \"BTC\"/);
  assert.match(routeSource, /market: \"加密货币\"/);
});

test("keeps COIN and CRCL recognizable during a Nasdaq quote outage", () => {
  assert.match(routeSource, /knownUsAssets/);
  assert.match(routeSource, /COIN:\s*"Coinbase"/);
  assert.match(routeSource, /CRCL:\s*"Circle"/);
  assert.match(routeSource, /price:\s*0,\s*currency:\s*"\$",\s*change:\s*0/);
});

test("applies USD conversion to crypto daily snapshots", () => {
  assert.match(workerSource, /market\?: \"美股\" \| \"A股\" \| \"基金\" \| \"加密货币\"/);
  assert.match(workerSource, /holding\.market === \"美股\" \|\| holding\.market === \"加密货币\"/);
  assert.match(workerSource, /quote\?\.market === \"美股\" \|\| quote\?\.market === \"加密货币\"/);
  assert.doesNotMatch(productionWorkerSource, /item\.market === \"加密货币\".*continue/);
  assert.match(productionWorkerSource, /market === \"美股\" \|\| market === \"加密货币\"/);
  assert.match(productionWorkerSource, /market === \"现金\" \? 1/);
});
