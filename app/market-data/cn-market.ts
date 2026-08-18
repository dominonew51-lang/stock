export type CnInstrumentType = "stock" | "etf" | "fund" | "index";

export type CnMarketItem = {
  symbol: string;
  name: string;
  instrumentType: CnInstrumentType;
  price: number;
  previousClose?: number;
  changeAmount?: number;
  changePercent?: number;
  quoteAt: string;
  navDate?: string;
  intraday?: Array<{ time: string; price: number }>;
  ma250?: number;
  ma250DistancePercent?: number;
  source: string;
  stale: boolean;
  indexDividendYieldPercent?: number;
  indexDividendYieldAsOf?: string;
  indexDividendYieldSource?: string;
  linkedFunds?: LinkedFundDistribution[];
};

export type LinkedFundDistribution = {
  code: string;
  name: string;
  nav: number;
  navDate: string;
  annualRate: number;
  halfYearRate: number;
  quarterRate: number;
  monthly: Array<{ month: string; date?: string; perShare: number; rate: number }>;
};

// 标普指数的公开资料不是逐笔实时字段；保留来源日期，避免把旧值误标为实时行情。
const PUBLIC_INDEX_YIELD = { value: 5.1, asOf: "2026-06-29", source: "公开市场资料" };
let linkedFundCache: { expiresAt: number; value: LinkedFundDistribution[] } | null = null;

const headers = { "User-Agent": "Mozilla/5.0 (compatible; MinimalismPortfolio/1.0)", Accept: "application/json,text/plain,*/*" };

async function fetchJson<T>(url: string, timeoutMs = 7000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`上游接口返回 ${response.status}`);
    return await response.json() as T;
  } finally { clearTimeout(timer); }
}

async function fetchText(url: string, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`上游接口返回 ${response.status}`);
    return new TextDecoder("gbk").decode(await response.arrayBuffer());
  } finally { clearTimeout(timer); }
}

async function fetchUtf8(url: string, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`上游接口返回 ${response.status}`);
    return new TextDecoder("utf-8").decode(await response.arrayBuffer());
  } finally { clearTimeout(timer); }
}

function monthKey(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(new Date(timestamp));
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

async function fetchLinkedFundDistributions(): Promise<LinkedFundDistribution[]> {
  if (linkedFundCache && linkedFundCache.expiresAt > Date.now()) return linkedFundCache.value;
  const codes = ["008163", "008164", "021056"];
  const results = await Promise.all(codes.map(async (code) => {
    try {
      const text = await fetchUtf8(`https://fund.eastmoney.com/pingzhongdata/${code}.js`);
      const name = text.match(/var fS_name = "([^"]+)"/)?.[1] || code;
      const rawTrend = text.match(/var Data_netWorthTrend = (\[[\s\S]*?\]);\/\*/)?.[1];
      if (!rawTrend) return null;
      const trend = JSON.parse(rawTrend) as Array<{ x?: number; y?: number; unitMoney?: string }>;
      const now = Date.now();
      const latest = trend.filter((point) => Number.isFinite(point.x) && point.x! <= now && Number.isFinite(point.y) && point.y! > 0).sort((a, b) => Number(a.x) - Number(b.x));
      const last = latest.at(-1);
      if (!last?.x || !last.y) return null;
      // 以“最新已确认净值日”为锚点，按自然月回溯，避免系统时间与基金净值日期错位。
      const referenceDate = new Date(last.x);
      const monthCutoff = (months: number) => {
        const date = new Date(referenceDate);
        date.setUTCMonth(date.getUTCMonth() - months);
        return date.getTime();
      };
      const cutoff = monthCutoff(12);
      const distributions = latest.map((point) => {
        const match = String(point.unitMoney || "").match(/每份派现金\s*([0-9.]+)/);
        return match && Number(point.x) >= cutoff && Number(point.x) <= Number(last.x) ? { timestamp: Number(point.x), amount: Number(match[1]) } : null;
      }).filter((item): item is { timestamp: number; amount: number } => Boolean(item));
      const annual = distributions.reduce((sum, item) => sum + item.amount, 0);
      const sixMonthCutoff = monthCutoff(6);
      const quarterCutoff = monthCutoff(3);
      const monthlyMap = new Map<string, { amount: number; date: string }>();
      distributions.forEach((item) => {
        const month = monthKey(item.timestamp);
        const current = monthlyMap.get(month);
        monthlyMap.set(month, {
          amount: (current?.amount || 0) + item.amount,
          date: new Date(item.timestamp).toISOString().slice(0, 10),
        });
      });
      const monthly: LinkedFundDistribution["monthly"] = Array.from({ length: 12 }, (_, index) => {
        const date = new Date(referenceDate);
        date.setUTCDate(1);
        date.setUTCMonth(date.getUTCMonth() - (11 - index));
        const month = monthKey(date.getTime());
        const distribution = monthlyMap.get(month);
        const perShare = distribution?.amount || 0;
        return { month, date: distribution?.date, perShare, rate: (perShare / Number(last.y)) * 100 };
      });
      return { code, name, nav: Number(last.y), navDate: new Date(last.x).toISOString().slice(0, 10), annualRate: (annual / Number(last.y)) * 100, halfYearRate: (distributions.filter((item) => item.timestamp >= sixMonthCutoff).reduce((sum, item) => sum + item.amount, 0) / Number(last.y)) * 100, quarterRate: (distributions.filter((item) => item.timestamp >= quarterCutoff).reduce((sum, item) => sum + item.amount, 0) / Number(last.y)) * 100, monthly };
    } catch { return null; }
  }));
  const value = results.filter((item): item is LinkedFundDistribution => Boolean(item));
  linkedFundCache = { value, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
  return value;
}

export function listedExchange(symbol: string) {
  if (symbol === "000922" || symbol === "000688") return "1";
  if (/^[569]/.test(symbol)) return "1";
  if (/^(?:00|20|30|15|16|18)/.test(symbol)) return "0";
  return null;
}

function listedInstrument(symbol: string): CnInstrumentType {
  if (symbol === "000922" || symbol === "000688") return "index";
  // 场内 ETF 代码常见于 15/16/18/51/56 段；159696 等必须走 A 股实时行情。
  return /^(?:15|16|18|51|56)/.test(symbol) ? "etf" : "stock";
}

function parseTrendLines(lines: unknown): Array<{ time: string; price: number }> {
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => {
    const fields = String(line).split(",");
    const price = Number(fields[1]);
    return { time: fields[0] || "", price };
  }).filter((item) => item.time && Number.isFinite(item.price) && item.price > 0);
}

async function fetchListedQuote(symbol: string, exchange: string): Promise<CnMarketItem> {
  const url = `https://push2.eastmoney.com/api/qt/stock/get?fltt=2&secid=${exchange}.${symbol}&fields=f57,f58,f43,f170,f60`;
  const payload = await fetchJson<{ data?: { f57?: unknown; f58?: unknown; f43?: unknown; f170?: unknown; f60?: unknown } }>(url);
  const data = payload.data;
  const price = Number(data?.f43);
  const previousClose = Number(data?.f60);
  if (!data || !Number.isFinite(price) || price <= 0) throw new Error("场内行情暂不可用");
  const changePercent = Number(data.f170) || (previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0);
  return {
    symbol, name: String(data.f58 || symbol), instrumentType: listedInstrument(symbol), price,
    previousClose, changeAmount: price - previousClose, changePercent,
    quoteAt: new Date().toISOString(), source: "东方财富", stale: false,
    ...(symbol === "515450" ? { indexDividendYieldPercent: PUBLIC_INDEX_YIELD.value, indexDividendYieldAsOf: PUBLIC_INDEX_YIELD.asOf, indexDividendYieldSource: PUBLIC_INDEX_YIELD.source } : {}),
  };
}

async function fetchTencentFallback(symbol: string, exchange: string): Promise<CnMarketItem> {
  const payload = (await fetchText(`https://qt.gtimg.cn/q=${exchange === "1" ? "sh" : "sz"}${symbol}`)).match(/="([^\"]+)"/)?.[1];
  if (!payload) throw new Error("腾讯场内行情暂不可用");
  const fields = payload.split("~");
  const price = Number(fields[3]);
  const previousClose = Number(fields[4]);
  if (!Number.isFinite(price) || price <= 0) throw new Error("腾讯场内行情暂不可用");
  const changePercent = Number(fields[32]) || (previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0);
  return { symbol, name: fields[1] || symbol, instrumentType: listedInstrument(symbol), price, previousClose, changeAmount: price - previousClose, changePercent, quoteAt: new Date().toISOString(), source: "腾讯行情", stale: false, ...(symbol === "515450" ? { indexDividendYieldPercent: PUBLIC_INDEX_YIELD.value, indexDividendYieldAsOf: PUBLIC_INDEX_YIELD.asOf, indexDividendYieldSource: PUBLIC_INDEX_YIELD.source } : {}) };
}

async function fetchHistory(symbol: string, exchange: string, quote: CnMarketItem) {
  try {
    const trendPayload = await fetchJson<{ data?: { trends?: unknown[] } }>(`https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${exchange}.${symbol}&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1`, 6000);
    quote.intraday = parseTrendLines(trendPayload.data?.trends);
  } catch { quote.intraday = []; }
  try {
    const klinePayload = await fetchJson<{ data?: { klines?: unknown[] } }>(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${exchange}.${symbol}&klt=101&fqt=1&lmt=260&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58`, 7000);
    const closes = (klinePayload.data?.klines || []).map((line) => Number(String(line).split(",")[2])).filter((value) => Number.isFinite(value) && value > 0);
    if (closes.length >= 250) {
      const completed = closes.slice(0, -1).slice(-250);
      const ma250 = completed.reduce((sum, value) => sum + value, 0) / completed.length;
      quote.ma250 = ma250;
      quote.ma250DistancePercent = ((quote.price - ma250) / ma250) * 100;
    }
  } catch { /* 历史接口失败时保留实时行情，不伪造 MA250 */ }
  return quote;
}

async function fetchFund(symbol: string): Promise<CnMarketItem> {
  const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(symbol)}`;
  const payload = await fetchJson<{ Datas?: Array<{ CODE?: string; NAME?: unknown; FundBaseInfo?: { DWJZ?: unknown; SHORTNAME?: unknown; FSRQ?: unknown } }> }>(url);
  const item = payload.Datas?.find((candidate) => candidate.CODE === symbol && candidate.FundBaseInfo);
  const fund = item?.FundBaseInfo;
  const price = Number(fund?.DWJZ);
  if (!item || !fund || !Number.isFinite(price)) throw new Error("未找到该基金或最新净值");
  return { symbol, name: String(fund.SHORTNAME || item.NAME || symbol), instrumentType: "fund", price, quoteAt: String(fund.FSRQ || new Date().toISOString()), navDate: String(fund.FSRQ || ""), source: "东方财富基金净值", stale: true };
}

export async function resolveCnMarketItem(rawSymbol: string, includeHistory = false) {
  const symbol = rawSymbol.trim().toUpperCase();
  const exchange = listedExchange(symbol);
  if (exchange) {
    let quote: CnMarketItem;
    try { quote = await fetchListedQuote(symbol, exchange); }
    catch { quote = await fetchTencentFallback(symbol, exchange); }
    if (symbol === "515450") quote.linkedFunds = await fetchLinkedFundDistributions();
    return includeHistory && quote.instrumentType === "stock" ? fetchHistory(symbol, exchange, quote) : quote;
  }
  return fetchFund(symbol);
}

export function chinaMarketState(now = new Date()): "open" | "lunch" | "closed" | "holiday" {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  if (weekday === "Sat" || weekday === "Sun") return "holiday";
  const total = hour * 60 + minute;
  if (total >= 570 && total < 690) return "open";
  if (total >= 690 && total < 780) return "lunch";
  if (total >= 780 && total <= 900) return "open";
  return "closed";
}
