type Market = "美股" | "A股" | "基金";
type AssetBucket = "美股指数" | "红利" | "美股" | "A股" | "加密货币" | "现金/类现金";

type QuoteResult = {
  symbol: string;
  name: string;
  market: Market;
  price: number;
  currency: "$" | "¥";
  change: number;
  asOf: string;
  provider: "东方财富" | "腾讯行情" | "Nasdaq";
  suggestedCategory?: AssetBucket;
};

const requestHeaders = { "User-Agent": "Mozilla/5.0 (compatible; HengcePortfolio/1.0)", Accept: "application/json,text/plain,*/*" };

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

async function resolveChineseAsset(symbol: string): Promise<QuoteResult> {
  const exchange = listedExchange(symbol);
  if (exchange) {
    try { return await fetchEastmoneyListedQuote(symbol, exchange); }
    catch {
      try { return await fetchTencentListedQuote(symbol, exchange); }
      catch { /* 普通场外基金代码可能形似场内代码，继续基金搜索。 */ }
    }
  }

  const searchUrl = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(symbol)}`;
  const search = await fetchJson<{ Datas?: Array<{ CODE?: string; NAME?: unknown; FundBaseInfo?: { DWJZ?: unknown; SHORTNAME?: unknown; FSRQ?: unknown } }> }>(searchUrl);
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

async function resolveUsAsset(symbol: string): Promise<QuoteResult> {
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
      return { symbol, name: symbol, market: "美股", price, currency: "$", change, asOf: String(data.primaryData?.lastTradeTimestamp || ""), provider: "Nasdaq", suggestedCategory: assetClass === "etf" && /QQQ|NASDAQ/i.test(`${symbol} ${apiName}`) ? "美股指数" : "美股" };
    } catch {
      // 部分证券只存在于其中一种资产类别，继续尝试下一类。
    }
  }
  throw new Error("未找到该美股或 ETF 代码");
}

async function resolveAsset(rawSymbol: string): Promise<QuoteResult> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) throw new Error("代码不能为空");
  return /^\d{6}$/.test(symbol) ? resolveChineseAsset(symbol) : resolveUsAsset(symbol);
}

export async function GET(request: Request) {
  const codes = (new URL(request.url).searchParams.get("codes") || "").split(",").map((code) => code.trim()).filter(Boolean).slice(0, 30);
  if (!codes.length) return Response.json({ quotes: {}, errors: {} }, { status: 400 });
  const entries = await Promise.all(codes.map(async (code) => {
    try { return [code.toUpperCase(), await resolveAsset(code)] as const; }
    catch (error) { return [code.toUpperCase(), error instanceof Error ? error.message : "行情查询失败"] as const; }
  }));
  const quotes: Record<string, QuoteResult> = {};
  const errors: Record<string, string> = {};
  for (const [symbol, result] of entries) {
    if (typeof result === "string") errors[symbol] = result;
    else quotes[symbol] = result;
  }
  return Response.json({ quotes, errors }, { headers: { "Cache-Control": "no-store" } });
}
