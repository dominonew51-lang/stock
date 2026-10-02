import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLookupSymbol } from "../app/asset-symbol.ts";

test("normalizes Coinbase and Circle company names to their canonical tickers", () => {
  assert.equal(normalizeLookupSymbol("coinbase"), "COIN");
  assert.equal(normalizeLookupSymbol("Coinbase Global"), "COIN");
  assert.equal(normalizeLookupSymbol("circle"), "CRCL");
  assert.equal(normalizeLookupSymbol("Circle Internet Group"), "CRCL");
});
