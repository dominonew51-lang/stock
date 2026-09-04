"use client";

import { useEffect, useMemo, useState } from "react";

type Market = "美股" | "A股" | "基金" | "加密货币" | "现金";
type AssetBucket = "美股指数" | "红利" | "美股" | "A股" | "加密货币" | "现金/类现金";
type MarketQuote = { symbol: string; name: string; market: Market; price: number; currency: "$" | "¥"; change: number; asOf: string; provider: string; suggestedCategory?: AssetBucket; marketCap?: number };
type Holding = {
  symbol: string; name: string; market: Market; price: number; currency: "$" | "¥";
  change: number; value: number; cost: number; avgCost: number; quantity: number;
  holdingDays: number; weight: number; spark: number[]; category: AssetBucket;
  quoteSource?: "api" | "demo" | "fixed" | "unavailable"; quoteProvider?: string; quoteAsOf?: string; sourceSymbol?: string;
};
type Profile = { name: string; target: string; risk: string };
type CloudPortfolioState = { holdings: Holding[]; profile: Profile; useDemoHoldings: boolean; longTermStart: string };
type SyncStatus = "loading" | "syncing" | "synced" | "offline";
type DeviceAccessState = {
  status: "checking" | "authorized" | "locked" | "error";
  source: "chatgpt" | "device" | "local" | null;
  trusted: boolean;
  setupRequired: boolean;
  message: string;
};

const assetBuckets: AssetBucket[] = ["美股指数", "红利", "美股", "A股", "加密货币", "现金/类现金"];
const bucketClasses: Record<AssetBucket, string> = { "美股指数": "c-nasdaq", "红利": "c-dividend", "美股": "c-growth", "A股":"c-ashare", "加密货币":"c-crypto", "现金/类现金": "c-cash" };
const bucketColors: Record<AssetBucket, string> = { "美股指数":"#635BFF", "红利":"#00BFA6", "美股":"#00AEEF", "A股":"#F05D5E", "加密货币":"#8B5CF6", "现金/类现金":"#FFB15C" };
type AllocationGroup = "海外" | "国内";
type AllocationSubCategory = "美股个股" | "加密货币" | "稳定币" | "美元现金" | "A股" | "红利" | "美股指数（QDII）" | "人民币现金";
const allocationSubColors: Record<AllocationSubCategory, string> = { "美股个股":"#635BFF", "加密货币":"#8B5CF6", "稳定币":"#B39DDB", "美元现金":"#94A3B8", "A股":"#E85D5D", "红利":"#00A896", "美股指数（QDII）":"#2A9D8F", "人民币现金":"#F4A261" };
function allocationClass(item: Pick<Holding,"category"|"market"|"symbol">): { group:AllocationGroup; subCategory:AllocationSubCategory } {
  const code = item.symbol.trim().toUpperCase();
  if (code === "USDT" || code === "TETHER") return { group:"海外", subCategory:"稳定币" };
  if (code === "USD" || code === "美元") return { group:"海外", subCategory:"美元现金" };
  if (code === "CNY" || code === "RMB" || code === "人民币") return { group:"国内", subCategory:"人民币现金" };
  if (item.category === "A股") return { group:"国内", subCategory:"A股" };
  if (item.category === "红利") return { group:"国内", subCategory:"红利" };
  if (item.category === "美股指数") return { group:"国内", subCategory:"美股指数（QDII）" };
  if (item.category === "加密货币" || code === "BTC" || code === "ETH") return { group:"海外", subCategory:"加密货币" };
  return { group:"海外", subCategory:"美股个股" };
}

function normalizeAssetSymbol(value: string) {
  return value.trim().toUpperCase();
}

function isBitcoinSymbol(value: string) {
  return ["BTC", "BTCUSDT", "BITCOIN", "比特币"].includes(normalizeAssetSymbol(value));
}

const cashSymbolAliases: Record<string, "CNY" | "USD" | "USDT"> = {
  CNY: "CNY", RMB: "CNY", 人民币: "CNY",
  USD: "USD", 美元: "USD",
  USDT: "USDT", TETHER: "USDT",
};

function normalizeCashSymbol(value: string) {
  return cashSymbolAliases[normalizeAssetSymbol(value)];
}

function isCashSymbol(value: string) {
  return Boolean(normalizeCashSymbol(value));
}

function mergeQuoteRecords(current: Record<string, MarketQuote>, incoming: Record<string, MarketQuote>) {
  const next = { ...current };
  Object.entries(incoming).forEach(([key, quote]) => {
    if (!quote) return;
    const requested = normalizeAssetSymbol(key);
    next[requested] = quote;
    const canonical = quote.symbol.trim().toUpperCase();
    if (canonical) next[canonical] = quote;
  });
  return next;
}

function shortFundName(name: string) {
  const clean = name.replace(/[（）()]/g, " ").replace(/\s+/g, "").trim();
  const managers = ["南方", "招商", "广发", "国泰", "华夏", "易方达", "博时", "嘉实", "鹏华", "富国", "天弘", "华安", "汇添富", "工银", "交银", "建信", "中欧", "银华"];
  const manager = managers.find((item) => clean.startsWith(item)) ?? "";
  if (/纳斯达克|纳指/.test(clean)) return `${manager}纳指` || "纳指基金";
  if (/红利低波/.test(clean)) return `${manager}红利低波` || "红利低波";
  if (/科创50/.test(clean)) return `${manager}科创50` || "科创50";
  if (/国开债/.test(clean)) return `${manager}国开债` || "国开债";
  if (/红利ETF/i.test(clean)) return `${manager}红利ETF` || "红利ETF";
  const simplified = clean
    .replace(/交易型开放式指数证券投资基金联接基金/g, "")
    .replace(/交易型开放式指数证券投资基金/g, "ETF")
    .replace(/ETF联接/g, "")
    .replace(/发起式|指数型|证券投资基金|QDII/gi, "")
    .replace(/[A-Z]$/i, "");
  return simplified.length > 12 ? `${simplified.slice(0, 11)}…` : simplified;
}

function localizedAssetName(symbol: string, name: string, market: Market) {
  const cashSymbol = normalizeCashSymbol(symbol);
  if (cashSymbol) return cashSymbol === "CNY" ? "人民币" : cashSymbol === "USD" ? "美元" : "USDT";
  if (market === "美股" || market === "加密货币") return symbol.trim().toUpperCase();
  if (market === "基金") return shortFundName(name);
  const code = symbol.trim().toUpperCase();
  const knownName: Record<string, string> = {
    "601985": "中国核电", "159696": "纳指ETF", "515450": "红利低波ETF",
    "600036": "招商银行", "000922": "中证红利", "000688": "科创50",
  };
  if (knownName[code]) return knownName[code];
  const clean = String(name || "").trim();
  return !clean || clean === code || /^[0-9.]+$/.test(clean) ? `A股 ${code}` : clean.replace(/股份有限公司|有限公司/g, "");
}
const quoteBook: Record<string, { price: number; currency: "$" | "¥"; market: Market; change: number }> = {
  QQQ: { price: 573.42, currency: "$", market: "美股", change: 0.48 },
  NVDA: { price: 182.41, currency: "$", market: "美股", change: 2.84 },
  TSLA: { price: 341.67, currency: "$", market: "美股", change: -1.28 },
  AAPL: { price: 229.18, currency: "$", market: "美股", change: 0.86 },
  "008163": { price: 1.482, currency: "¥", market: "基金", change: 0.63 },
  "600036": { price: 42.36, currency: "¥", market: "A股", change: -0.42 },
  "510880": { price: 3.462, currency: "¥", market: "基金", change: 0.37 },
  "006962": { price: 1.267, currency: "¥", market: "基金", change: 0.08 },
};

function fallbackCategory(item: Partial<Holding>): AssetBucket {
  if (isCashSymbol(item.symbol || "") || item.market === "现金") return "现金/类现金";
  const legacy = String(item.category || "");
  if (legacy === "美股纳斯达克指数") return "美股指数";
  if (legacy === "红利类资产") return "红利";
  if (legacy === "美股高成长个股") return "美股";
  if (legacy === "债券" || legacy === "现金") return "现金/类现金";
  if (legacy === "加密货币") return "加密货币";
  if (assetBuckets.includes(legacy as AssetBucket)) return legacy as AssetBucket;
  if (item.symbol === "QQQ") return "美股指数";
  if (item.symbol === "006962") return "现金/类现金";
  if (item.symbol?.trim().toUpperCase() === "BTC" || item.market === "加密货币") return "加密货币";
  if (item.market === "美股") return "美股";
  if (item.market === "A股") return "A股";
  return "红利";
}

function resolveQuote(symbol: string, category: AssetBucket, remoteQuotes: Record<string, MarketQuote> = {}) {
  const normalizedSymbol = normalizeAssetSymbol(symbol);
  const cashSymbol = normalizeCashSymbol(normalizedSymbol);
  if (cashSymbol) return { symbol: cashSymbol, name: cashSymbol === "CNY" ? "人民币" : cashSymbol === "USD" ? "美元" : "USDT", market: "现金" as const, price: 1, currency: cashSymbol === "CNY" ? "¥" as const : "$" as const, change: 0, asOf: new Date().toISOString(), provider: "固定面值", suggestedCategory: "现金/类现金" as const, quoteSource: "fixed" as const };
  const remote = remoteQuotes[normalizedSymbol];
  if (remote) return { ...remote, quoteSource: remote.price > 0 ? "api" as const : "unavailable" as const };
  const known = quoteBook[normalizedSymbol];
  if (known) return { ...known, quoteSource: "demo" as const };
  const market: Market = normalizedSymbol === "BTC" || category === "加密货币" ? "加密货币" : /^[A-Z]/.test(normalizedSymbol) || category.startsWith("美股") ? "美股" : "基金";
  const currency: "$" | "¥" = market === "美股" || market === "加密货币" ? "$" : "¥";
  return { price: 0, currency, market, change: 0, quoteSource: "unavailable" as const };
}

function recalculateHolding(item: Holding, remoteQuotes: Record<string, MarketQuote> = {}): Holding {
  const category = fallbackCategory(item);
  const quote = resolveQuote(item.symbol, category, remoteQuotes);
  const fx = quote.currency === "$" ? 7.18 : 1;
  const quantity = Number(item.quantity) || 0;
  const avgCost = category === "现金/类现金" && isCashSymbol(item.symbol) ? 1 : Number(item.avgCost) || 0;
  const cost = Math.round(avgCost * quantity * fx * 100) / 100;
  return {
    ...item,
    symbol: normalizeCashSymbol(item.symbol) ?? normalizeAssetSymbol(item.symbol),
    name: localizedAssetName(item.symbol, "name" in quote ? String(quote.name) : item.name, quote.market),
    category,
    market: quote.market,
    price: quote.price,
    currency: quote.currency,
    change: quote.change,
    quoteSource: quote.quoteSource,
    quoteProvider: "provider" in quote ? quote.provider : quote.quoteSource === "demo" ? "演示数据" : undefined,
    quoteAsOf: "asOf" in quote ? quote.asOf : undefined,
    quantity,
    cost,
    holdingDays: Math.max(0, Math.floor(Number(item.holdingDays) || 0)),
    value: Math.round(quote.price * quantity * fx),
    avgCost,
  };
}

// 公开前端不内置任何持仓或个人金额；真实数据只从本机备份或授权后的云端读取。
const initialHoldings: Holding[] = [];

type TrendMode = "return" | "profit" | "assets";
type AnalysisMode = TrendMode | "allocation";
type PortfolioSnapshot = { date: string; value: number; cost: number; returnRate: number };
type PortfolioTrend = { dates: string[]; returns: number[]; profits: number[]; costs: number[]; values: number[] };
const usCompanyNames: Record<string,string> = {
  TSLA:"Tesla", NVDA:"NVIDIA", RKLB:"Rocket Lab", PLTR:"Palantir", AVGO:"Broadcom", MSFT:"Microsoft", GOOGL:"Alphabet", AMZN:"Amazon", AMD:"AMD", TSM:"TSMC", ASTS:"AST SpaceMobile", LUNR:"Intuitive Machines", RDW:"Redwire", BA:"Boeing", LMT:"Lockheed Martin", NOC:"Northrop Grumman", RTX:"RTX", PL:"Planet Labs", META:"Meta", NFLX:"Netflix", JPM:"JPMorgan", BAC:"Bank of America", GS:"Goldman Sachs", "BRK.B":"Berkshire Hathaway", LLY:"Eli Lilly", UNH:"UnitedHealth", JNJ:"Johnson & Johnson", MRK:"Merck", XOM:"Exxon Mobil", CVX:"Chevron", COP:"ConocoPhillips", SLB:"SLB", QQQ:"Nasdaq 100 ETF", SPY:"S&P 500 ETF", DIA:"Dow Jones ETF",
};

function conciseUSCompanyName(symbol: string, name: string) {
  const ticker = normalizeAssetSymbol(symbol).replace(/\s+/g, "");
  if (usCompanyNames[ticker]) return usCompanyNames[ticker];
  const cleaned = String(name || "")
    .replace(/\b(incorporated|inc|corporation|corp|company|co|common stock|ordinary shares|class\s+[abc]|plc|limited|ltd)\b/gi, "")
    .replace(/[,.()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || ticker;
}

function holdingDisplayName(holding: Holding, quote?: MarketQuote) {
  const name = quote?.name || holding.name || holding.symbol;
  if (holding.market === "美股") return conciseUSCompanyName(holding.symbol, name);
  return localizedAssetName(holding.symbol, name, holding.market);
}
type CalendarDay = { date: string; profit: number; rate: number };
type CalendarMonth = { month: number; profit: number; rate: number; positiveRatio: number; recordedDays: number; days: CalendarDay[] };
type CalendarYear = { year: number; profit: number; rate: number; positiveRatio: number; recordedDays: number };

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function quoteDateKey(value?: string) {
  const raw = String(value || "").trim();
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? localDateKey(new Date(parsed)) : "";
}

function upsertSnapshot(history: PortfolioSnapshot[], snapshot: PortfolioSnapshot) {
  return [...history.filter((item) => item.date !== snapshot.date), snapshot]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-1825);
}

function buildPortfolioTrend(history: PortfolioSnapshot[], range: string, currentValue: number, currentCost: number): PortfolioTrend {
  const today = localDateKey();
  const liveSnapshot: PortfolioSnapshot = {
    date: today,
    value: currentValue,
    cost: currentCost,
    returnRate: currentCost > 0 ? ((currentValue - currentCost) / currentCost) * 100 : 0,
  };
  let records = upsertSnapshot(history, liveSnapshot);
  const rangeDays: Record<string, number> = { "1月":30, "3月":90, "6月":180, "1年":365 };
  if (range !== "全部") {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (rangeDays[range] ?? 365) + 1);
    const cutoffKey = localDateKey(cutoff);
    records = records.filter((item) => item.date >= cutoffKey);
  }
  return {
    dates: records.map((item) => item.date),
    values: records.map((item) => item.value),
    costs: records.map((item) => item.cost),
    returns: records.map((item) => item.returnRate),
    profits: records.map((item) => item.value - item.cost),
  };
}

function buildDailyReturns(history: PortfolioSnapshot[], currentValue: number, currentCost: number): CalendarDay[] {
  const records = upsertSnapshot(history, {
    date: localDateKey(),
    value: currentValue,
    cost: currentCost,
    returnRate: currentCost > 0 ? ((currentValue - currentCost) / currentCost) * 100 : 0,
  });
  return records.slice(1).map((item, index) => {
    const previous = records[index];
    const cashFlow = item.cost - previous.cost;
    const profit = item.value - previous.value - cashFlow;
    const rate = previous.value > 0 ? (profit / previous.value) * 100 : 0;
    return { date:item.date, profit, rate };
  });
}

function compoundRate(days: CalendarDay[]) {
  return (days.reduce((factor, item) => factor * (1 + item.rate / 100), 1) - 1) * 100;
}

function buildReturnCalendar(history: PortfolioSnapshot[], year: number, currentValue: number, currentCost: number): CalendarMonth[] {
  const daily = buildDailyReturns(history, currentValue, currentCost).filter((item) => Number(item.date.slice(0, 4)) === year);
  return Array.from({ length:12 }, (_, index) => {
    const month = index + 1;
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    const days = daily.filter((item) => item.date.startsWith(monthKey));
    const profit = days.reduce((sum, item) => sum + item.profit, 0);
    const rate = compoundRate(days);
    const positiveRatio = days.length ? (days.filter((item) => item.profit > 0).length / days.length) * 100 : 0;
    return { month, profit, rate, positiveRatio, recordedDays:days.length, days };
  });
}

function buildYearCalendar(history: PortfolioSnapshot[], currentValue: number, currentCost: number): CalendarYear[] {
  const days = buildDailyReturns(history, currentValue, currentCost);
  const currentYear = new Date().getFullYear();
  const availableYears = [...new Set(days.map((item) => Number(item.date.slice(0, 4))).filter(Number.isFinite))];
  const firstYear = Math.min(currentYear - 3, ...(availableYears.length ? availableYears : [currentYear]));
  return Array.from({ length: currentYear - firstYear + 1 }, (_, index) => firstYear + index).map((year) => {
    const yearDays = days.filter((item) => Number(item.date.slice(0, 4)) === year);
    return {
      year,
      profit: yearDays.reduce((sum, item) => sum + item.profit, 0),
      rate: compoundRate(yearDays),
      positiveRatio: yearDays.length ? yearDays.filter((item) => item.profit > 0).length / yearDays.length * 100 : 0,
      recordedDays: yearDays.length,
    };
  });
}

function trendPoints(values: number[], min: number, max: number) {
  const span = Math.max(max - min, Number.EPSILON);
  return values.map((value, index) => ({
    x: values.length === 1 ? 760 : (index / (values.length - 1)) * 760,
    y: 226 - ((value - min) / span) * 204,
  }));
}

function smoothTrendPath(values: number[], min: number, max: number) {
  const points = trendPoints(values, min, max);
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0].x} ${points[0].y}`;
  let path = `M${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const afterNext = points[index + 2] ?? next;
    const control1 = { x: current.x + (next.x - previous.x) / 6, y: current.y + (next.y - previous.y) / 6 };
    const control2 = { x: next.x - (afterNext.x - current.x) / 6, y: next.y - (afterNext.y - current.y) / 6 };
    path += ` C${control1.x} ${control1.y},${control2.x} ${control2.y},${next.x} ${next.y}`;
  }
  return path;
}

function trendAxisLabel(value: number, mode: TrendMode, step: number, extraPrecision = 0) {
  if (mode === "return") {
    const decimals = Math.min(3, Math.max(1, step < 1 ? 2 : 0) + extraPrecision);
    return `${value.toFixed(decimals)}%`;
  }
  const absolute = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (absolute >= 100000000) return `${sign}¥${(absolute / 100000000).toFixed(Math.min(2, extraPrecision + 1))}亿`;
  if (absolute >= 10000) {
    const decimals = Math.min(3, step < 1000 ? 2 : step < 10000 ? 1 : 0) + extraPrecision;
    return `${sign}¥${(absolute / 10000).toFixed(decimals)}万`;
  }
  if (absolute >= 1000) {
    const decimals = Math.min(2, step < 1000 ? 2 : 1) + extraPrecision;
    return `${sign}¥${(absolute / 1000).toFixed(decimals)}千`;
  }
  return `${sign}¥${Math.round(absolute).toLocaleString("zh-CN")}`;
}

function chartDomain(values: number[], mode: TrendMode) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return { min:0, max:mode === "return" ? 1 : 1000 };
  let rawMin = Math.min(...clean);
  let rawMax = Math.max(...clean);
  if (mode === "return" || mode === "profit") {
    rawMin = Math.min(rawMin, 0);
    rawMax = Math.max(rawMax, 0);
  }
  const rawSpan = rawMax - rawMin;
  const scale = Math.max(Math.abs(rawMax), Math.abs(rawMin), mode === "return" ? 1 : 1000);
  const minimumSpan = mode === "return" ? Math.max(1, scale * .15) : Math.max(1000, scale * .06);
  const span = Math.max(rawSpan, minimumSpan);
  const midpoint = (rawMax + rawMin) / 2;
  const padding = span * .1;
  return { min:midpoint - span / 2 - padding, max:midpoint + span / 2 + padding };
}

function PerformanceChart({ compact = false, mode = "return", trend, range = "1年" }: { compact?: boolean; mode?: TrendMode; trend: PortfolioTrend; range?: string }) {
  const primary = mode === "return" ? trend.returns : mode === "profit" ? trend.profits : trend.values;
  const secondary = mode === "assets" ? trend.costs : undefined;
  const allValues = (secondary ? [...primary, ...secondary] : primary).filter(Number.isFinite);
  const { min, max } = chartDomain(allValues, mode);
  const primaryPath = smoothTrendPath(primary, min, max);
  const secondaryPath = secondary ? smoothTrendPath(secondary, min, max) : undefined;
  const axisStep = (max - min) / 4;
  const axisValues = Array.from({length:5}, (_,index)=>max - axisStep * index);
  let labels = axisValues.map((value) => trendAxisLabel(value, mode, axisStep));
  for (let extra = 1; extra <= 3 && new Set(labels).size < labels.length; extra += 1) {
    labels = axisValues.map((value) => trendAxisLabel(value, mode, axisStep, extra));
  }
  const xLabelIndexes = Array.from({ length: Math.min(5, trend.dates.length) }, (_, index) => Math.round(index * Math.max(trend.dates.length - 1, 0) / Math.max(Math.min(5, trend.dates.length) - 1, 1)));
  const xLabels = [...new Set(xLabelIndexes)].map((index) => {
    const [year, month, day] = trend.dates[index].split("-");
    return range === "全部" ? `${year.slice(2)}/${month}/${day}` : `${month}/${day}`;
  });
  const primaryPoints = trendPoints(primary, min, max);
  const lastPrimaryPoint = primaryPoints[primaryPoints.length - 1];
  const secondaryPoints = secondary ? trendPoints(secondary, min, max) : [];
  const lastSecondaryPoint = secondaryPoints[secondaryPoints.length - 1];
  return <div className={`performance-chart ${compact ? "compact" : ""}`}>
    <div className="chart-y">{labels.map((label,index)=><span key={`${label}-${index}`}>{label}</span>)}</div>
    <svg viewBox="0 0 760 250" preserveAspectRatio="none" role="img" aria-label={`${mode === "return" ? "收益率" : mode === "profit" ? "绝对收益" : "成本投入与总市值"}走势`}>
      <defs><linearGradient id={`portfolioArea-${mode}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#dce8d0" stopOpacity=".48"/><stop offset="1" stopColor="#dce8d0" stopOpacity="0"/></linearGradient></defs>
      {primary.length > 1 && <path d={`${primaryPath} L760 250 L0 250 Z`} fill={`url(#portfolioArea-${mode})`} />}
      <path d={primaryPath} fill="none" stroke="#050505" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {secondaryPath && <path d={secondaryPath} fill="none" stroke="#d6537f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
      {lastPrimaryPoint && <circle cx={lastPrimaryPoint.x} cy={lastPrimaryPoint.y} r="5" fill="#050505" vectorEffect="non-scaling-stroke" />}
      {lastSecondaryPoint && <circle cx={lastSecondaryPoint.x} cy={lastSecondaryPoint.y} r="5" fill="#d6537f" stroke="#050505" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
    </svg>
    <div className={`chart-x ${xLabels.length === 1 ? "single" : ""}`}>{xLabels.map((label)=><span key={label}>{label}</span>)}</div>
  </div>;
}

function quoteTone(change:number) { return change >= 0 ? "up" : "down"; }

function AllocationContent({ holdings, totalValue }: { holdings:Holding[]; totalValue:number }) {
  const groups = (Object.keys({海外:0,国内:0}) as AllocationGroup[]).map((group) => ({ group, amount:0, children:[] as Array<{subCategory:AllocationSubCategory; amount:number; percent:number}> }));
  holdings.forEach((item) => { const mapped=allocationClass(item); const sub = mapped.subCategory; const group = mapped.group; const target=groups.find((g)=>g.group===group)!; target.amount += item.value; const child=target.children.find((c)=>c.subCategory===sub); if(child) child.amount += item.value; else target.children.push({subCategory:sub,amount:item.value,percent:0}); });
  groups.forEach((g)=>{g.children.forEach((c)=>c.percent=totalValue?c.amount/totalValue*100:0);});
  return <div className="allocation-switch-content allocation-progress-layout"><div className="allocation-progress-total"><span>海外 / 国内</span><strong>{totalValue ? `${((groups[0].amount/totalValue)*100).toFixed(1)}% / ${((groups[1].amount/totalValue)*100).toFixed(1)}%` : "0% / 0%"}</strong><div><i style={{width:`${totalValue?(groups[0].amount/totalValue)*100:0}%`,background:"#635BFF"}}/><i style={{width:`${totalValue?(groups[1].amount/totalValue)*100:0}%`,background:"#E85D5D"}}/></div></div><div className="allocation-progress-groups">{groups.map((g)=><section key={g.group}><header><strong>{g.group}</strong><b>{totalValue?(g.amount/totalValue*100).toFixed(1):"0.0"}%</b><small>¥{g.amount.toLocaleString("zh-CN")}</small></header><div className="allocation-progress-rows">{g.children.filter(c=>c.amount>0).map(c=><div key={c.subCategory}><div><span><i style={{background:allocationSubColors[c.subCategory]}}/>{c.subCategory}</span><b>{c.percent.toFixed(1)}%</b></div><div className="allocation-progress-track"><i style={{width:`${Math.min(100,c.percent) * (totalValue && g.amount ? totalValue/g.amount : 1)}%`,background:allocationSubColors[c.subCategory]}}/></div><small>¥{c.amount.toLocaleString("zh-CN")}</small></div>)}</div></section>)}</div></div>;
}

export default function Home() {
  const [range, setRange] = useState("1年");
  const [trendMode, setTrendMode] = useState<AnalysisMode>("return");
  const [query, setQuery] = useState("");
  const [bucketFilter, setBucketFilter] = useState<"全部" | AssetBucket>("全部");
  const [customHoldings, setCustomHoldings] = useState<Holding[]>([]);
  const [remoteQuotes, setRemoteQuotes] = useState<Record<string, MarketQuote>>({});
  const [quoteErrors, setQuoteErrors] = useState<Record<string, string>>({});
  const [useDemoHoldings, setUseDemoHoldings] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showHoldingsEditor, setShowHoldingsEditor] = useState(false);
  const [editingHoldingSymbol, setEditingHoldingSymbol] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [amountsVisible, setAmountsVisible] = useState(true);
  const [baseCurrency, setBaseCurrency] = useState<"CNY" | "USD">("CNY");
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [backupMessage, setBackupMessage] = useState("");
  const [deviceMessage, setDeviceMessage] = useState("");
  const [deviceAccess, setDeviceAccess] = useState<DeviceAccessState>({ status:"checking", source:null, trusted:false, setupRequired:false, message:"正在确认设备权限…" });
  const [setupToken, setSetupToken] = useState("");
  const [resetRequested, setResetRequested] = useState(false);
  const [accessPassword, setAccessPassword] = useState("");
  const [accessPasswordConfirm, setAccessPasswordConfirm] = useState("");
  const [accessBusy, setAccessBusy] = useState(false);
  const [showAccessPassword, setShowAccessPassword] = useState(false);
  const [longTermStart, setLongTermStart] = useState("");
  const [profile, setProfile] = useState<Profile>({ name: "", target: "12", risk: "均衡型" });
  const [assetForm, setAssetForm] = useState({ symbol: "", name: "", market: "" as Market | "", category: "美股" as AssetBucket, avgCost: "", quantity: "", holdingDays: "" });
  const [assetLookup, setAssetLookup] = useState<{ state: "idle" | "loading" | "success" | "error"; message: string }>({ state: "idle", message: "" });
  const [selectedOverviewSymbol, setSelectedOverviewSymbol] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const quoteCodes = useMemo(() => {
    const symbols = new Set<string>();
    if (useDemoHoldings) initialHoldings.forEach((item) => symbols.add(item.symbol));
    customHoldings.forEach((item) => { const symbol = item.symbol.trim().toUpperCase(); if (!isCashSymbol(symbol)) symbols.add(symbol); });
    return [...symbols].filter(Boolean).join(",");
  }, [customHoldings, useDemoHoldings]);

  const marketBySymbol = useMemo(() => {
    const result: Record<string, Market> = {};
    const source = useDemoHoldings ? initialHoldings : [];
    [...source, ...customHoldings].forEach((item) => { result[item.symbol.trim().toUpperCase()] = item.market; });
    return result;
  }, [customHoldings, useDemoHoldings]);

  const bitcoinCodes = useMemo(() => {
    const source = useDemoHoldings ? initialHoldings : [];
    const hasBitcoin = [...source, ...customHoldings].some((item) => isBitcoinSymbol(item.symbol) || item.market === "加密货币" || item.category === "加密货币");
    return hasBitcoin ? "BTC" : "";
  }, [customHoldings, useDemoHoldings]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      // Query-busting makes the browser check the new worker immediately after
      // a publish instead of waiting for its periodic background update.
      void navigator.serviceWorker.register("/sw.js?rev=20260902-quotes").catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const url = new URL(window.location.href);
    const oneTimeSetupToken = url.searchParams.get("setup") ?? "";
    const resetMode = url.searchParams.get("reset") === "1";
    setResetRequested(resetMode);
    if (oneTimeSetupToken) {
      setSetupToken(oneTimeSetupToken);
      url.searchParams.delete("setup");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
    fetch("/api/device-session", { cache:"no-store", credentials:"same-origin" })
      .then(async (response) => {
        const payload = await response.json() as { authorized?:boolean; source?:DeviceAccessState["source"]; trusted?:boolean; setupRequired?:boolean; error?:string };
        if (cancelled) return;
        if (response.ok && payload.authorized) {
          setDeviceAccess({ status:"authorized", source:payload.source ?? null, trusted:Boolean(payload.trusted), setupRequired:false, message:"" });
        } else {
          const setupRequired = Boolean(payload.setupRequired);
          setDeviceAccess({ status:"locked", source:null, trusted:false, setupRequired, message:resetMode ? "请设置新的访问密码" : setupRequired ? (oneTimeSetupToken ? "请设置你的访问密码" : "请使用一次性设置链接完成初始化") : "输入密码即可打开你的资产面板" });
        }
      })
      .catch(() => { if (!cancelled) setDeviceAccess({ status:"error", source:null, trusted:false, setupRequired:false, message:"暂时无法验证设备，请稍后重试" }); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!quoteCodes) return;
    try {
      const cached = JSON.parse(window.localStorage.getItem("hengce-quotes-cache") || "null") as { quotes?: Record<string, MarketQuote>; savedAt?: number } | null;
      // Never paint a cached A-share quote before the first live request. A
      // previous implementation could cache the prior close (for example
      // 8.85) and briefly present it as today's price after a restart.
      const cachedQuotes = cached?.quotes
        ? Object.fromEntries(Object.entries(cached.quotes).filter(([, quote]) => quote.market !== "A股"))
        : null;
      if (cached && cachedQuotes && Object.keys(cachedQuotes).length) { setRemoteQuotes((current) => mergeQuoteRecords(current, cachedQuotes)); if (cached.savedAt) setLastUpdatedAt(new Date(cached.savedAt)); }
    } catch { /* 缓存损坏时直接走实时请求 */ }
    let controller: AbortController | null = null;
    let forceChineseRefresh = true;
    const refreshQuotes = () => {
      controller?.abort();
      controller = new AbortController();
      const hour = new Date().getHours();
      let cachedSymbols = new Set<string>();
      let cachedQuotes: Record<string, MarketQuote> = {};
      let cachedSavedAt = 0;
      try {
        const stored = JSON.parse(window.localStorage.getItem("hengce-quotes-cache") || "null") as { quotes?: Record<string, MarketQuote>; savedAt?: number } | null;
        cachedQuotes = stored?.quotes || {};
        cachedSymbols = new Set(Object.keys(cachedQuotes));
        cachedSavedAt = Number(stored?.savedAt || 0);
      } catch { /* ignore */ }
      const nonBitcoinCodes = quoteCodes.split(",").filter((code) => !isBitcoinSymbol(code));
      const activeCodes = nonBitcoinCodes.filter((code) => {
        const market = marketBySymbol[code] || (/^[A-Z]/.test(code) ? "美股" : "A股");
        if (market === "美股" || market === "加密货币") return true;
        if (forceChineseRefresh) return true;
        if (!cachedSymbols.has(code)) return true;
        const cacheDate = cachedSavedAt ? localDateKey(new Date(cachedSavedAt)) : "";
        const today = localDateKey(new Date());
        if (market === "基金") return hour < 20 || cacheDate !== today || new Date(cachedSavedAt).getHours() < 20;
        const quoteDate = quoteDateKey(cachedQuotes[code]?.asOf);
        return hour < 15 || quoteDate === today || (!quoteDate && cacheDate === today && new Date(cachedSavedAt).getHours() >= 15);
      });
      if (!activeCodes.length) return;
      // Keep Chinese quotes out of the slower US watchlist/sector batch. This
      // lets A-share and fund prices replace stale local values immediately.
      const chineseCodes = activeCodes.filter((code) => {
        const market = marketBySymbol[code] || (/^[A-Z]/.test(code) ? "美股" : "A股");
        return market === "A股" || market === "基金";
      });
      const otherCodes = activeCodes.filter((code) => !chineseCodes.includes(code));
      const updatePayload = (rawPayload: unknown, requestedCodes: string[]) => {
        const payload = rawPayload as { quotes?: Record<string, MarketQuote>; errors?: Record<string, string> };
        if (payload.quotes) {
          setRemoteQuotes((current) => mergeQuoteRecords(current, payload.quotes!));
          setLastUpdatedAt(new Date());
          const stored = JSON.parse(window.localStorage.getItem("hengce-quotes-cache") || "null") as { quotes?: Record<string, MarketQuote> } | null;
          window.localStorage.setItem("hengce-quotes-cache", JSON.stringify({ quotes: mergeQuoteRecords(stored?.quotes || {}, payload.quotes), savedAt: Date.now() }));
        }
        if (requestedCodes === chineseCodes && requestedCodes.some((code) => {
          const quote = payload.quotes?.[code];
          return Boolean(quote && (quote.market === "A股" || quote.market === "基金"));
        })) forceChineseRefresh = false;
        if (payload.errors) setQuoteErrors((current) => ({ ...current, ...payload.errors }));
      };
      const requests = [chineseCodes, otherCodes].filter((codes) => codes.length).map((codes) =>
        fetch(`/api/assets?codes=${encodeURIComponent(codes.join(","))}`, { signal: controller!.signal, cache: "no-store" })
          .then((response) => response.json())
          .then((payload) => updatePayload(payload, codes))
          .catch(() => { /* 保留上一次成功行情；另一批次仍可独立完成 */ }),
      );
      void Promise.all(requests);
    };
    refreshQuotes();
    const refreshTimer = window.setInterval(refreshQuotes, Object.values(marketBySymbol).some((market) => market === "美股" || market === "加密货币") ? 60000 : 300000);
    return () => { window.clearInterval(refreshTimer); controller?.abort(); };
  }, [quoteCodes, marketBySymbol]);

  useEffect(() => {
    if (!bitcoinCodes) return;
    let controller: AbortController | null = null;
    let cancelled = false;
    const refreshBitcoinQuotes = () => {
      controller?.abort();
      controller = new AbortController();
      fetch(`/api/assets?codes=${encodeURIComponent(bitcoinCodes)}`, { signal: controller.signal, cache: "no-store" })
        .then((response) => response.json())
        .then((rawPayload) => {
          if (cancelled) return;
          const payload = rawPayload as { quotes?: Record<string, MarketQuote>; errors?: Record<string, string> };
          if (payload.quotes && Object.keys(payload.quotes).length) {
            setRemoteQuotes((current) => mergeQuoteRecords(current, payload.quotes!));
            setQuoteErrors((current) => { const next = { ...current }; delete next.BTC; return next; });
            setLastUpdatedAt(new Date());
            const stored = JSON.parse(window.localStorage.getItem("hengce-quotes-cache") || "null") as { quotes?: Record<string, MarketQuote> } | null;
            window.localStorage.setItem("hengce-quotes-cache", JSON.stringify({ quotes: mergeQuoteRecords(stored?.quotes || {}, payload.quotes), savedAt: Date.now() }));
          } else if (payload.errors?.BTC) {
            setQuoteErrors((current) => ({ ...current, BTC: payload.errors!.BTC }));
          }
        })
        .catch((error) => { if (!cancelled && error instanceof Error && error.name !== "AbortError") setQuoteErrors((current) => ({ ...current, BTC: "比特币行情暂不可用" })); });
    };
    refreshBitcoinQuotes();
    const timer = window.setInterval(refreshBitcoinQuotes, 30000);
    return () => { cancelled = true; window.clearInterval(timer); controller?.abort(); };
  }, [bitcoinCodes]);

  async function lookupAssetCode(rawSymbol: string) {
    const entered = normalizeAssetSymbol(rawSymbol);
    const symbol = entered;
    if (!symbol) return null;
    if (isCashSymbol(symbol)) {
      const quote = resolveQuote(symbol, "现金/类现金", remoteQuotes) as MarketQuote;
      setRemoteQuotes((current) => mergeQuoteRecords(current, { [symbol]: quote }));
      setQuoteErrors((current) => { const next = { ...current }; delete next[symbol]; return next; });
      return quote;
    }
    const cached = remoteQuotes[symbol];
    if (cached && cached.price > 0) return cached;
    try {
      const response = await fetch(`/api/assets?codes=${encodeURIComponent(symbol)}`, { cache: "no-store" });
      const payload = await response.json() as { quotes?: Record<string, MarketQuote>; errors?: Record<string, string> };
      const quote = payload.quotes?.[symbol];
      if (!quote) throw new Error(payload.errors?.[symbol] || "未识别该代码");
      setRemoteQuotes((current) => mergeQuoteRecords(current, { [symbol]: quote }));
      setQuoteErrors((current) => { const next = { ...current }; delete next[symbol]; return next; });
      return quote;
    } catch (error) {
      setQuoteErrors((current) => ({ ...current, [symbol]: error instanceof Error ? error.message : "查询失败" }));
      return null;
    }
  }

  async function lookupAssetFormCode() {
    if (!assetForm.symbol.trim()) return;
    setAssetLookup({ state: "loading", message: "正在识别代码并获取最新价格…" });
    const quote = await lookupAssetCode(assetForm.symbol);
    if (!quote) { setAssetLookup({ state: "error", message: quoteErrors[assetForm.symbol.trim().toUpperCase()] || "未能识别该代码，请检查后重试。" }); return; }
    const displayName = localizedAssetName(quote.symbol, quote.name, quote.market);
    setAssetForm((current) => ({ ...current, symbol: quote.symbol, name: displayName, market: quote.market, category:quote.suggestedCategory ?? (quote.market === "A股" ? "A股" : current.category), avgCost: quote.market === "现金" ? "1" : current.avgCost }));
    setAssetLookup({ state: "success", message: quote.price > 0 ? `${displayName} · ${quote.provider} · 最新价 ${quote.currency}${quote.price}` : `${displayName} 已识别 · 当前行情源暂不可用，可先保存持仓` });
  }

  useEffect(() => {
    if (!showAdd || !assetForm.symbol.trim()) { setAssetLookup({ state: "idle", message: "" }); return; }
    const timer = window.setTimeout(() => { void lookupAssetFormCode(); }, 650);
    return () => window.clearTimeout(timer);
  }, [assetForm.symbol, showAdd]);

  useEffect(() => {
    try {
      const assets = window.localStorage.getItem("hengce-custom-holdings");
      const settings = window.localStorage.getItem("hengce-profile");
      const holdingMode = window.localStorage.getItem("hengce-use-demo-holdings");
      const history = window.localStorage.getItem("hengce-portfolio-snapshots-v1");
      const savedLongTermStart = window.localStorage.getItem("hengce-long-term-start");
      if (assets) {
        const stored = JSON.parse(assets) as Holding[];
        setCustomHoldings(stored);
      }
      if (holdingMode === "false") setUseDemoHoldings(false);
      if (settings) setProfile(JSON.parse(settings) as typeof profile);
      if (history) {
        const storedHistory = JSON.parse(history) as PortfolioSnapshot[];
        setPortfolioHistory(storedHistory.filter((item) => item.date && Number.isFinite(item.value) && Number.isFinite(item.cost)));
      }
      const startDate = savedLongTermStart || localDateKey();
      setLongTermStart(startDate);
      if (!savedLongTermStart) window.localStorage.setItem("hengce-long-term-start", startDate);
    } catch { /* keep safe defaults */ }
    finally { setHistoryReady(true); }
  }, []);

  useEffect(() => {
    if (!historyReady || deviceAccess.status !== "authorized") return;
    let cancelled = false;
    setSyncStatus("loading");
    fetch("/api/portfolio", { cache:"no-store" })
      .then(async (response) => {
        const payload = await response.json() as { state?:CloudPortfolioState | null; snapshots?:PortfolioSnapshot[]; error?:string };
        if (!response.ok) throw new Error(payload.error || "无法连接云端");
        if (cancelled) return;
        if (payload.state) {
          const remoteHoldings = Array.isArray(payload.state.holdings) ? payload.state.holdings : [];
          const remoteProfile = payload.state.profile && typeof payload.state.profile === "object" ? payload.state.profile : profile;
          const remoteStart = payload.state.longTermStart || longTermStart || localDateKey();
          setCustomHoldings(remoteHoldings);
          setProfile(remoteProfile);
          setUseDemoHoldings(Boolean(payload.state.useDemoHoldings));
          setLongTermStart(remoteStart);
          window.localStorage.setItem("hengce-custom-holdings", JSON.stringify(remoteHoldings));
          window.localStorage.setItem("hengce-profile", JSON.stringify(remoteProfile));
          window.localStorage.setItem("hengce-use-demo-holdings", String(Boolean(payload.state.useDemoHoldings)));
          window.localStorage.setItem("hengce-long-term-start", remoteStart);
        } else {
          await fetch("/api/portfolio", {
            method:"PUT", headers:{ "content-type":"application/json" },
            body:JSON.stringify({ holdings:customHoldings, profile, useDemoHoldings, longTermStart:longTermStart || localDateKey() }),
          });
        }
        const remoteSnapshots = Array.isArray(payload.snapshots) ? payload.snapshots : [];
        if (remoteSnapshots.length) {
          setPortfolioHistory(remoteSnapshots);
          window.localStorage.setItem("hengce-portfolio-snapshots-v1", JSON.stringify(remoteSnapshots));
        } else if (portfolioHistory.length) {
          await fetch("/api/portfolio/snapshots", {
            method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ snapshots:portfolioHistory }),
          });
        }
        if (!cancelled) { setCloudReady(true); setSyncStatus("synced"); }
      })
      .catch(() => { if (!cancelled) setSyncStatus("offline"); });
    return () => { cancelled = true; };
  }, [deviceAccess.status, historyReady]);

  useEffect(() => {
    if (!cloudReady) return;
    const timer = window.setTimeout(() => {
      setSyncStatus("syncing");
      window.localStorage.setItem("hengce-custom-holdings", JSON.stringify(customHoldings));
      window.localStorage.setItem("hengce-profile", JSON.stringify(profile));
      window.localStorage.setItem("hengce-use-demo-holdings", String(useDemoHoldings));
      if (longTermStart) window.localStorage.setItem("hengce-long-term-start", longTermStart);
      fetch("/api/portfolio", {
        method:"PUT", headers:{ "content-type":"application/json" },
        body:JSON.stringify({ holdings:customHoldings, profile, useDemoHoldings, longTermStart }),
      }).then((response) => {
        if (!response.ok) throw new Error("sync failed");
        setSyncStatus("synced");
      }).catch(() => setSyncStatus("offline"));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [cloudReady, customHoldings, longTermStart, profile, useDemoHoldings]);

  const allHoldings = useMemo(() => {
    const merged = new Map<string, Holding>();
    if (useDemoHoldings) initialHoldings.forEach((item) => merged.set(item.symbol, recalculateHolding(item, remoteQuotes)));
    customHoldings.forEach((item) => {
      if (item.sourceSymbol && item.sourceSymbol !== item.symbol) merged.delete(item.sourceSymbol);
      const legacyFx = item.currency === "$" ? 7.18 : 1;
      const inferredAvgCost = item.avgCost ?? (item.cost && item.quantity ? item.cost / item.quantity / legacyFx : item.price);
      const normalized = recalculateHolding({
      ...item,
      category: item.category ?? fallbackCategory(item),
      avgCost: inferredAvgCost,
      quantity: item.quantity ?? Math.max(1, Math.round(item.value / Math.max(item.price, 1))),
      holdingDays: item.holdingDays ?? 0,
      }, remoteQuotes);
      merged.set(normalized.symbol, normalized);
    });
    return [...merged.values()];
  }, [customHoldings, remoteQuotes, useDemoHoldings]);
  const totalValue = allHoldings.reduce((sum, item) => sum + item.value, 0);
  const totalCost = allHoldings.reduce((sum, item) => sum + item.cost, 0);
  const profit = totalValue - totalCost;
  const profitRate = totalCost > 0 ? (profit / totalCost) * 100 : 0;
  const dailyProfit = allHoldings.reduce((sum, item) => {
    if (item.quoteSource === "unavailable" || item.value <= 0) return sum;
    const changeFactor = 1 + item.change / 100;
    if (changeFactor <= 0) return sum;
    const previousValue = item.value / changeFactor;
    return sum + (item.value - previousValue);
  }, 0);
  const previousPortfolioValue = totalValue - dailyProfit;
  const dailyReturn = previousPortfolioValue > 0 ? (dailyProfit / previousPortfolioValue) * 100 : 0;

  useEffect(() => {
    if (!historyReady || totalCost <= 0 || totalValue <= 0) return;
    let snapshotTimer: number | undefined;
    const persistSnapshot = (date: string) => {
      const snapshot: PortfolioSnapshot = {
        date,
        value: totalValue,
        cost: totalCost,
        returnRate: ((totalValue - totalCost) / totalCost) * 100,
      };
      setPortfolioHistory((current) => {
        const next = upsertSnapshot(current, snapshot);
        try { window.localStorage.setItem("hengce-portfolio-snapshots-v1", JSON.stringify(next)); } catch { /* keep the live chart available */ }
        return next;
      });
      if (cloudReady) {
        void fetch("/api/portfolio/snapshots", {
          method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ snapshots:[snapshot] }),
        }).then((response) => { if (!response.ok) throw new Error("snapshot sync failed"); setSyncStatus("synced"); }).catch(() => setSyncStatus("offline"));
      }
    };
    const scheduleNextSnapshot = () => {
      const now = new Date();
      const target = new Date(now);
      target.setHours(23, 59, 0, 0);
      if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
      snapshotTimer = window.setTimeout(() => {
        persistSnapshot(localDateKey(target));
        scheduleNextSnapshot();
      }, target.getTime() - now.getTime());
    };
    const now = new Date();
    if (now.getHours() === 23 && now.getMinutes() === 59) persistSnapshot(localDateKey(now));
    scheduleNextSnapshot();
    return () => { if (snapshotTimer) window.clearTimeout(snapshotTimer); };
  }, [cloudReady, historyReady, totalCost, totalValue]);

  const portfolioTrend = useMemo(() => buildPortfolioTrend(portfolioHistory, range, totalValue, totalCost), [portfolioHistory, range, totalCost, totalValue]);
  const monthTrend = useMemo(() => buildPortfolioTrend(portfolioHistory, "1月", totalValue, totalCost), [portfolioHistory, totalCost, totalValue]);
  const latestReturn = portfolioTrend.returns[portfolioTrend.returns.length - 1] || 0;
  const currentMonth = localDateKey().slice(0, 7);
  const monthStartIndex = monthTrend.dates.findIndex((date) => date.startsWith(currentMonth));
  const monthStartProfit = monthStartIndex >= 0 ? monthTrend.values[monthStartIndex] - monthTrend.costs[monthStartIndex] : profit;
  const monthStartCost = monthStartIndex >= 0 ? monthTrend.costs[monthStartIndex] : totalCost;
  const monthlyProfit = profit - monthStartProfit;
  const monthlyReturn = monthStartCost > 0 ? (monthlyProfit / monthStartCost) * 100 : 0;
  const longTermStartDate = longTermStart ? new Date(`${longTermStart}T00:00:00`) : new Date();
  const todayStart = new Date(`${localDateKey()}T00:00:00`);
  const longTermDays = Math.max(1, Math.floor((todayStart.getTime() - longTermStartDate.getTime()) / 86400000) + 1);
  const selectedTrendMode: TrendMode = trendMode === "allocation" ? "return" : trendMode;
  const trendView = {
    return: { description:"按每日资产快照计算", primary:"组合收益率", primaryValue:`${latestReturn >= 0 ? "+" : ""}${latestReturn.toFixed(2)}%`, secondary:"", secondaryValue:"", note:`云端每日 23:59 自动保存 · ${portfolioTrend.dates.length} 个日期` },
    profit: { description:"每日总市值减去成本投入", primary:"绝对收益", primaryValue:`${profit >= 0 ? "+" : ""}¥${profit.toLocaleString("zh-CN")}`, secondary:"", secondaryValue:"", note:`当前累计盈亏 ${profit >= 0 ? "+" : ""}¥${profit.toLocaleString("zh-CN")}` },
    assets: { description:"总市值与成本投入同图对照", primary:"总市值", primaryValue:`¥${totalValue.toLocaleString("zh-CN")}`, secondary:"成本投入", secondaryValue:`¥${totalCost.toLocaleString("zh-CN")}`, note:`浮动盈亏 ${profit >= 0 ? "+" : ""}¥${profit.toLocaleString("zh-CN")}` },
  }[selectedTrendMode];
  const shownTotal = baseCurrency === "CNY" ? totalValue : totalValue / 7.18;
  const shownDailyProfit = baseCurrency === "CNY" ? dailyProfit : dailyProfit / 7.18;
  const currencySymbol = baseCurrency === "CNY" ? "¥" : "$";
  const filteredHoldings = useMemo(() => allHoldings.filter((item) => {
    const keyword = query.trim().toLowerCase();
    const bucketMatch = bucketFilter === "全部" || item.category === bucketFilter;
    return bucketMatch && (!keyword || item.name.toLowerCase().includes(keyword) || item.symbol.toLowerCase().includes(keyword));
  }), [allHoldings, bucketFilter, query]);
  const selectedOverviewHolding = selectedOverviewSymbol ? allHoldings.find((item) => item.symbol === selectedOverviewSymbol) : undefined;

  function addHolding(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const avgCost = Number(assetForm.avgCost); const quantity = Number(assetForm.quantity); const holdingDays = Number(assetForm.holdingDays);
    if (!assetForm.symbol || !assetForm.name || avgCost < 0 || quantity <= 0 || holdingDays < 0) return;
    const next = recalculateHolding({ symbol: assetForm.symbol, name: assetForm.name, category: assetForm.category, market: assetForm.market || "基金", price: 0, currency: assetForm.market === "美股" || assetForm.market === "加密货币" ? "$" : "¥", change: 0, value: 0, cost: 0, avgCost, quantity, holdingDays, weight: 0, spark: [35,35,35,35,35,35,35,35,35,35] }, remoteQuotes);
    const merged = new Map(customHoldings.map((item) => [item.symbol, item])); merged.set(next.symbol, next);
    const updated = [...merged.values()]; setCustomHoldings(updated);
    window.localStorage.setItem("hengce-custom-holdings", JSON.stringify(updated));
    setAssetForm({ symbol: "", name: "", market: "", category: "美股", avgCost: "", quantity: "", holdingDays: "" }); setAssetLookup({ state: "idle", message: "" }); setShowAdd(false);
  }

  function saveHoldings(edits: { item: Holding; originalSymbol: string }[]) {
    let updated = [...customHoldings];
    const quoteOverrides: Record<string, MarketQuote> = {};
    edits.forEach(({ item }) => {
      if (item.price <= 0 || !item.symbol.trim()) return;
      const symbol = normalizeAssetSymbol(item.symbol);
      quoteOverrides[symbol] = {
        symbol,
        name: item.name,
        market: item.market,
        price: item.price,
        currency: item.currency,
        change: item.change,
        asOf: item.quoteAsOf || new Date().toISOString(),
        provider: (item.quoteProvider as MarketQuote["provider"]) || "Coinbase",
        suggestedCategory: item.category,
      };
    });
    const effectiveQuotes = mergeQuoteRecords(remoteQuotes, quoteOverrides);
    edits.forEach(({ item, originalSymbol }) => {
      const sourceSymbol = originalSymbol && originalSymbol !== item.symbol ? originalSymbol : item.sourceSymbol;
      const normalized = recalculateHolding({ ...item, sourceSymbol }, effectiveQuotes);
      updated = updated.filter((holding) => holding.symbol !== originalSymbol && holding.symbol !== normalized.symbol && holding.sourceSymbol !== originalSymbol);
      updated.push(normalized);
    });
    if (Object.keys(quoteOverrides).length) setRemoteQuotes((current) => mergeQuoteRecords(current, quoteOverrides));
    setCustomHoldings(updated);
    window.localStorage.setItem("hengce-custom-holdings", JSON.stringify(updated));
  }

  function deleteHolding(symbol: string) {
    const updated = customHoldings.filter((holding) => holding.symbol !== symbol && holding.sourceSymbol !== symbol);
    setCustomHoldings(updated);
    window.localStorage.setItem("hengce-custom-holdings", JSON.stringify(updated));
    setSelectedOverviewSymbol((current) => current === symbol ? null : current);
  }

  function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); window.localStorage.setItem("hengce-profile", JSON.stringify(profile)); setShowSettings(false);
  }

  async function trustCurrentDevice() {
    setDeviceMessage("正在授权此设备…");
    try {
      const response = await fetch("/api/device-session", { method:"POST", credentials:"same-origin" });
      const payload = await response.json() as { trusted?:boolean; error?:string };
      if (!response.ok || !payload.trusted) throw new Error(payload.error || "设备授权失败");
      setDeviceAccess((current) => ({ ...current, status:"authorized", source:"device", trusted:true, setupRequired:false }));
      setDeviceMessage("已信任此设备，未来 180 天可以直接打开。 ");
    } catch (error) {
      setDeviceMessage(error instanceof Error ? error.message : "设备授权失败，请重试");
    }
  }

  async function submitDeviceAccess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const settingUp = (deviceAccess.setupRequired || resetRequested) && Boolean(setupToken);
    if (!accessPassword) return;
    if (settingUp && accessPassword.length < 10) {
      setDeviceAccess((current) => ({ ...current, message:"密码至少需要 10 个字符" }));
      return;
    }
    if (settingUp && accessPassword !== accessPasswordConfirm) {
      setDeviceAccess((current) => ({ ...current, message:"两次输入的密码不一致" }));
      return;
    }
    setAccessBusy(true);
    setDeviceAccess((current) => ({ ...current, message:resetRequested ? "正在重置密码…" : settingUp ? "正在安全设置…" : "正在验证…" }));
    try {
      const response = await fetch(resetRequested ? "/api/device-session/reset" : settingUp ? "/api/device-session/setup" : "/api/device-session/login", {
        method:"POST",
        credentials:"same-origin",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify(settingUp ? { setupToken, password:accessPassword } : { password:accessPassword }),
      });
      const payload = await response.json() as { trusted?:boolean; error?:string };
      if (!response.ok || !payload.trusted) throw new Error(payload.error || "验证失败");
      setSetupToken("");
      setAccessPassword("");
      setAccessPasswordConfirm("");
      setDeviceAccess({ status:"authorized", source:"device", trusted:true, setupRequired:false, message:"" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "验证失败，请重试";
      const passwordAlreadySet = /已经设置/.test(message);
      setDeviceAccess((current) => ({ ...current, status:"locked", setupRequired:passwordAlreadySet ? false : current.setupRequired, message }));
      if (passwordAlreadySet) setSetupToken("");
    } finally {
      setAccessBusy(false);
    }
  }

  function exportBackup() {
    const backup = {
      version:1,
      exportedAt:new Date().toISOString(),
      holdings:customHoldings,
      profile,
      useDemoHoldings,
      longTermStart,
      snapshots:portfolioHistory,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type:"application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `minimalism-backup-${localDateKey()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setBackupMessage("备份已下载，可在正式网页中导入。 ");
  }

  async function importBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBackupMessage("正在导入并同步…");
    try {
      const backup = JSON.parse(await file.text()) as Partial<CloudPortfolioState> & { snapshots?:PortfolioSnapshot[] };
      if (!Array.isArray(backup.holdings)) throw new Error("备份文件中没有持仓数据");
      const importedProfile = backup.profile && typeof backup.profile === "object" ? backup.profile : profile;
      const importedStart = typeof backup.longTermStart === "string" && backup.longTermStart ? backup.longTermStart : localDateKey();
      const importedSnapshots = Array.isArray(backup.snapshots) ? backup.snapshots.filter((item) => item.date && Number.isFinite(item.value) && Number.isFinite(item.cost)) : [];
      setCustomHoldings(backup.holdings);
      setProfile(importedProfile);
      setUseDemoHoldings(Boolean(backup.useDemoHoldings));
      setLongTermStart(importedStart);
      setPortfolioHistory(importedSnapshots);
      window.localStorage.setItem("hengce-custom-holdings", JSON.stringify(backup.holdings));
      window.localStorage.setItem("hengce-profile", JSON.stringify(importedProfile));
      window.localStorage.setItem("hengce-use-demo-holdings", String(Boolean(backup.useDemoHoldings)));
      window.localStorage.setItem("hengce-long-term-start", importedStart);
      window.localStorage.setItem("hengce-portfolio-snapshots-v1", JSON.stringify(importedSnapshots));
      const stateResponse = await fetch("/api/portfolio", {
        method:"PUT", headers:{ "content-type":"application/json" },
        body:JSON.stringify({ holdings:backup.holdings, profile:importedProfile, useDemoHoldings:Boolean(backup.useDemoHoldings), longTermStart:importedStart }),
      });
      if (!stateResponse.ok) throw new Error("云端保存失败");
      if (importedSnapshots.length) {
        const snapshotResponse = await fetch("/api/portfolio/snapshots", {
          method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ snapshots:importedSnapshots }),
        });
        if (!snapshotResponse.ok) throw new Error("历史快照保存失败");
      }
      setCloudReady(true);
      setSyncStatus("synced");
      setBackupMessage(`已导入 ${backup.holdings.length} 项持仓并同步到云端。`);
    } catch (error) {
      setSyncStatus("offline");
      setBackupMessage(error instanceof Error ? error.message : "导入失败，请检查备份文件");
    } finally { event.target.value = ""; }
  }

  if (deviceAccess.status !== "authorized") {
    const settingUp = (deviceAccess.setupRequired || resetRequested) && Boolean(setupToken);
    return <main className="device-access-shell">
      <section className="device-access-card" aria-busy={deviceAccess.status === "checking" || accessBusy}>
        <aside className="device-access-visual" aria-hidden="true">
          <div className="device-access-wordmark"><span>M.</span><small>MINIMALISM</small></div>
          <div className="device-access-thesis"><span>PRIVATE PORTFOLIO</span><strong>只看重要的。<br />其余交给时间。</strong><p>你的持仓、收益与配置，都留在一个安静的视野里。</p></div>
          <div className="portfolio-orbit">
            <svg viewBox="0 0 260 260" role="img">
              <circle className="orbit-track" cx="130" cy="130" r="94" />
              <circle className="orbit-segment orbit-a" cx="130" cy="130" r="94" pathLength="100" />
              <circle className="orbit-segment orbit-b" cx="130" cy="130" r="72" pathLength="100" />
              <circle className="orbit-track inner" cx="130" cy="130" r="50" />
              <path className="orbit-trend" d="M76 151 C96 151 105 129 121 136 C140 145 149 99 185 104" />
            </svg>
            <span><b>长期</b><small>比预测更重要</small></span>
          </div>
          <div className="device-access-facts"><span><b>180 天</b><small>设备信任</small></span><span><b>Private</b><small>个人访问</small></span></div>
        </aside>
        <div className="device-access-content">
          <div className="device-access-mobile-brand"><span>M.</span><small>MINIMALISM</small></div>
          <header><p>PRIVATE ACCESS</p><h1>{deviceAccess.status === "checking" ? "正在确认设备" : resetRequested ? "重置访问密码" : settingUp ? "设置访问密码" : "欢迎回来"}</h1></header>
          <div className={`device-access-message ${deviceAccess.status === "error" ? "is-error" : ""}`} role="status" aria-live="polite">{deviceAccess.status === "checking" && <i className="device-access-loader" />}{deviceAccess.message}</div>
          {deviceAccess.status !== "checking" && (!deviceAccess.setupRequired || settingUp || resetRequested) && <form className="device-access-form" onSubmit={(event)=>void submitDeviceAccess(event)}>
            <label><span>{settingUp ? "创建密码" : "访问密码"}</span><div className="device-password-field"><input type={showAccessPassword ? "text" : "password"} autoComplete={settingUp ? "new-password" : "current-password"} minLength={settingUp ? 10 : undefined} value={accessPassword} onChange={(event)=>setAccessPassword(event.target.value)} placeholder={settingUp ? "至少 10 个字符" : "输入你的密码"} autoFocus /><button type="button" onClick={()=>setShowAccessPassword((current)=>!current)} aria-label={showAccessPassword ? "隐藏密码" : "显示密码"} aria-pressed={showAccessPassword}>{showAccessPassword ? "隐藏" : "显示"}</button></div></label>
            {settingUp && <label><span>确认密码</span><div className="device-password-field"><input type={showAccessPassword ? "text" : "password"} autoComplete="new-password" minLength={10} value={accessPasswordConfirm} onChange={(event)=>setAccessPasswordConfirm(event.target.value)} placeholder="再次输入密码" /></div></label>}
            <button className="device-access-submit" type="submit" disabled={accessBusy || !accessPassword}><span>{accessBusy ? "正在验证" : resetRequested ? "重置并进入" : settingUp ? "设置并进入" : "进入资产面板"}</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 6l4 4-4 4" /></svg></button>
          </form>}
          {deviceAccess.setupRequired && !setupToken && deviceAccess.status !== "checking" && <div className="device-setup-needed">首次使用需要通过一次性设置链接创建访问密码。</div>}
          <div className="device-access-footnote"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="8.5" width="11" height="8" rx="2" /><path d="M7 8.5V6a3 3 0 0 1 6 0v2.5" /></svg><span>验证成功后，此设备将保持登录 180 天。</span></div>
        </div>
      </section>
    </main>;
  }

  return <main className="app-shell overview-only">
    <section className="workspace">
      <header className="topbar">
        <div><div className="topbar-title-line"><h1>Minimalism</h1><span className="long-term-inline">坚持长期主义 <b>{longTermDays}</b> 天</span></div><div className="topbar-meta"><span className="page-kicker">PRIVATE PORTFOLIO</span><span className="topbar-updated">{lastUpdatedAt ? `更新于 ${lastUpdatedAt.toLocaleTimeString("zh-CN", { hour:"2-digit", minute:"2-digit" })}` : "等待数据"}</span></div></div>
        <div className="top-actions"><button className="icon-btn" aria-label="偏好设置" onClick={() => setShowSettings(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"/><path d="m19.2 13.2 1.2.9-1.8 3.1-1.4-.6a7.6 7.6 0 0 1-1.8 1l-.2 1.6h-3.6l-.2-1.6a7.6 7.6 0 0 1-1.8-1l-1.4.6-1.8-3.1 1.2-.9a7.7 7.7 0 0 1 0-2.4l-1.2-.9 1.8-3.1 1.4.6a7.6 7.6 0 0 1 1.8-1l.2-1.6h3.6l.2 1.6a7.6 7.6 0 0 1 1.8 1l1.4-.6 1.8 3.1-1.2.9a7.7 7.7 0 0 1 0 2.4Z"/></svg></button></div>
      </header>
      <>
        <section className="overview-hero">
          <section className="summary-card">
            <div className="summary-main">
              <div className="eyebrow">总资产（{baseCurrency}）<button onClick={() => setAmountsVisible(!amountsVisible)} aria-label="显示或隐藏金额">{amountsVisible ? "◉" : "○"}</button></div>
              <div className="total">{amountsVisible ? `${currencySymbol} ${shownTotal.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}` : "••••••••"}<span className="live-pill">实时</span></div>
              <div className={`pnl ${dailyProfit >= 0 ? "up" : "down"}`}><span>今日盈亏</span><strong>{dailyProfit >= 0 ? "+" : "-"}{currencySymbol} {Math.abs(shownDailyProfit).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</strong><em>{dailyReturn >= 0 ? "+" : ""}{dailyReturn.toFixed(2)}%</em><small>{dailyProfit > 0 ? "↗" : dailyProfit < 0 ? "↘" : "→"}</small></div>
              <div className="currency-toggle"><button className={baseCurrency === "CNY" ? "active" : ""} onClick={() => setBaseCurrency("CNY")}>CNY</button><button className={baseCurrency === "USD" ? "active" : ""} onClick={() => setBaseCurrency("USD")}>USD</button></div>
            </div>
            <div className="summary-stats">
              <div><span>当月收益</span><strong className={monthlyReturn >= 0 ? "up" : "down"}>{monthlyReturn >= 0 ? "+" : ""}{monthlyReturn.toFixed(2)}%</strong><small>本月 {monthlyProfit >= 0 ? "+" : "-"}¥ {Math.abs(monthlyProfit).toLocaleString("zh-CN")}</small></div>
              <div><span>今年收益</span><strong className={profitRate >= 0 ? "up" : "down"}>{profitRate >= 0 ? "+" : ""}{profitRate.toFixed(2)}%</strong><small>收益 {profit >= 0 ? "+" : "-"}¥ {Math.abs(profit).toLocaleString("zh-CN")}</small></div>
              <div><span>历史收益</span><strong className={profitRate >= 0 ? "up" : "down"}>{profitRate >= 0 ? "+" : ""}{profitRate.toFixed(2)}%</strong><small>累计 {profit >= 0 ? "+" : "-"}¥ {Math.abs(profit).toLocaleString("zh-CN")}</small></div>
              <div><span>投入本金</span><strong>¥ {totalCost.toLocaleString("zh-CN")}</strong><small>{allHoldings.length} 项资产</small></div>
            </div>
          </section>
          <article className="panel performance-panel analysis-panel">
            <div className="panel-head trend-head"><div><h2>资产分析</h2><p>{trendMode === "allocation" ? "按当前持仓市值实时统计" : trendView.description}</p></div><div className="trend-controls"><div className="trend-switch">{([['return','收益率'],['profit','收益'],['assets','市值'],['allocation','比例']] as [AnalysisMode,string][]).map(([id,label])=><button key={id} className={trendMode === id ? "selected" : ""} onClick={()=>setTrendMode(id)}>{label}</button>)}</div></div></div>
            {trendMode === "allocation" ? <AllocationContent holdings={allHoldings} totalValue={totalValue} /> : <><div className="chart-legend"><span><i className="legend-value" />{trendView.primary} <b className={selectedTrendMode !== "assets" ? (profit >= 0 ? "up" : "down") : ""}>{trendView.primaryValue}</b></span>{trendView.secondary && <span><i className="legend-cost" />{trendView.secondary} <b>{trendView.secondaryValue}</b></span>}<span className="chart-note">{trendView.note}</span></div><PerformanceChart mode={selectedTrendMode} trend={portfolioTrend} range={range} /></>}
          </article>
        </section>
        <section className="panel overview-heatmap-section"><div className="section-inline-head"><div><h2>持仓热力图</h2><p>面积按持仓市值，颜色按历史收益；点击查看持仓详情</p></div><button className="heatmap-edit-btn" onClick={() => { setEditingHoldingSymbol(null); setShowHoldingsEditor(true); }}>{showHoldingsEditor ? "关闭管理" : "管理持仓"}</button></div><HoldingsHeatmap holdings={allHoldings} onSelect={setSelectedOverviewSymbol} includeAll /></section>
        {selectedOverviewHolding && <PortfolioQuickCard symbol={selectedOverviewHolding.symbol} quote={remoteQuotes[selectedOverviewHolding.symbol]} holding={selectedOverviewHolding} onClose={()=>setSelectedOverviewSymbol(null)} />}
        {showHoldingsEditor && <HoldingEditorDrawer holdings={allHoldings} quotes={remoteQuotes} initialSymbol={editingHoldingSymbol} onLookup={lookupAssetCode} onSaveAll={saveHoldings} onDelete={deleteHolding} onClose={()=>{ setShowHoldingsEditor(false); setEditingHoldingSymbol(null); }} />}
      </>
      </section>

    {showAdd && <Modal title="添加一项持仓" eyebrow="PERSONAL PORTFOLIO" description="输入代码后自动显示全名和市场；持仓总成本由均价 × 数量计算。" onClose={() => setShowAdd(false)}><form className="modal-form" onSubmit={addHolding}>
      <label className="wide">代码<input required value={assetForm.symbol} onChange={(event)=>setAssetForm({...assetForm,symbol:event.target.value,market:"",name:""})} placeholder="CNY / USD / USDT / 021000 / AAPL" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off" /><small>停止输入约半秒后自动查询；现金代码无需行情接口</small></label>
      <div className="resolved-identity wide"><span><small>持仓名称</small><strong>{assetLookup.state === "loading" ? "正在识别…" : assetForm.name || "输入代码后自动显示"}</strong></span><span><small>市场种类</small><strong className={assetForm.market ? `market-${assetForm.market}` : ""}>{assetForm.market || "待识别"}</strong></span></div>
      <input type="hidden" required value={assetForm.name} readOnly />
      <label className="wide">资产分类（由你选择）<select value={assetForm.category} disabled={assetForm.market === "现金"} onChange={(event)=>setAssetForm({...assetForm,category:event.target.value as AssetBucket})}>{assetBuckets.map((item)=><option key={item}>{item}</option>)}</select></label>
      <label>{assetForm.market === "现金" ? "现金面值" : `持仓均价（${assetForm.market === "美股" || assetForm.market === "加密货币" ? "USD" : "CNY"}）`}<input required type="number" min="0" step="any" value={assetForm.market === "现金" ? "1" : assetForm.avgCost} readOnly={assetForm.market === "现金"} onChange={(event)=>setAssetForm({...assetForm,avgCost:event.target.value})} /></label>
      <label>{assetForm.market === "现金" ? "余额" : "持仓数"}<input required type="number" min="0.00000001" step="any" value={assetForm.quantity} onChange={(event)=>setAssetForm({...assetForm,quantity:event.target.value})} /></label>
      <div className={`api-form-note wide ${assetLookup.state}`}>{assetLookup.state === "idle" ? "行情来源：东方财富、Nasdaq、Binance。" : assetLookup.message}</div><ModalActions onCancel={()=>setShowAdd(false)} label="保存到持仓" />
    </form></Modal>}
    {showSettings && <Modal title="个人偏好" eyebrow="PERSONAL SETTINGS" description="偏好与持仓会安全同步到你的私人面板。" onClose={() => setShowSettings(false)}><form className="modal-form" onSubmit={saveProfile}><label className="wide">你的称呼<input value={profile.name} onChange={(event)=>setProfile({...profile,name:event.target.value})} /></label><label>年度目标（%）<input type="number" value={profile.target} onChange={(event)=>setProfile({...profile,target:event.target.value})} /></label><label>风险偏好<select value={profile.risk} onChange={(event)=>setProfile({...profile,risk:event.target.value})}><option>稳健型</option><option>均衡型</option><option>进取型</option></select></label><div className="device-trust-tools wide"><div><strong>快速打开</strong><small>{deviceAccess.trusted ? "此设备已受信任，180 天内无需再次登录" : "信任本设备后，未来 180 天可以直接打开"}</small></div>{!deviceAccess.trusted && <button type="button" onClick={()=>void trustCurrentDevice()}>信任此设备</button>}{deviceMessage && <p>{deviceMessage}</p>}</div><div className="backup-tools wide"><div><strong>数据备份与迁移</strong><small>首次从 localhost 迁移到正式网页时使用一次</small></div><button type="button" onClick={exportBackup}>导出备份</button><label className="import-backup-button">导入并同步<input type="file" accept="application/json,.json" onChange={(event)=>void importBackup(event)} /></label>{backupMessage && <p>{backupMessage}</p>}</div><ModalActions onCancel={()=>setShowSettings(false)} label="保存偏好" /></form></Modal>}
  </main>;
}

function HoldingsHeatmap({ holdings, onSelect, includeAll = false }: { holdings: Holding[]; onSelect: (symbol: string) => void; includeAll?: boolean }) {
  const items = holdings.filter((item) => (includeAll || item.market === "美股") && item.value > 0).sort((a, b) => b.value - a.value);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!items.length) return <div className="empty-state">暂无{includeAll ? "" : "美股"}持仓，添加后会在这里显示组合热力图。</div>;
  const layout = rowTreemap(items.map((item) => item.value));
  return <div className="portfolio-treemap">{items.map((item, index) => {
    const rectangle = layout[index];
    const percentage = total > 0 ? item.value / total * 100 : 0;
    const profit = item.value - item.cost;
    const historyRate = item.cost > 0 ? profit / item.cost * 100 : 0;
    const intensity = Math.min(1, .28 + Math.abs(historyRate) / 18);
    const positive = historyRate >= 0;
    // Keep the treemap geometry driven only by value while using a darker
    // color ramp so white labels remain legible on mobile-sized tiles.
    const background = positive
      ? `hsl(0 68% ${Math.max(31, 44 - intensity * 10)}%)`
      : `hsl(151 48% ${Math.max(30, 40 - intensity * 8)}%)`;
    const name = localizedAssetName(item.symbol, item.name, item.market);
    const compact = percentage < 15;
    const tight = rectangle.h < 12 || rectangle.w < 18;
    const tileClass = `treemap-tile${compact ? " treemap-tile-compact" : ""}${tight ? " treemap-tile-tight" : ""}`;
    return <button key={item.symbol} className={tileClass} title={name} style={{ left:`${rectangle.x}%`, top:`${rectangle.y}%`, width:`${rectangle.w}%`, height:`${rectangle.h}%`, background, color:"#fff" }} onClick={() => onSelect(item.symbol)} aria-label={`查看${name}持仓详情`}><strong>{name}</strong>{!compact && <><span>¥{item.value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}</span><small>{percentage.toFixed(1)}% · {historyRate >= 0 ? "+" : ""}{historyRate.toFixed(1)}%</small></>}</button>;
  })}</div>;
}

type TreemapRect = { x:number; y:number; w:number; h:number };

function sliceTreemap(values: number[], x:number, y:number, width:number, height:number, offset:number): TreemapRect[] {
  if (!values.length) return [];
  if (values.length === 1) return [{ x, y, w: width, h: height }];
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  let running = 0;
  let split = 1;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < values.length; index += 1) {
    running += values[index - 1];
    const ratio = running / total;
    const score = Math.abs(ratio - .5);
    if (score < best) { best = score; split = index; }
  }
  const firstTotal = values.slice(0, split).reduce((sum, value) => sum + value, 0);
  const ratio = firstTotal / total;
  if ((offset % 2 === 0 && width >= height) || (offset % 2 === 1 && width < height)) {
    const firstWidth = width * ratio;
    return [...sliceTreemap(values.slice(0, split), x, y, firstWidth, height, offset + 1), ...sliceTreemap(values.slice(split), x + firstWidth, y, width - firstWidth, height, offset + 1)];
  }
  const firstHeight = height * ratio;
  return [...sliceTreemap(values.slice(0, split), x, y, width, firstHeight, offset + 1), ...sliceTreemap(values.slice(split), x, y + firstHeight, width, height - firstHeight, offset + 1)];
}

function rowTreemap(values: number[]): TreemapRect[] {
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  const targetRowValue = total / Math.max(1, Math.ceil(Math.sqrt(values.length)));
  const rows: number[][] = [];
  let current: number[] = [];
  let currentTotal = 0;
  values.forEach((value, index) => {
    current.push(value); currentTotal += value;
    if (currentTotal >= targetRowValue || index === values.length - 1) { rows.push(current); current = []; currentTotal = 0; }
  });
  const rectangles: TreemapRect[] = [];
  let top = 0;
  rows.forEach((row) => {
    const rowTotal = row.reduce((sum, value) => sum + value, 0);
    const rowHeight = rowTotal / total * 100;
    let left = 0;
    row.forEach((value) => {
      const tileWidth = value / rowTotal * 100;
      rectangles.push({ x:left, y:top, w:tileWidth, h:rowHeight });
      left += tileWidth;
    });
    top += rowHeight;
  });
  return rectangles;
}

function PortfolioQuickCard({ symbol, quote, holding, marketCap, onClose }: { symbol:string; quote?:MarketQuote; holding?:Holding; marketCap?:string; onClose:()=>void }) {
  const change = quote?.change ?? holding?.change ?? 0;
  const price = quote?.price ?? holding?.price;
  const currency = quote?.currency ?? holding?.currency ?? "$";
  const previousPrice = price && 1 + change / 100 > 0 ? price / (1 + change / 100) : 0;
  const dayAmount = price ? price - previousPrice : 0;
  const holdingRate = holding && holding.cost > 0 ? (holding.value - holding.cost) / holding.cost * 100 : 0;
  const holdingProfit = holding ? holding.value - holding.cost : 0;
  return <div className={`quick-stock-card ${holding ? "quick-stock-card-holding" : ""}`} role="dialog" aria-label={`${symbol}快速信息`}>
    <header className="quick-card-header"><div className="quick-card-title"><strong>{holding ? holdingDisplayName(holding, quote) : (quote?.name || symbol)}</strong><span>{symbol} · {holding?.market || quote?.market || "美股"}</span></div>{holding && <div className="quick-card-value"><small>持仓市值</small><strong>¥{holding.value.toLocaleString("zh-CN")}</strong></div>}<button className="quick-card-close" onClick={onClose} aria-label="关闭快速信息">×</button></header>
    {holding ? <>
      <div className="quick-card-returns"><div className={holdingRate >= 0 ? "up" : "down"}><small>历史收益率</small><strong>{holdingRate >= 0 ? "+" : ""}{holdingRate.toFixed(2)}%</strong></div><div className={holdingProfit >= 0 ? "up" : "down"}><small>历史收益</small><strong>{holdingProfit >= 0 ? "+" : "-"}¥{Math.abs(holdingProfit).toLocaleString("zh-CN")}</strong></div></div>
      <div className="quick-card-secondary"><span><small>持仓数量</small><b>{holding.quantity.toLocaleString("zh-CN")}</b></span><span><small>成本价</small><b>{holding.currency}{holding.avgCost.toLocaleString("zh-CN")}</b></span><span><small>当前股价</small><b>{price ? `${currency}${price.toLocaleString("en-US", { maximumFractionDigits: 3 })}` : "—"}</b></span><span className={quoteTone(change)}><small>今日涨跌</small><b>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</b></span></div>
    </> : <>
      <div className="quick-card-price"><b>{price ? `${currency}${price.toLocaleString("en-US", { maximumFractionDigits: 3 })}` : "—"}</b><em className={quoteTone(change)}>{change >= 0 ? "+" : ""}{change.toFixed(2)}% <small>{dayAmount >= 0 ? "+" : "-"}{currency}{Math.abs(dayAmount).toFixed(2)}</small></em></div>
      <div className="quick-card-market"><span>公司市值</span><strong>{marketCap || "行情源暂未提供"}</strong></div>
    </>}
  </div>;
}

function EventCalendarPage(){
  const [events,setEvents]=useState<any[]>([]); const [candidates,setCandidates]=useState<any[]>([]); const [view,setView]=useState<"month"|"timeline">("month"); const [industry,setIndustry]=useState("全部"); const [type,setType]=useState("全部"); const [importance,setImportance]=useState("全部"); const [month,setMonth]=useState(new Date()); const [selectedDate,setSelectedDate]=useState<string|null>(null); const [showAdd,setShowAdd]=useState(false);
  const load=()=>{fetch("/api/events",{cache:"no-store"}).then(r=>r.ok?r.json():{events:[]}).then((d:any)=>setEvents(d.events||[]));fetch("/api/event-candidates",{cache:"no-store"}).then(r=>r.ok?r.json():{candidates:[]}).then((d:any)=>setCandidates(d.candidates||[]));}; useEffect(load,[]);
  const filtered=events.filter(e=>(industry==="全部"||e.industries?.includes(industry))&&(type==="全部"||e.eventType===type)&&(importance==="全部"||e.importance===importance)); const key=(d:Date)=>d.toISOString().slice(0,10); const first=new Date(month.getFullYear(),month.getMonth(),1); const offset=(first.getDay()+6)%7; const days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate(); const byDate=new Map<string,any[]>(); filtered.forEach(e=>{const k=String(e.startAt).slice(0,10);byDate.set(k,[...(byDate.get(k)||[]),e]);});
  return <section className="market-page-content event-calendar-page"><div className="market-page-intro"><div><span>US EVENTS</span><h2>关键事件日历</h2><p>未来 12 个月 · 官方日期与待确认事件</p></div><button className="event-refresh" onClick={load}>刷新</button></div><div className="event-filters"><select value={industry} onChange={e=>setIndustry(e.target.value)}><option>全部</option><option>太空</option><option>AI</option><option>链</option></select><select value={type} onChange={e=>setType(e.target.value)}><option>全部</option>{["解禁","重大发射","重要建设","会议","发布会","法案"].map(x=><option key={x}>{x}</option>)}</select><select value={importance} onChange={e=>setImportance(e.target.value)}><option>全部</option><option>关键</option><option>关注</option></select></div><div className="event-view-switch"><button className={view==="month"?"active":""} onClick={()=>setView("month")}>月历</button><button className={view==="timeline"?"active":""} onClick={()=>setView("timeline")}>时间线</button></div>{view==="month"?<section className="event-month"><header><button onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}>‹</button><strong>{month.getFullYear()} 年 {month.getMonth()+1} 月</strong><button onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}>›</button></header><div className="event-weekdays">{["一","二","三","四","五","六","日"].map(x=><span key={x}>周{x}</span>)}</div><div className="event-grid">{Array.from({length:offset+days},(_,i)=>{if(i<offset)return <i key={i}/>;const d=i-offset+1;const k=key(new Date(month.getFullYear(),month.getMonth(),d));const list=byDate.get(k)||[];return <button key={k} onClick={()=>setSelectedDate(k)}><b>{d}</b>{list.slice(0,2).map(e=><small key={e.id}>{e.title}</small>)}{list.length>2&&<em>+{list.length-2}</em>}</button>})}</div></section>:<section className="event-timeline">{filtered.sort((a,b)=>a.startAt.localeCompare(b.startAt)).map(e=><article key={e.id}><time>{String(e.startAt).slice(0,10)}</time><div><strong>{e.title}</strong><small>{e.eventType} · {e.industries?.join("、")} · {e.symbols?.join("、")}</small><a href={e.sourceUrl} target="_blank">{e.sourceName||"来源"}</a></div></article>)}</section>}<div className="event-actions"><button onClick={()=>setShowAdd(true)}>＋ 新增事件</button><button onClick={()=>undefined}>待确认（{candidates.length}）</button></div>{selectedDate&&<div className="event-drawer" onClick={()=>setSelectedDate(null)}><section onClick={e=>e.stopPropagation()}><button onClick={()=>setSelectedDate(null)}>×</button><h3>{selectedDate}</h3>{(byDate.get(selectedDate)||[]).map(e=><article key={e.id}><strong>{e.title}</strong><small>{e.eventType} · {e.industries?.join("、")} · {e.symbols?.join("、")}</small><a href={e.sourceUrl} target="_blank">查看来源</a></article>)}</section></div>}{showAdd&&<ManualEventForm onClose={()=>setShowAdd(false)} onSaved={()=>{setShowAdd(false);load();}}/>}</section>;
}

function ManualEventForm({onClose,onSaved}:{onClose:()=>void;onSaved:()=>void}){const [title,setTitle]=useState("");const [date,setDate]=useState("");const [eventType,setEventType]=useState("会议");const save=async()=>{await fetch("/api/events",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,startAt:`${date}T12:00:00+08:00`,eventType,industries:["AI"],symbols:["TSLA"],sourceName:"手工添加"})});onSaved();};return <div className="event-drawer" onClick={onClose}><section onClick={e=>e.stopPropagation()}><button onClick={onClose}>×</button><h3>新增事件</h3><input placeholder="事件名称" value={title} onChange={e=>setTitle(e.target.value)}/><input type="date" value={date} onChange={e=>setDate(e.target.value)}/><select value={eventType} onChange={e=>setEventType(e.target.value)}>{["解禁","重大发射","重要建设","会议","发布会","法案"].map(x=><option key={x}>{x}</option>)}</select><button onClick={save}>保存</button></section></div>}

function ReturnCalendar({ months, years, year, onYearChange, mode, onModeChange }: { months:CalendarMonth[]; years:CalendarYear[]; year:number; onYearChange:(year:number)=>void; mode:"year"|"month"|"day"; onModeChange:(mode:"year"|"month"|"day")=>void }) {
  const [expandedMonth, setExpandedMonth] = useState<number>(new Date().getMonth() + 1);
  const selected = months[expandedMonth - 1] ?? months[0];
  const firstWeekday = selected ? (new Date(year, selected.month - 1, 1).getDay() + 6) % 7 : 0;
  const daysInMonth = selected ? new Date(year, selected.month, 0).getDate() : 0;
  const dayMap = new Map(selected?.days.map((day) => [Number(day.date.slice(-2)), day]) ?? []);
  const cells: Array<{ blank:boolean; key:string; day?:number }> = selected ? [...Array.from({ length:firstWeekday }, (_, index) => ({ blank:true, key:`blank-${index}` })), ...Array.from({ length:daysInMonth }, (_, index) => ({ blank:false, key:`day-${index + 1}`, day:index + 1 }))] : [];
  return <section className="panel return-calendar-panel">
    <div className="panel-head calendar-head"><div><h2>收益日历</h2><p>入金和出金已从投资收益中剔除 · 月度与年度收益率按每日收益复利</p></div><div className="calendar-controls"><div className="calendar-mode-switch">{([["year","年度"],["month","月度"],["day","每日"]] as const).map(([key,label])=><button key={key} className={mode === key ? "active" : ""} onClick={()=>onModeChange(key)}>{label}</button>)}</div>{mode !== "year" && <div className="calendar-year-control"><button onClick={()=>onYearChange(year - 1)} aria-label="上一年">‹</button><strong>{year} 年</strong><button onClick={()=>onYearChange(year + 1)} aria-label="下一年">›</button></div>}</div></div>
    {mode === "year" && <div className="calendar-year-grid">{years.map((item) => { const tone = item.profit > 0 ? "up" : item.profit < 0 ? "down" : "neutral"; return <button key={item.year} className={`calendar-year-card ${item.year === year ? "selected" : ""}`} onClick={()=>{ onYearChange(item.year); onModeChange("month"); }}><strong>{item.year}</strong><span className={tone}>{item.recordedDays ? `${item.profit >= 0 ? "+" : "-"}¥${Math.abs(item.profit).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}` : "—"}</span><small className={tone}>{item.recordedDays ? `${item.rate >= 0 ? "+" : ""}${item.rate.toFixed(2)}% · ${item.recordedDays} 日` : "暂无记录"}</small></button>; })}</div>}
    {mode === "month" && <div className="year-month-grid">{months.map((month) => {
      const tone = month.profit > 0 ? "up" : month.profit < 0 ? "down" : "neutral";
      return <button key={month.month} className={`calendar-month-card ${expandedMonth === month.month ? "selected" : ""}`} onClick={()=>{ setExpandedMonth(month.month); onModeChange("day"); }}><span>{month.month} 月</span><strong className={tone}>{month.recordedDays ? `${month.profit >= 0 ? "+" : "-"}¥${Math.abs(month.profit).toLocaleString("zh-CN", { maximumFractionDigits:2 })}` : "—"}</strong><small className={tone}>{month.recordedDays ? `${month.rate >= 0 ? "+" : ""}${month.rate.toFixed(2)}%` : "暂无记录"}</small></button>;
    })}</div>}
    {mode === "day" && selected && <div className="month-calendar-detail"><div className="day-month-selector">{months.map((month)=><button key={month.month} className={expandedMonth === month.month ? "active" : ""} onClick={()=>setExpandedMonth(month.month)}>{month.month}月</button>)}</div>
      <div className="month-summary"><strong>{selected.month} 月</strong><span className={selected.profit >= 0 ? "up" : "down"}>{selected.recordedDays ? `${selected.profit >= 0 ? "+" : "-"}¥${Math.abs(selected.profit).toLocaleString("zh-CN", { maximumFractionDigits:2 })}` : "—"}<small>本月累计收益</small></span><span className={selected.rate >= 0 ? "up" : "down"}>{selected.recordedDays ? `${selected.rate >= 0 ? "+" : ""}${selected.rate.toFixed(2)}%` : "—"}<small>本月收益率</small></span><span>{selected.recordedDays ? `${selected.positiveRatio.toFixed(0)}%` : "—"}<small>盈利日占比</small></span></div>
      <div className="calendar-weekdays">{["周一","周二","周三","周四","周五","周六","周日"].map((day)=><span key={day}>{day}</span>)}</div>
      <div className="calendar-days">{cells.map((cell) => {
        if (cell.blank) return <span className="calendar-day blank" key={cell.key} />;
        const record = dayMap.get(cell.day!);
        const weekday = (firstWeekday + cell.day! - 1) % 7;
        const tone = record ? record.profit > 0 ? "up" : record.profit < 0 ? "down" : "neutral" : "muted";
        return <span className={`calendar-day ${!record || weekday > 4 ? "inactive" : ""}`} key={cell.key}><b>{cell.day}</b>{record && <><strong className={tone}>{record.profit >= 0 ? "+" : "-"}¥{Math.abs(record.profit).toLocaleString("zh-CN", { maximumFractionDigits:2 })}</strong><small className={tone}>{record.rate >= 0 ? "+" : ""}{record.rate.toFixed(2)}%</small></>}</span>;
      })}</div>
    </div>}
  </section>;
}

function HoldingEditorDrawer({ holdings, quotes, initialSymbol, onLookup, onSaveAll, onDelete, onClose }: { holdings: Holding[]; quotes: Record<string, MarketQuote>; initialSymbol: string | null; onLookup:(symbol:string)=>Promise<MarketQuote | null>; onSaveAll:(edits:{item:Holding;originalSymbol:string}[])=>void; onDelete:(symbol:string)=>void; onClose:()=>void }) {
  const blankHolding = (): Holding => ({ symbol:"", name:"", market:"美股", category:"美股", price:0, currency:"$", change:0, value:0, cost:0, avgCost:0, quantity:0, holdingDays:0, weight:0, spark:[35,35,35,35,35,35,35,35,35,35] });
  const [selected, setSelected] = useState<string | null>(initialSymbol);
  const [draft, setDraft] = useState<Holding>(() => initialSymbol ? { ...(holdings.find((item)=>item.symbol === initialSymbol) ?? blankHolding()) } : blankHolding());
  const [numberText, setNumberText] = useState({ avgCost: initialSymbol ? String(holdings.find((item)=>item.symbol === initialSymbol)?.avgCost ?? "") : "", quantity: initialSymbol ? String(holdings.find((item)=>item.symbol === initialSymbol)?.quantity ?? "") : "" });
  const [message, setMessage] = useState("");
  const isNew = selected === "__new__";
  const choose = (symbol: string) => { const item = holdings.find((holding)=>holding.symbol === symbol); if (!item) return; setSelected(symbol); setDraft({ ...item }); setNumberText({ avgCost:String(item.avgCost), quantity:String(item.quantity) }); setMessage(""); };
  const startNew = () => { setSelected("__new__"); setDraft(blankHolding()); setNumberText({ avgCost:"", quantity:"" }); setMessage(""); };
  const lookup = async () => { const symbol = normalizeAssetSymbol(draft.symbol); if (!symbol) return; const quote = await onLookup(symbol); if (!quote) { setMessage("代码无法识别，请检查后重试。"); return; } const cash = quote.market === "现金" || isCashSymbol(symbol); setDraft((current)=>({ ...current, symbol:quote.symbol, name:quote.name, market:quote.market, price:quote.price, currency:quote.currency, change:quote.change, avgCost:cash ? 1 : current.avgCost, category:quote.suggestedCategory ?? (quote.market === "A股" ? "A股" : quote.market === "加密货币" ? "加密货币" : current.category) })); if (cash) setNumberText((current)=>({ ...current, avgCost:"1" })); setMessage(cash ? "现金资产已识别，面值固定为 1" : "已识别并获取最新行情"); };
  const save = async () => { setMessage(""); let next = draft; if (next.symbol.trim() && (!next.name.trim() || isCashSymbol(next.symbol))) { const quote = await onLookup(next.symbol); if (!quote) { setMessage("代码无法识别，请检查后重试。"); return; } next = { ...next, symbol:quote.symbol, name:quote.name, market:quote.market, price:quote.price, currency:quote.currency, change:quote.change, category:quote.suggestedCategory ?? next.category, avgCost:quote.market === "现金" ? 1 : next.avgCost }; }
    if (!next.symbol.trim() || !next.name.trim() || next.quantity <= 0 || next.avgCost < 0) { setMessage("请填写代码、均价和持仓数，持仓数必须大于 0。"); return; }
    onSaveAll([{ item:next, originalSymbol:isNew ? "" : selected || next.symbol }]); onClose();
  };
  const shown = recalculateHolding(draft, quotes);
  return <div className="holding-editor-backdrop" role="presentation" onMouseDown={onClose}><section className="holding-editor-drawer" role="dialog" aria-modal="true" aria-label="管理持仓" onMouseDown={(event)=>event.stopPropagation()}><div className="holding-editor-grabber" /><header><div><span>PORTFOLIO CONTROL</span><h2>{selected ? (isNew ? "新增持仓" : "编辑持仓") : "管理持仓"}</h2></div><button type="button" onClick={onClose} aria-label="关闭持仓管理">×</button></header>{!selected ? <div className="holding-picker"><p>选择一项持仓进行修改，或新增一项资产。</p><div>{holdings.map((item)=><button type="button" key={item.symbol} onClick={()=>choose(item.symbol)}><span><strong>{localizedAssetName(item.symbol,item.name,item.market)}</strong><small>{item.symbol} · {item.category}</small></span><b>›</b></button>)}</div><button type="button" className="holding-add-entry" onClick={startNew}>＋ 新增持仓</button></div> : <div className="holding-editor-form"><div className="drawer-identity"><strong>{shown.name || (isNew ? "待识别资产" : localizedAssetName(shown.symbol,shown.name,shown.market))}</strong><small>{shown.symbol || "输入代码"} · {shown.market}</small></div><div className="drawer-fields"><label><small>代码</small><input className="inline-field code-field" value={draft.symbol} onChange={(event)=>setDraft((current)=>({ ...current, symbol:event.target.value, name:"" }))} onBlur={()=>void lookup()} autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off" placeholder="AAPL / 601985 / BTC" aria-label="资产代码" /></label><label><small>资产分类</small><select className="inline-select" value={draft.category} onChange={(event)=>setDraft((current)=>({ ...current, category:event.target.value as AssetBucket }))} aria-label="资产分类">{assetBuckets.map((bucket)=><option key={bucket}>{bucket}</option>)}</select></label><label><small>{isCashSymbol(draft.symbol) ? "现金面值" : "持仓均价"}</small><input className="inline-field number-field" type="number" min="0" step="any" inputMode="decimal" value={isCashSymbol(draft.symbol) ? "1" : numberText.avgCost} readOnly={isCashSymbol(draft.symbol)} onChange={(event)=>{ const value=event.target.value; setNumberText((current)=>({ ...current, avgCost:value })); setDraft((current)=>({ ...current, avgCost:value === "" ? 0 : Number(value) })); }} placeholder="均价" aria-label={isCashSymbol(draft.symbol) ? "现金面值" : "持仓均价"} /></label><label><small>持仓数 / 余额</small><input className="inline-field number-field" type="number" min="0.00000001" step="any" inputMode="decimal" value={numberText.quantity} onChange={(event)=>{ const value=event.target.value; setNumberText((current)=>({ ...current, quantity:value })); setDraft((current)=>({ ...current, quantity:value === "" ? 0 : Number(value) })); }} placeholder="数量" aria-label="持仓数或现金余额" /></label></div><p className={`drawer-message ${message ? "visible" : ""}`} role="status">{message || (isCashSymbol(draft.symbol) ? "现金资产按余额计入总资产" : "代码失焦后自动识别名称和行情")}</p><div className="drawer-actions"><button type="button" className="drawer-secondary" onClick={()=>setSelected(null)}>返回列表</button>{!isNew && <button type="button" className="drawer-danger" onClick={()=>{ if (window.confirm("确定删除这项持仓吗？")) { onDelete(selected || draft.symbol); onClose(); } }}>删除持仓</button>}<button type="button" className="drawer-primary" onClick={()=>void save()}>保存</button></div></div>}</section></div>;
}

function Modal({ title, eyebrow, description, onClose, children }: { title:string; eyebrow:string; description:string; onClose:()=>void; children:React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event)=>event.stopPropagation()}><div className="modal-head"><div><small>{eyebrow}</small><h2>{title}</h2></div><button onClick={onClose} aria-label="关闭">×</button></div><p>{description}</p>{children}</section></div>;
}

function ModalActions({ onCancel, label }: { onCancel:()=>void; label:string }) {
  return <div className="form-actions"><button type="button" onClick={onCancel}>取消</button><button type="submit">{label}</button></div>;
}
