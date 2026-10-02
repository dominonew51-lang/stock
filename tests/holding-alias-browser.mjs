import assert from "node:assert/strict";
import { chromium } from "/Users/domibook/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(10_000);
let state = { holdings: [], useDemoHoldings: false, profile: { name: "测试" }, longTermStart: "2026-09-01" };
const lookupRequests = [];

await page.route("**/api/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.pathname === "/api/device-session") return route.fulfill({ json: { authorized: true, source: "device", trusted: true } });
  if (url.pathname === "/api/portfolio") {
    if (request.method() === "PUT") state = request.postDataJSON();
    return route.fulfill({ json: { state } });
  }
  if (url.pathname === "/api/assets") {
    const symbol = url.searchParams.get("codes") || "";
    lookupRequests.push(symbol);
    const names = { COIN: "Coinbase Global, Inc. Common Stock", CRCL: "Circle Internet Group, Inc. Class A Common Stock" };
    return route.fulfill({ json: { quotes: names[symbol] ? { [symbol]: { symbol, name: names[symbol], market: "美股", currency: "$", price: symbol === "COIN" ? 184.64 : 102.05, change: 0, provider: "Nasdaq", suggestedCategory: "美股" } } : {}, errors: {} } });
  }
  return route.fulfill({ json: {} });
});

await page.goto(process.env.TEST_URL || "http://localhost:8796");

for (const [entered, canonical, expectedName] of [["coinbase", "COIN", "Coinbase"], ["circle", "CRCL", "Circle"]]) {
  await page.getByRole("button", { name: "管理持仓" }).click();
  await page.getByRole("button", { name: /新增持仓/ }).click();
  const code = page.getByLabel("资产代码");
  await code.fill(entered);
  await code.press("Tab");
  await page.getByText(new RegExp(`${expectedName} 已识别`)).waitFor();
  assert.equal(await code.inputValue(), canonical);
  await page.getByLabel("持仓均价").fill("1");
  await page.getByLabel("持仓数或现金余额").fill("1");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.locator(".holding-editor-drawer").waitFor({ state: "detached" });
}

assert.ok(lookupRequests.includes("COIN"), "Coinbase name lookup requests canonical COIN");
assert.ok(lookupRequests.includes("CRCL"), "Circle name lookup requests canonical CRCL");
const locallySaved = await page.evaluate(() => JSON.parse(localStorage.getItem("hengce-custom-holdings") || "[]"));
assert.deepEqual(locallySaved.map((holding) => holding.symbol), ["COIN", "CRCL"]);
await page.waitForTimeout(1_000);
assert.deepEqual(state.holdings.map((holding) => holding.symbol), ["COIN", "CRCL"]);
assert.deepEqual(state.holdings.map((holding) => holding.name), ["COIN", "CRCL"]);
assert.deepEqual(state.holdings.map((holding) => holding.strategy), ["Crypto", "Crypto"]);

console.log("Mobile company-name lookup and save passed for COIN and CRCL");
await browser.close();
