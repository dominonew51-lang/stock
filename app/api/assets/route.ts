type Market = "美股" | "A股" | "基金" | "加密货币" | "现金";
type AssetBucket = "美股指数" | "红利" | "美股" | "A股" | "加密货币" | "现金/类现金";

type QuoteResult = {
  symbol: string;
  name: string;
  market: Market;
  price: number;
  currency: "$" | "¥";
  change: number;
  asOf: string;
  provider: "东方财富" | "腾讯行情" | "Nasdaq" | "Binance" | "Coinbase" | "CoinGecko" | "固定面值";
  suggestedCategory?: AssetBucket;
  marketCap?: number;
};

const requestHeaders = { "User-Agent": "Mozilla/5.0 (compatible; HengcePortfolio/1.0)", Accept: "application/json,text/plain,*/*" };

function isBitcoinSymbol(symbol: string) {
  return ["BTC", "BTCUSDT", "BITCOIN", "比特币"].includes(symbol.trim().toUpperCase());
}

const cashSymbolAliases: Record<string, "CNY" | "USD" | "USDT"> = {
  CNY: "CNY", RMB: "CNY", 人民币: "CNY",
  USD: "USD", 美元: "USD",
  USDT: "USDT", TETHER: "USDT",
};

function normalizeCashSymbol(symbol: string) {
  return cashSymbolAliases[symbol.trim().toUpperCase()];
}

function suggestCategory(name: string): AssetBucket | undefined {
  if (/纳斯达克|纳指|NASDAQ/i.test(name)) return "美股指数";
  if (/债|国开|固收/.test(name)) return "现金/类现金";
  if (/红利|低波|银行/.test(name)) return "红利";
  return undefined;
}

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: requestHeaders, signal: controller.signal });
    if (!response.ok) throw new Error(`上游接口返回 ${response.status}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string, encoding = "utf-8", timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: requestHeaders, signal: controller.signal });
    if (!response.ok) throw new Error(`上游接口返回 ${response.status}`);
    return new TextDecoder(encoding).decode(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function listedExchange(symbol: string) {
  if (/^[569]/.test(symbol)) return "1";
  if (/^(?:00|20|30|15|16|18)/.test(symbol)) return "0";
  return null;
}

async function fetchEastmoneyListedQuote(symbol: string, exchange: string): Promise<QuoteResult> {
  const quoteUrl = `https://push2.eastmoney.com/api/qt/stock/get?fltt=2&secid=${exchange}.${symbol}&fields=f57,f58,f43,f170`;
  const quote = await fetchJson<{ data?: { f43?: unknown; f58?: unknown; f170?: unknown } }>(quoteUrl);
  const data = quote?.data;
  const price = Number(data?.f43);
  if (!data || !Number.isFinite(price) || price <= 0) throw new Error("东方财富场内行情暂不可用");
  const name = String(data.f58 || symbol);
  return { symbol, name, market: "A股", price, currency: "¥", change: Number(data.f170 || 0), asOf: new Date().toISOString(), provider: "东方财富", suggestedCategory: suggestCategory(name) ?? "A股" };
}

async function fetchTencentListedQuote(symbol: string, exchange: string): Promise<QuoteResult> {
  const prefix = exchange === "1" ? "sh" : "sz";
  const text = await fetchText(`https://qt.gtimg.cn/q=${prefix}${symbol}`, "gbk");
  const payload = text.match(/="([^"]+)"/)?.[1];
  if (!payload) throw new Error("腾讯场内行情暂不可用");
  const fields = payload.split("~");
  const price = Number(fields[3]);
  if (!Number.isFinite(price) || price <= 0) throw new Error("腾讯场内行情暂不可用");
  const name = String(fields[1] || symbol);
  const previousClose = Number(fields[4]);
  const change = Number(fields[32]) || (previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0);
  return { symbol, name, market: "A股", price, currency: "¥", change, asOf: String(fields[30] || new Date().toISOString()), provider: "腾讯行情", suggestedCategory: suggestCategory(name) ?? "A股" };
}

async function fetchEastmoneyFundQuote(symbol: string): Promise<QuoteResult> {
  const text = await fetchText(`https://fund.eastmoney.com/pingzhongdata/${encodeURIComponent(symbol)}.js?_${Date.now()}`, "utf-8", 7000);
  const name = text.match(/var\s+fS_name\s*=\s*["']([^"']+)["']/)?.[1] || symbol;
  const trendMatch = text.match(/var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
  if (!trendMatch) throw new Error("基金净值走势暂不可用");
  const trend = JSON.parse(trendMatch[1]) as Array<{ x?: unknown; y?: unknown; equityReturn?: unknown }>;
  const latest = [...trend].reverse().find((item) => Number.isFinite(Number(item.y)) && Number(item.y) > 0);
  if (!latest) throw new Error("基金最新净值暂不可用");
  const price = Number(latest.y);
  const timestamp = Number(latest.x);
  return {
    symbol,
    name,
    market: "基金",
    price,
    currency: "¥",
    change: Number(latest.equityReturn) || 0,
    // Eastmoney timestamps are UTC milliseconds; display the fund valuation
    // date in China Standard Time so the date does not roll back by one day.
    asOf: Number.isFinite(timestamp) ? new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) : "",
    provider: "东方财富",
    suggestedCategory: suggestCategory(name),
  };
}

async function fetchEastmoneyFundHistoryQuote(symbol: string): Promise<QuoteResult> {
  const payload = await fetchJson<{ Data?: { LSJZList?: Array<{ FSRQ?: unknown; DWJZ?: unknown; JZZZL?: unknown }> } }>(`https://api.fund.eastmoney.com/f10/lsjz?fundCode=${encodeURIComponent(symbol)}&pageIndex=1&pageSize=1`, 7000);
  const latest = payload.Data?.LSJZList?.find((item) => Number(item.DWJZ) > 0);
  if (!latest) throw new Error("基金最新净值暂不可用");
  const price = Number(latest.DWJZ);
  return { symbol, name: symbol, market: "基金", price, currency: "¥", change: Number(latest.JZZZL) || 0, asOf: String(latest.FSRQ || ""), provider: "东方财富", suggestedCategory: undefined };
}

async function resolveChineseAsset(symbol: string): Promise<QuoteResult> {
  const exchange = listedExchange(symbol);
  if (exchange) {
    try { return await fetchEastmoneyListedQuote(symbol, exchange); }
    catch {
      try { return await fetchTencentListedQuote(symbol, exchange); }
      catch { /* 普通场外基金代码可能形似场内代码，继续基金搜索。 */ }
    }
  }

  try { return await fetchEastmoneyFundQuote(symbol); }
  catch { /* 净值走势接口偶发受限时，继续使用历史净值接口。 */ }

  try {
    return await fetchEastmoneyFundHistoryQuote(symbol);
  } catch {
    /* 最后再走基金搜索，兼容较新的或特殊份额代码。 */
  }

  const searchUrl = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(symbol)}`;
  const search = await fetchJson<{ Datas?: Array<{ CODE?: string; NAME?: unknown; FundBaseInfo?: { DWJZ?: unknown; SHORTNAME?: unknown; FSRQ?: unknown } }> }>(searchUrl, 7000);
  const item = search?.Datas?.find((candidate) => candidate.CODE === symbol);
  if (!item) throw new Error("未找到该基金或 A 股代码");

  if (item.FundBaseInfo) {
    const fund = item.FundBaseInfo;
    const price = Number(fund.DWJZ);
    if (!Number.isFinite(price)) throw new Error("基金最新净值暂不可用");
    const name = String(fund.SHORTNAME || item.NAME || symbol);
    return { symbol, name, market: "基金", price, currency: "¥", change: 0, asOf: String(fund.FSRQ || ""), provider: "东方财富", suggestedCategory: suggestCategory(name) };
  }

  throw new Error("A 股最新行情暂不可用");
}

async function resolveUsAsset(symbol: string, includeDetails = false): Promise<QuoteResult> {
  for (const assetClass of ["stocks", "etf"] as const) {
    try {
      const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=${assetClass}`;
      const response = await fetchJson<{ data?: { companyName?: unknown; primaryData?: { lastSalePrice?: unknown; percentageChange?: unknown; lastTradeTimestamp?: unknown } } }>(url);
      const data = response?.data;
      const rawPrice = data?.primaryData?.lastSalePrice;
      const price = Number(String(rawPrice || "").replace(/[^0-9.-]/g, ""));
      if (!data?.companyName || !Number.isFinite(price)) continue;
      const change = Number(String(data.primaryData?.percentageChange || "0").replace(/[^0-9.-]/g, "")) || 0;
      const apiName = String(data.companyName);
      let marketCap: number | undefined;
      if (includeDetails && assetClass === "stocks") {
        try {
          const summary = await fetchJson<{ data?: { summaryData?: { MarketCap?: { value?: unknown } } } }>(`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/summary?assetclass=stocks`);
          const parsed = Number(String(summary.data?.summaryData?.MarketCap?.value || "").replace(/[^0-9.-]/g, ""));
          if (Number.isFinite(parsed) && parsed > 0) marketCap = parsed;
        } catch { /* 市值是增强信息，不影响主行情。 */ }
      }
      return { symbol, name: apiName, market: "美股", price, currency: "$", change, asOf: String(data.primaryData?.lastTradeTimestamp || ""), provider: "Nasdaq", suggestedCategory: assetClass === "etf" && /QQQ|NASDAQ/i.test(`${symbol} ${apiName}`) ? "美股指数" : "美股", marketCap };
    } catch {
      // 部分证券只存在于其中一种资产类别，继续尝试下一类。
    }
  }
  throw new Error("未找到该美股或 ETF 代码");
}

async function resolveBitcoinAsset(rawSymbol: string): Promise<QuoteResult> {
  try {
    const ticker = await fetchJson<{ lastPrice?: unknown; priceChangePercent?: unknown; closeTime?: unknown }>("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT", 5000);
    const price = Number(ticker.lastPrice);
    if (!Number.isFinite(price) || price <= 0) throw new Error("Binance 比特币行情暂不可用");
    return {
      symbol: "BTC",
      name: "Bitcoin",
      market: "加密货币",
      price,
      currency: "$",
      change: Number(ticker.priceChangePercent) || 0,
      asOf: ticker.closeTime ? new Date(Number(ticker.closeTime)).toISOString() : new Date().toISOString(),
      provider: "Binance",
      suggestedCategory: "加密货币",
    };
  } catch {
    try {
      const stats = await fetchJson<{ open?: unknown; last?: unknown }>("https://api.exchange.coinbase.com/products/BTC-USD/stats", 5000);
      const price = Number(stats.last);
      const open = Number(stats.open);
      if (!Number.isFinite(price) || price <= 0) throw new Error("Coinbase 比特币行情暂不可用");
      return {
        symbol: "BTC",
        name: "Bitcoin",
        market: "加密货币",
        price,
        currency: "$",
        change: open > 0 ? ((price - open) / open) * 100 : 0,
        asOf: new Date().toISOString(),
        provider: "Coinbase",
        suggestedCategory: "加密货币",
      };
    } catch {
      const payload = await fetchJson<{ bitcoin?: { usd?: unknown; usd_24h_change?: unknown } }>("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true", 6000);
      const price = Number(payload.bitcoin?.usd);
      if (!Number.isFinite(price) || price <= 0) throw new Error("比特币行情暂不可用");
      return {
        symbol: "BTC",
        name: "Bitcoin",
        market: "加密货币",
        price,
        currency: "$",
        change: Number(payload.bitcoin?.usd_24h_change) || 0,
        asOf: new Date().toISOString(),
        provider: "CoinGecko",
        suggestedCategory: "加密货币",
      };
    }
  }
}

function resolveCashAsset(rawSymbol: string): QuoteResult {
  const symbol = normalizeCashSymbol(rawSymbol);
  if (!symbol) throw new Error("未找到该现金资产");
  return {
    symbol,
    name: symbol === "CNY" ? "人民币" : symbol === "USD" ? "美元" : "USDT",
    market: "现金",
    price: 1,
    currency: symbol === "CNY" ? "¥" : "$",
    change: 0,
    asOf: new Date().toISOString(),
    provider: "固定面值",
    suggestedCategory: "现金/类现金",
  };
}

export async function resolveAsset(rawSymbol: string, includeDetails = false): Promise<QuoteResult> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) throw new Error("代码不能为空");
  if (normalizeCashSymbol(symbol)) return resolveCashAsset(symbol);
  if (isBitcoinSymbol(symbol)) return resolveBitcoinAsset(symbol);
  return /^\d{6}$/.test(symbol) ? resolveChineseAsset(symbol) : resolveUsAsset(symbol, includeDetails);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const includeDetails = requestUrl.searchParams.get("details") === "1";
  const codes = (requestUrl.searchParams.get("codes") || "").split(",").map((code) => code.trim()).filter(Boolean).slice(0, includeDetails ? 1 : 30);
  if (!codes.length) return Response.json({ quotes: {}, errors: {} }, { status: 400 });
  const entries = await Promise.all(codes.map(async (code) => {
    try { return [code.toUpperCase(), await resolveAsset(code, includeDetails)] as const; }
    catch (error) { return [code.toUpperCase(), error instanceof Error ? error.message : "行情查询失败"] as const; }
  }));
  const quotes: Record<string, QuoteResult> = {};
  const errors: Record<string, string> = {};
  for (const [symbol, result] of entries) {
    if (typeof result === "string") errors[symbol] = result;
    else {
      // Keep both the entered alias and the canonical symbol available to
      // callers. This lets an editor normalize RMB/美元/TETHER without a
      // second lookup while preserving the original request key contract.
      quotes[symbol] = result;
      quotes[result.symbol] = result;
    }
  }
  return Response.json({ quotes, errors }, { headers: { "Cache-Control": "no-store" } });
}
