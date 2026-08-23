"use client";

import { useEffect, useMemo, useState } from "react";
import type { CnMarketItem } from "./market-data/cn-market";

type Market = "美股" | "A股" | "基金";
type AssetBucket = "美股指数" | "红利" | "美股" | "A股" | "加密货币" | "现金/类现金";
type MarketQuote = { symbol: string; name: string; market: Market; price: number; currency: "$" | "¥"; change: number; asOf: string; provider: string; suggestedCategory?: AssetBucket; marketCap?: number };
type CnMarketResponse = { marketState: "open" | "lunch" | "closed" | "holiday"; timezone: string; updatedAt: string; items: Record<string, CnMarketItem>; errors: Record<string, string> };
type Holding = {
  symbol: string; name: string; market: Market; price: number; currency: "$" | "¥";
  change: number; value: number; cost: number; avgCost: number; quantity: number;
  holdingDays: number; weight: number; spark: number[]; category: AssetBucket;
  quoteSource?: "api" | "demo" | "unavailable"; quoteProvider?: string; quoteAsOf?: string; sourceSymbol?: string;
};
type Profile = { name: string; target: string; risk: string };
type CloudPortfolioState = { holdings: Holding[]; profile: Profile; useDemoHoldings: boolean; longTermStart: string; usWatchlist?: string[]; usSectorLists?: Record<string, string[]> };
type SyncStatus = "loading" | "syncing" | "synced" | "offline";
type DeviceAccessState = {
  status: "checking" | "authorized" | "locked" | "error";
  source: "chatgpt" | "device" | "local" | null;
  trusted: boolean;
  setupRequired: boolean;
  message: string;
};

const assetBuckets: AssetBucket[] = ["美股指数", "红利", "美股", "A股", "加密货币", "现金/类现金"];
const todayMarketCodes = ["515450", "000922", "000688"];
const bucketClasses: Record<AssetBucket, string> = { "美股指数": "c-nasdaq", "红利": "c-dividend", "美股": "c-growth", "A股":"c-ashare", "加密货币":"c-crypto", "现金/类现金": "c-cash" };
const bucketColors: Record<AssetBucket, string> = { "美股指数":"#635BFF", "红利":"#00BFA6", "美股":"#00AEEF", "A股":"#F05D5E", "加密货币":"#8B5CF6", "现金/类现金":"#FFB15C" };

function shortFundName(name: string) {
  const clean = name.replace(/[（）()]/g, " ").replace(/\s+/g, "").trim();
  const managers = ["南方", "招商", "广发", "国泰", "华夏", "易方达", "博时", "嘉实", "鹏华", "富国", "天弘", "华安", "汇添富", "工银", "交银", "建信", "中欧", "银华"];
  const manager = managers.find((item) => clean.startsWith(item)) ?? "";
  if (/纳斯达克|纳指/.test(clean)) return `${manager}纳指` || "纳指基金";
  if (/红利低波/.test(clean)) return `${manager}红利低波` || "红利低波";
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
  if (market === "美股") return symbol.trim().toUpperCase();
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
  const legacy = String(item.category || "");
  if (legacy === "美股纳斯达克指数") return "美股指数";
  if (legacy === "红利类资产") return "红利";
  if (legacy === "美股高成长个股") return "美股";
  if (legacy === "债券" || legacy === "现金") return "现金/类现金";
  if (legacy === "加密货币") return "加密货币";
  if (assetBuckets.includes(legacy as AssetBucket)) return legacy as AssetBucket;
  if (item.symbol === "QQQ") return "美股指数";
  if (item.symbol === "006962") return "现金/类现金";
  if (item.market === "美股") return "美股";
  if (item.market === "A股") return "A股";
  return "红利";
}

function resolveQuote(symbol: string, category: AssetBucket, remoteQuotes: Record<string, MarketQuote> = {}) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const remote = remoteQuotes[normalizedSymbol];
  if (remote) return { ...remote, quoteSource: remote.price > 0 ? "api" as const : "unavailable" as const };
  const known = quoteBook[normalizedSymbol];
  if (known) return { ...known, quoteSource: "demo" as const };
  const market: Market = /^[A-Z]/.test(normalizedSymbol) || category.startsWith("美股") ? "美股" : "基金";
  const currency: "$" | "¥" = market === "美股" ? "$" : "¥";
  return { price: 0, currency, market, change: 0, quoteSource: "unavailable" as const };
}

function recalculateHolding(item: Holding, remoteQuotes: Record<string, MarketQuote> = {}): Holding {
  const category = fallbackCategory(item);
  const quote = resolveQuote(item.symbol, category, remoteQuotes);
  const fx = quote.market === "美股" ? 7.18 : 1;
  const quantity = Number(item.quantity) || 0;
  const avgCost = Number(item.avgCost) || 0;
  const cost = Math.round(avgCost * quantity * fx * 100) / 100;
  return {
    ...item,
    symbol: item.symbol.trim().toUpperCase(),
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
type PageKey = "overview" | "ashare" | "us";
type PortfolioSnapshot = { date: string; value: number; cost: number; returnRate: number };
type PortfolioTrend = { dates: string[]; returns: number[]; profits: number[]; costs: number[]; values: number[] };
type USMarketState = "pre" | "open" | "after" | "closed";
type USQuote = MarketQuote & { sector?: string };

const defaultUSWatchlist = ["TSLA", "NVDA", "RKLB", "PLTR", "AVGO", "MSFT", "GOOGL", "AMZN"];
const defaultUSSectors: Record<string, string[]> = {
  "信息技术": ["MSFT", "GOOGL", "AMZN", "PLTR"],
  "半导体": ["NVDA", "AVGO", "AMD", "TSM"],
  "航天军工": ["RKLB", "ASTS", "LUNR", "RDW", "BA", "LMT", "NOC", "RTX", "PL"],
  "互联网": ["META", "NFLX", "GOOGL", "AMZN"],
  "金融": ["JPM", "BAC", "GS", "BRK.B"],
  "医疗": ["LLY", "UNH", "JNJ", "MRK"],
  "能源": ["XOM", "CVX", "COP", "SLB"],
  "ETF": ["QQQ", "SPY", "DIA"],
};
const usCompanyNames: Record<string,string> = {
  TSLA:"Tesla", NVDA:"NVIDIA", RKLB:"Rocket Lab", PLTR:"Palantir", AVGO:"Broadcom", MSFT:"Microsoft", GOOGL:"Alphabet", AMZN:"Amazon", AMD:"AMD", TSM:"TSMC", ASTS:"AST SpaceMobile", LUNR:"Intuitive Machines", RDW:"Redwire", BA:"Boeing", LMT:"Lockheed Martin", NOC:"Northrop Grumman", RTX:"RTX", PL:"Planet Labs", META:"Meta", NFLX:"Netflix", JPM:"JPMorgan", BAC:"Bank of America", GS:"Goldman Sachs", "BRK.B":"Berkshire Hathaway", LLY:"Eli Lilly", UNH:"UnitedHealth", JNJ:"Johnson & Johnson", MRK:"Merck", XOM:"Exxon Mobil", CVX:"Chevron", COP:"ConocoPhillips", SLB:"SLB", QQQ:"Nasdaq 100 ETF", SPY:"S&P 500 ETF", DIA:"Dow Jones ETF",
};
type CalendarDay = { date: string; profit: number; rate: number };
type CalendarMonth = { month: number; profit: number; rate: number; positiveRatio: number; recordedDays: number; days: CalendarDay[] };
type CalendarYear = { year: number; profit: number; rate: number; positiveRatio: number; recordedDays: number };

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function trendAxisLabel(value: number, mode: TrendMode) {
  if (mode === "return") return `${value.toFixed(value < 10 && value > -10 ? 1 : 0)}%`;
  const absolute = Math.abs(value);
  return absolute >= 10000 ? `${value < 0 ? "-" : ""}¥${(absolute / 10000).toFixed(0)}万` : `¥${Math.round(value / 1000)}千`;
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
  const labels = Array.from({length:5}, (_,index)=>trendAxisLabel(max - ((max-min)/4)*index, mode));
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

function usMarketState(now = new Date()): { state:USMarketState; label:string; time:string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone:"America/New_York", hour:"2-digit", minute:"2-digit", hour12:false, weekday:"short" }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  const total = hour * 60 + minute;
  const time = new Intl.DateTimeFormat("zh-CN", { timeZone:"Asia/Shanghai", hour:"2-digit", minute:"2-digit", hour12:false }).format(now);
  if (weekday === "Sat" || weekday === "Sun") return { state:"closed", label:"已收盘", time };
  if (total >= 240 && total < 570) return { state:"pre", label:"盘前", time };
  if (total >= 570 && total < 960) return { state:"open", label:"盘中", time };
  if (total >= 960 && total < 1200) return { state:"after", label:"盘后", time };
  return { state:"closed", label:"已收盘", time };
}

function quoteTone(change:number) { return change >= 0 ? "up" : "down"; }

function AllocationContent({ data, totalValue }: { data:Array<{ category:AssetBucket; amount:number; percent:number; className:string }>; totalValue:number }) {
  let cursor = 0;
  const gradient = data.map((item) => { const start = cursor; cursor += item.percent; return `${bucketColors[item.category]} ${start}% ${cursor}%`; }).join(", ");
  let labelCursor = 0;
  const labels = data.map((item)=>{ const midpoint = labelCursor + item.percent / 2; labelCursor += item.percent; const angle = midpoint / 100 * Math.PI * 2 - Math.PI / 2; return { ...item, left:50 + Math.cos(angle) * 45, top:50 + Math.sin(angle) * 45 }; }).filter((item)=>item.percent >= 2);
  return <div className="allocation-switch-content">
    <div className="allocation-chart-layout allocation-inline-layout">
      <div className="allocation-pie-wrap"><div className="allocation-pie" style={{background:totalValue > 0 ? `conic-gradient(${gradient})` : "#e7e6e3"}} role="img" aria-label="资产配置分布"><div><span>总市值</span><strong>¥{totalValue >= 10000 ? `${(totalValue/10000).toFixed(1)}万` : totalValue.toLocaleString("zh-CN")}</strong></div></div>{labels.map((item)=><span key={item.category} className="allocation-pie-label" style={{left:`${item.left}%`,top:`${item.top}%`}}>{item.category} {item.percent.toFixed(0)}%</span>)}</div>
      <div className="allocation-legend-list">{data.map((item)=><div key={item.category}><span><i style={{background:bucketColors[item.category]}} />{item.category}</span><b>{item.percent.toFixed(1)}%</b><small>¥{item.amount.toLocaleString("zh-CN")}</small></div>)}</div>
    </div>
  </div>;
}

export default function Home() {
  const [page, setPage] = useState<PageKey>("overview");
  const [range, setRange] = useState("1年");
  const [trendMode, setTrendMode] = useState<AnalysisMode>("return");
  const [query, setQuery] = useState("");
  const [bucketFilter, setBucketFilter] = useState<"全部" | AssetBucket>("全部");
  const [customHoldings, setCustomHoldings] = useState<Holding[]>([]);
  const [remoteQuotes, setRemoteQuotes] = useState<Record<string, MarketQuote>>({});
  const [cnMarket, setCnMarket] = useState<CnMarketResponse | null>(null);
  const [cnMarketLoading, setCnMarketLoading] = useState(false);
  const [quoteErrors, setQuoteErrors] = useState<Record<string, string>>({});
  const [useDemoHoldings, setUseDemoHoldings] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
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
  const [longTermStart, setLongTermStart] = useState("");
  const [profile, setProfile] = useState<Profile>({ name: "", target: "12", risk: "均衡型" });
  const [assetForm, setAssetForm] = useState({ symbol: "", name: "", market: "" as Market | "", category: "美股" as AssetBucket, avgCost: "", quantity: "", holdingDays: "" });
  const [assetLookup, setAssetLookup] = useState<{ state: "idle" | "loading" | "success" | "error"; message: string }>({ state: "idle", message: "" });
  const [usWatchlist, setUsWatchlist] = useState<string[]>(defaultUSWatchlist);
  const [usSectorLists, setUsSectorLists] = useState<Record<string, string[]>>(defaultUSSectors);
  const [usQuotes, setUsQuotes] = useState<Record<string, USQuote>>({});
  const [selectedOverviewSymbol, setSelectedOverviewSymbol] = useState<string | null>(null);

  const quoteCodes = useMemo(() => {
    const symbols = new Set<string>();
    if (useDemoHoldings) initialHoldings.forEach((item) => symbols.add(item.symbol));
    customHoldings.forEach((item) => symbols.add(item.symbol.trim().toUpperCase()));
    usWatchlist.forEach((symbol) => symbols.add(symbol));
    Object.values(usSectorLists).flat().forEach((symbol) => symbols.add(symbol));
    return [...symbols].filter(Boolean).join(",");
  }, [customHoldings, usSectorLists, usWatchlist, useDemoHoldings]);

  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
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
    let controller: AbortController | null = null;
    const refreshQuotes = () => {
      controller?.abort();
      controller = new AbortController();
      fetch(`/api/assets?codes=${encodeURIComponent(quoteCodes)}`, { signal: controller.signal, cache: "no-store" })
        .then((response) => response.json())
        .then((rawPayload) => {
          const payload = rawPayload as { quotes?: Record<string, MarketQuote>; errors?: Record<string, string> };
          if (payload.quotes) { setRemoteQuotes((current) => ({ ...current, ...payload.quotes })); setUsQuotes((current) => ({ ...current, ...payload.quotes })); }
          setQuoteErrors(payload.errors ?? {});
        })
        .catch(() => { /* 保留上一次成功行情 */ });
    };
    refreshQuotes();
    const refreshTimer = window.setInterval(refreshQuotes, 20000);
    return () => { window.clearInterval(refreshTimer); controller?.abort(); };
  }, [quoteCodes]);

  useEffect(() => {
    let controller: AbortController | null = null;
    let timer: number | undefined;
    const refresh = () => {
      controller?.abort(); controller = new AbortController(); setCnMarketLoading(true);
      const url = `/api/cn-market?codes=${encodeURIComponent(todayMarketCodes.join(","))}&dividendCodes=${encodeURIComponent(todayMarketCodes.join(","))}`;
      fetch(url, { signal: controller.signal, cache: "no-store" }).then((response) => response.json()).then((payload) => setCnMarket(payload as CnMarketResponse)).catch(() => undefined).finally(() => setCnMarketLoading(false));
    };
    refresh();
    const schedule = () => { timer = window.setTimeout(() => { refresh(); schedule(); }, 20000); };
    schedule();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { if (timer) window.clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  async function lookupAssetCode(rawSymbol: string) {
    const entered = rawSymbol.trim().toUpperCase();
    const symbol = entered;
    if (!symbol) return null;
    const cached = remoteQuotes[symbol];
    if (cached) return cached;
    try {
      const response = await fetch(`/api/assets?codes=${encodeURIComponent(symbol)}`, { cache: "no-store" });
      const payload = await response.json() as { quotes?: Record<string, MarketQuote>; errors?: Record<string, string> };
      const quote = payload.quotes?.[symbol];
      if (!quote) throw new Error(payload.errors?.[symbol] || "未识别该代码");
      setRemoteQuotes((current) => ({ ...current, [symbol]: quote }));
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
    setAssetForm((current) => ({ ...current, symbol: quote.symbol, name: displayName, market: quote.market, category:quote.suggestedCategory ?? (quote.market === "A股" ? "A股" : current.category) }));
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
      const savedWatchlist = window.localStorage.getItem("hengce-us-watchlist");
      const savedSectors = window.localStorage.getItem("hengce-us-sector-lists");
      const history = window.localStorage.getItem("hengce-portfolio-snapshots-v1");
      const savedLongTermStart = window.localStorage.getItem("hengce-long-term-start");
      if (assets) {
        const stored = JSON.parse(assets) as Holding[];
        setCustomHoldings(stored);
      }
      if (holdingMode === "false") setUseDemoHoldings(false);
      if (savedWatchlist) { const parsed = JSON.parse(savedWatchlist); if (Array.isArray(parsed) && parsed.length) setUsWatchlist(parsed); }
      if (savedSectors) { const parsed = JSON.parse(savedSectors); if (parsed && typeof parsed === "object") setUsSectorLists(parsed); }
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
          if (Array.isArray(payload.state.usWatchlist) && payload.state.usWatchlist.length) setUsWatchlist(payload.state.usWatchlist.map((symbol) => symbol.toUpperCase()));
          if (payload.state.usSectorLists && typeof payload.state.usSectorLists === "object") setUsSectorLists(payload.state.usSectorLists);
          window.localStorage.setItem("hengce-custom-holdings", JSON.stringify(remoteHoldings));
          window.localStorage.setItem("hengce-profile", JSON.stringify(remoteProfile));
          window.localStorage.setItem("hengce-use-demo-holdings", String(Boolean(payload.state.useDemoHoldings)));
          window.localStorage.setItem("hengce-long-term-start", remoteStart);
          if (Array.isArray(payload.state.usWatchlist)) window.localStorage.setItem("hengce-us-watchlist", JSON.stringify(payload.state.usWatchlist));
          if (payload.state.usSectorLists) window.localStorage.setItem("hengce-us-sector-lists", JSON.stringify(payload.state.usSectorLists));
        } else {
          await fetch("/api/portfolio", {
            method:"PUT", headers:{ "content-type":"application/json" },
            body:JSON.stringify({ holdings:customHoldings, profile, useDemoHoldings, longTermStart:longTermStart || localDateKey(), usWatchlist, usSectorLists }),
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
      window.localStorage.setItem("hengce-us-watchlist", JSON.stringify(usWatchlist));
      window.localStorage.setItem("hengce-us-sector-lists", JSON.stringify(usSectorLists));
      if (longTermStart) window.localStorage.setItem("hengce-long-term-start", longTermStart);
      fetch("/api/portfolio", {
        method:"PUT", headers:{ "content-type":"application/json" },
        body:JSON.stringify({ holdings:customHoldings, profile, useDemoHoldings, longTermStart, usWatchlist, usSectorLists }),
      }).then((response) => {
        if (!response.ok) throw new Error("sync failed");
        setSyncStatus("synced");
      }).catch(() => setSyncStatus("offline"));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [cloudReady, customHoldings, longTermStart, profile, usSectorLists, usWatchlist, useDemoHoldings]);

  const allHoldings = useMemo(() => {
    const merged = new Map<string, Holding>();
    if (useDemoHoldings) initialHoldings.forEach((item) => merged.set(item.symbol, recalculateHolding(item, remoteQuotes)));
    customHoldings.forEach((item) => {
      if (item.sourceSymbol && item.sourceSymbol !== item.symbol) merged.delete(item.sourceSymbol);
      const legacyFx = item.market === "美股" ? 7.18 : 1;
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
  const allocationData = assetBuckets.map((category) => {
    const amount = allHoldings.filter((item) => item.category === category).reduce((sum, item) => sum + item.value, 0);
    return { category, amount, percent: totalValue > 0 ? (amount / totalValue) * 100 : 0, className: bucketClasses[category] };
  });
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
    const next = recalculateHolding({ symbol: assetForm.symbol, name: assetForm.name, category: assetForm.category, market: assetForm.market || "基金", price: 0, currency: assetForm.market === "美股" ? "$" : "¥", change: 0, value: 0, cost: 0, avgCost, quantity, holdingDays, weight: 0, spark: [35,35,35,35,35,35,35,35,35,35] }, remoteQuotes);
    const merged = new Map(customHoldings.map((item) => [item.symbol, item])); merged.set(next.symbol, next);
    const updated = [...merged.values()]; setCustomHoldings(updated);
    window.localStorage.setItem("hengce-custom-holdings", JSON.stringify(updated));
    setAssetForm({ symbol: "", name: "", market: "", category: "美股", avgCost: "", quantity: "", holdingDays: "" }); setAssetLookup({ state: "idle", message: "" }); setShowAdd(false);
  }

  function saveHoldings(edits: { item: Holding; originalSymbol: string }[]) {
    let updated = [...customHoldings];
    edits.forEach(({ item, originalSymbol }) => {
      const sourceSymbol = originalSymbol && originalSymbol !== item.symbol ? originalSymbol : item.sourceSymbol;
      const normalized = recalculateHolding({ ...item, sourceSymbol }, remoteQuotes);
      updated = updated.filter((holding) => holding.symbol !== originalSymbol && holding.symbol !== normalized.symbol && holding.sourceSymbol !== originalSymbol);
      updated.push(normalized);
    });
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
      usWatchlist,
      usSectorLists,
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
      if (Array.isArray(backup.usWatchlist) && backup.usWatchlist.length) setUsWatchlist(backup.usWatchlist);
      if (backup.usSectorLists && typeof backup.usSectorLists === "object") setUsSectorLists(backup.usSectorLists);
      setPortfolioHistory(importedSnapshots);
      window.localStorage.setItem("hengce-custom-holdings", JSON.stringify(backup.holdings));
      window.localStorage.setItem("hengce-profile", JSON.stringify(importedProfile));
      window.localStorage.setItem("hengce-use-demo-holdings", String(Boolean(backup.useDemoHoldings)));
      window.localStorage.setItem("hengce-long-term-start", importedStart);
      window.localStorage.setItem("hengce-us-watchlist", JSON.stringify(backup.usWatchlist ?? defaultUSWatchlist));
      window.localStorage.setItem("hengce-us-sector-lists", JSON.stringify(backup.usSectorLists ?? defaultUSSectors));
      window.localStorage.setItem("hengce-portfolio-snapshots-v1", JSON.stringify(importedSnapshots));
      const stateResponse = await fetch("/api/portfolio", {
        method:"PUT", headers:{ "content-type":"application/json" },
        body:JSON.stringify({ holdings:backup.holdings, profile:importedProfile, useDemoHoldings:Boolean(backup.useDemoHoldings), longTermStart:importedStart, usWatchlist:backup.usWatchlist ?? defaultUSWatchlist, usSectorLists:backup.usSectorLists ?? defaultUSSectors }),
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
      <section className="device-access-card" aria-live="polite">
        <div className="device-access-brand">M</div>
        <p>MINIMALISM · PRIVATE PORTFOLIO</p>
        <h1>{deviceAccess.status === "checking" ? "正在打开你的面板" : resetRequested ? "重置访问密码" : settingUp ? "设置访问密码" : "打开资产面板"}</h1>
        <span>{deviceAccess.message}</span>
        {deviceAccess.status !== "checking" && (!deviceAccess.setupRequired || settingUp || resetRequested) && <form className="device-access-form" onSubmit={(event)=>void submitDeviceAccess(event)}>
          <label><span>{settingUp ? "创建密码" : "访问密码"}</span><input type="password" autoComplete={settingUp ? "new-password" : "current-password"} minLength={settingUp ? 10 : undefined} value={accessPassword} onChange={(event)=>setAccessPassword(event.target.value)} placeholder={settingUp ? "至少 10 个字符" : "输入你的密码"} /></label>
          {settingUp && <label><span>确认密码</span><input type="password" autoComplete="new-password" minLength={10} value={accessPasswordConfirm} onChange={(event)=>setAccessPasswordConfirm(event.target.value)} placeholder="再次输入密码" /></label>}
          <button type="submit" disabled={accessBusy || !accessPassword}>{accessBusy ? "请稍候…" : resetRequested ? "重置并进入" : settingUp ? "设置并进入" : "进入面板"}</button>
        </form>}
        {deviceAccess.setupRequired && !setupToken && deviceAccess.status !== "checking" && <div className="device-setup-needed">首次使用需要打开我稍后发给你的一次性设置链接。</div>}
        <small>成功后会信任当前设备 180 天，平时点击网页图标即可直接进入。</small>
      </section>
    </main>;
  }

  return <main className="app-shell overview-only">
    <section className="workspace">
      <header className="topbar">
        <div><h1>{page === "overview" ? "Minimalism" : page === "ashare" ? "A股行情" : "美股行情"}</h1><span className="page-kicker">{page === "overview" ? "PRIVATE PORTFOLIO" : page === "ashare" ? "CHINA MARKET" : "US MARKET"}</span></div>
        <div className="top-actions">
          <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索股票 / 基金代码" aria-label="搜索股票或基金" /></label>
          <span className={`cloud-sync-status ${syncStatus}`}><i />{syncStatus === "loading" ? "连接云端" : syncStatus === "syncing" ? "同步中" : syncStatus === "synced" ? "已同步" : "离线"}</span>
          {!deviceAccess.trusted && <button className="trust-device-btn" onClick={()=>void trustCurrentDevice()}>信任此设备</button>}
          <button className="migration-btn" onClick={() => setShowSettings(true)}><span aria-hidden="true">⇄</span><span className="migration-label">数据迁移</span></button>
          <button className="icon-btn" aria-label="偏好设置" onClick={() => setShowSettings(true)}>⚙</button>
          {page === "overview" && <button className="primary-btn" onClick={() => setShowAdd(true)}><span className="add-asset-icon" aria-hidden="true" /><span className="add-asset-label">添加资产</span></button>}
        </div>
      </header>
      {page === "overview" && <>
        <section className="overview-hero">
          <section className="summary-card">
            <div className="summary-main">
              <div className="eyebrow">总资产（{baseCurrency}）<button onClick={() => setAmountsVisible(!amountsVisible)} aria-label="显示或隐藏金额">{amountsVisible ? "◉" : "○"}</button></div>
              <div className="total">{amountsVisible ? `${currencySymbol} ${shownTotal.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}` : "••••••••"}<span className="live-pill">实时</span></div>
              <div className={`pnl ${dailyProfit >= 0 ? "up" : "down"}`}><span>今日盈亏</span><strong>{dailyProfit >= 0 ? "+" : "-"}{currencySymbol} {Math.abs(shownDailyProfit).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</strong><em>{dailyReturn >= 0 ? "+" : ""}{dailyReturn.toFixed(2)}%</em><small>{dailyProfit > 0 ? "↗" : dailyProfit < 0 ? "↘" : "→"}</small></div>
              <div className="long-term-counter"><span>坚持长期主义</span><strong>{longTermDays}</strong><small>天</small></div>
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
            <div className="panel-head trend-head"><div><h2>{trendMode === "allocation" ? "资产配置分布" : "资产分析"}</h2><p>{trendMode === "allocation" ? "按当前持仓市值实时统计" : trendView.description}</p></div><div className="trend-controls"><div className="trend-switch">{([['return','收益率'],['profit','收益'],['assets','市值成本'],['allocation','资产配置分布']] as [AnalysisMode,string][]).map(([id,label])=><button key={id} className={trendMode === id ? "selected" : ""} onClick={()=>setTrendMode(id)}>{label}</button>)}</div></div></div>
            {trendMode === "allocation" ? <AllocationContent data={allocationData} totalValue={totalValue} /> : <><div className="chart-legend"><span><i className="legend-value" />{trendView.primary} <b className={selectedTrendMode !== "assets" ? (profit >= 0 ? "up" : "down") : ""}>{trendView.primaryValue}</b></span>{trendView.secondary && <span><i className="legend-cost" />{trendView.secondary} <b>{trendView.secondaryValue}</b></span>}<span className="chart-note">{trendView.note}</span></div><PerformanceChart mode={selectedTrendMode} trend={portfolioTrend} range={range} /></>}
          </article>
        </section>
        <section className="panel overview-heatmap-section"><div className="section-inline-head"><div><h2>持仓热力图</h2><p>面积按持仓市值，颜色按今日涨跌；点击查看持仓详情</p></div></div><HoldingsHeatmap holdings={allHoldings} onSelect={setSelectedOverviewSymbol} includeAll /></section>
        {selectedOverviewHolding && <PortfolioQuickCard symbol={selectedOverviewHolding.symbol} quote={remoteQuotes[selectedOverviewHolding.symbol]} holding={selectedOverviewHolding} onClose={()=>setSelectedOverviewSymbol(null)} />}
      </>}
      {page === "ashare" && <section className="market-page-content"><div className="market-page-intro"><div><span>CHINA MARKET</span><h2>A股行情</h2><p>重要指数与持仓相关市场信息</p></div></div><CnMarketPanel data={cnMarket} loading={cnMarketLoading} expandedByDefault /></section>}
      {page === "us" && <USMarketPage watchlist={usWatchlist} sectorLists={usSectorLists} quotes={usQuotes} holdings={allHoldings} onWatchlistChange={setUsWatchlist} onSectorListsChange={setUsSectorLists} />}
      <BottomNavigation page={page} onChange={setPage} />
    </section>

    {showAdd && <Modal title="添加一项持仓" eyebrow="PERSONAL PORTFOLIO" description="输入代码后自动显示全名和市场；持仓总成本由均价 × 数量计算。" onClose={() => setShowAdd(false)}><form className="modal-form" onSubmit={addHolding}><label className="wide">代码<input required value={assetForm.symbol} onChange={(event)=>setAssetForm({...assetForm,symbol:event.target.value,market:"",name:""})} placeholder="021000 / 600036 / AAPL" /><small>停止输入约半秒后自动查询</small></label><div className="resolved-identity wide"><span><small>持仓名称</small><strong>{assetLookup.state === "loading" ? "正在识别…" : assetForm.name || "输入代码后自动显示"}</strong></span><span><small>市场种类</small><strong className={assetForm.market ? `market-${assetForm.market}` : ""}>{assetForm.market || "待识别"}</strong></span></div><input type="hidden" required value={assetForm.name} readOnly /><label className="wide">资产分类（由你选择）<select value={assetForm.category} onChange={(event)=>setAssetForm({...assetForm,category:event.target.value as AssetBucket})}>{assetBuckets.map((item)=><option key={item}>{item}</option>)}</select></label><label>持仓均价（{assetForm.market === "美股" ? "USD" : "CNY"}）<input required type="number" min="0" step="any" value={assetForm.avgCost} onChange={(event)=>setAssetForm({...assetForm,avgCost:event.target.value})} /></label><label>持仓数<input required type="number" min="0.00000001" step="any" value={assetForm.quantity} onChange={(event)=>setAssetForm({...assetForm,quantity:event.target.value})} /></label><div className={`api-form-note wide ${assetLookup.state}`}>{assetLookup.state === "idle" ? "行情来源：东方财富、Nasdaq。" : assetLookup.message}</div><ModalActions onCancel={()=>setShowAdd(false)} label="保存到持仓" /></form></Modal>}
    {showSettings && <Modal title="个人偏好" eyebrow="PERSONAL SETTINGS" description="偏好与持仓会安全同步到你的私人面板。" onClose={() => setShowSettings(false)}><form className="modal-form" onSubmit={saveProfile}><label className="wide">你的称呼<input value={profile.name} onChange={(event)=>setProfile({...profile,name:event.target.value})} /></label><label>年度目标（%）<input type="number" value={profile.target} onChange={(event)=>setProfile({...profile,target:event.target.value})} /></label><label>风险偏好<select value={profile.risk} onChange={(event)=>setProfile({...profile,risk:event.target.value})}><option>稳健型</option><option>均衡型</option><option>进取型</option></select></label><div className="device-trust-tools wide"><div><strong>快速打开</strong><small>{deviceAccess.trusted ? "此设备已受信任，180 天内无需再次登录" : "信任本设备后，未来 180 天可以直接打开"}</small></div>{!deviceAccess.trusted && <button type="button" onClick={()=>void trustCurrentDevice()}>信任此设备</button>}{deviceMessage && <p>{deviceMessage}</p>}</div><div className="backup-tools wide"><div><strong>数据备份与迁移</strong><small>首次从 localhost 迁移到正式网页时使用一次</small></div><button type="button" onClick={exportBackup}>导出备份</button><label className="import-backup-button">导入并同步<input type="file" accept="application/json,.json" onChange={(event)=>void importBackup(event)} /></label>{backupMessage && <p>{backupMessage}</p>}</div><ModalActions onCancel={()=>setShowSettings(false)} label="保存偏好" /></form></Modal>}
  </main>;
}

function MarketSparkline({ item }: { item: CnMarketItem }) {
  const prices = item.intraday?.map((point) => point.price).filter(Number.isFinite) ?? [];
  if (prices.length < 2) return <div className="market-spark-empty">暂无日内曲线</div>;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(max - min, Math.abs(max) * .002, .001);
  const points = prices.map((price, index) => `${(index / (prices.length - 1)) * 100},${38 - ((price - min) / span) * 32}`).join(" ");
  return <svg className="market-spark" viewBox="0 0 100 42" preserveAspectRatio="none" role="img" aria-label={`${item.name}今日走势`}><line x1="0" x2="100" y1="22" y2="22" /><polyline points={points} className={(item.changePercent ?? 0) >= 0 ? "cn-up-line" : "cn-down-line"} /></svg>;
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
    const background = positive ? `hsl(0 68% ${Math.max(30, 58 - intensity * 22)}%)` : `hsl(151 47% ${Math.max(30, 58 - intensity * 22)}%)`;
    const name = localizedAssetName(item.symbol, item.name, item.market);
    return <button key={item.symbol} className="treemap-tile" style={{ left:`${rectangle.x}%`, top:`${rectangle.y}%`, width:`${rectangle.w}%`, height:`${rectangle.h}%`, background, color:"#fff" }} onClick={() => onSelect(item.symbol)} aria-label={`查看${name}持仓详情`}><strong>{name}</strong><span>¥{item.value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}</span><small>{percentage.toFixed(1)}% · {historyRate >= 0 ? "+" : ""}{historyRate.toFixed(1)}%</small></button>;
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
  return <div className="quick-stock-card" role="dialog" aria-label={`${symbol}快速信息`}><button className="quick-card-close" onClick={onClose} aria-label="关闭快速信息">×</button><div className="quick-card-title"><strong>{quote?.name || holding?.name || symbol}</strong><span>{symbol} · {holding?.market || quote?.market || "美股"}</span></div><div className="quick-card-price"><b>{price ? `${currency}${price.toLocaleString("en-US", { maximumFractionDigits: 3 })}` : "—"}</b><em className={quoteTone(change)}>{change >= 0 ? "+" : ""}{change.toFixed(2)}% <small>{dayAmount >= 0 ? "+" : "-"}{currency}{Math.abs(dayAmount).toFixed(2)}</small></em></div><div className="quick-card-market"><span>公司市值</span><strong>{marketCap || "行情源暂未提供"}</strong></div>{holding && <div className="quick-card-holding"><span><small>持仓数量</small><b>{holding.quantity.toLocaleString("zh-CN")}</b></span><span><small>持仓市值</small><b>¥{holding.value.toLocaleString("zh-CN")}</b></span><span><small>成本价</small><b>{holding.currency}{holding.avgCost.toLocaleString("zh-CN")}</b></span><span><small>持仓收益</small><b className={holding.value - holding.cost >= 0 ? "up" : "down"}>{holding.value - holding.cost >= 0 ? "+" : "-"}¥{Math.abs(holding.value - holding.cost).toLocaleString("zh-CN")}</b></span><span><small>收益率</small><b className={holdingRate >= 0 ? "up" : "down"}>{holdingRate >= 0 ? "+" : ""}{holdingRate.toFixed(2)}%</b></span></div>}</div>;
}

function USQuoteMatrix({ symbols, quotes, holdings, onSelect }: { symbols: string[]; quotes: Record<string, USQuote>; holdings: Holding[]; onSelect: (symbol: string) => void }) {
  return <div className="us-quote-matrix">{symbols.map((symbol) => {
    const quote = quotes[symbol];
    const holding = holdings.find((item) => item.symbol === symbol);
    const change = quote?.change ?? holding?.change ?? 0;
    const tone = quoteTone(change);
    return <button key={symbol} className={`us-quote-tile ${tone}`} onClick={() => onSelect(symbol)}><i className="ticker-logo" aria-hidden="true">{symbol.replace(".", "").slice(0, 2)}</i><span className="us-tile-name"><strong>{symbol}</strong><small>{usCompanyNames[symbol] || quote?.name || "自选股票"}</small></span><b>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</b><em>{quote ? `${quote.currency}${quote.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "等待行情"}</em></button>;
  })}</div>;
}

function USMarketPage({ watchlist, sectorLists, quotes, holdings, onWatchlistChange, onSectorListsChange }: { watchlist: string[]; sectorLists: Record<string, string[]>; quotes: Record<string, USQuote>; holdings: Holding[]; onWatchlistChange: (symbols: string[]) => void; onSectorListsChange: (lists: Record<string, string[]>) => void }) {
  const [mode, setMode] = useState<"matrix" | "holdings">("matrix");
  const [activeSector, setActiveSector] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [watchInput, setWatchInput] = useState("");
  const [sectorInput, setSectorInput] = useState("");
  const [detailQuotes, setDetailQuotes] = useState<Record<string,USQuote>>({});
  const market = usMarketState();
  const selectedQuote = selectedSymbol ? detailQuotes[selectedSymbol] ?? quotes[selectedSymbol] : undefined;
  const selectedHolding = selectedSymbol ? holdings.find((item) => item.symbol === selectedSymbol) : undefined;
  const addWatch = () => { const symbol = watchInput.trim().toUpperCase(); if (!symbol || watchlist.includes(symbol)) return; onWatchlistChange([...watchlist, symbol]); setWatchInput(""); };
  const removeWatch = (symbol: string) => onWatchlistChange(watchlist.filter((item) => item !== symbol));
  const moveWatch = (index: number, direction: -1 | 1) => { const next = [...watchlist]; const target = index + direction; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; onWatchlistChange(next); };
  const addToSector = () => { const symbol = sectorInput.trim().toUpperCase(); if (!symbol || !activeSector) return; onSectorListsChange({ ...sectorLists, [activeSector]: Array.from(new Set([...(sectorLists[activeSector] || []), symbol])) }); setSectorInput(""); };
  const removeFromSector = (symbol:string) => { if (!activeSector) return; onSectorListsChange({ ...sectorLists, [activeSector]:(sectorLists[activeSector] || []).filter((item)=>item !== symbol) }); };
  const currentSectorSymbols = activeSector ? sectorLists[activeSector] || [] : [];
  useEffect(()=>{
    if (!selectedSymbol || detailQuotes[selectedSymbol]) return;
    const controller = new AbortController();
    fetch(`/api/assets?codes=${encodeURIComponent(selectedSymbol)}&details=1`, { cache:"no-store", signal:controller.signal }).then((response)=>response.json()).then((rawPayload)=>{ const payload = rawPayload as {quotes?:Record<string,USQuote>}; const detail = payload.quotes?.[selectedSymbol]; if (detail) setDetailQuotes((current)=>({ ...current, [selectedSymbol]:detail })); }).catch(()=>undefined);
    return ()=>controller.abort();
  },[detailQuotes,selectedSymbol]);
  const marketCap = selectedQuote?.marketCap ? selectedQuote.marketCap >= 1e12 ? `$${(selectedQuote.marketCap / 1e12).toFixed(2)}万亿` : selectedQuote.marketCap >= 1e9 ? `$${(selectedQuote.marketCap / 1e9).toFixed(1)}十亿` : `$${selectedQuote.marketCap.toLocaleString("en-US")}` : undefined;
  return <section className="market-page-content us-market-page"><div className="market-page-intro"><div><span>US MARKET</span><h2>美股行情</h2><p>矩阵快速浏览，持仓热力图看组合贡献</p></div><div className="us-market-status"><i className={`market-state-dot ${market.state}`} />{market.label}<small>{market.time}</small><button onClick={() => window.location.reload()}>刷新</button></div></div>
    <div className="us-view-switch"><button className={mode === "matrix" ? "active" : ""} onClick={() => setMode("matrix")}>矩阵模式</button><button className={mode === "holdings" ? "active" : ""} onClick={() => setMode("holdings")}>持仓热力图</button></div>
    {mode === "matrix" ? <><section className="us-subpanel"><div className="subsection-head"><div><h3>热门关注</h3><span>等尺寸矩阵 · 点击查看快速信息</span></div><div className="watch-add"><input value={watchInput} onChange={(event) => setWatchInput(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === "Enter") addWatch(); }} placeholder="Ticker / 公司" aria-label="添加美股代码" /><button onClick={addWatch}>+ 添加</button></div></div><USQuoteMatrix symbols={watchlist} quotes={quotes} holdings={holdings} onSelect={setSelectedSymbol} /><div className="watchlist-manage">{watchlist.map((symbol, index) => <span key={symbol}>{symbol}<button onClick={() => moveWatch(index, -1)} aria-label={`${symbol}上移`}>↑</button><button onClick={() => moveWatch(index, 1)} aria-label={`${symbol}下移`}>↓</button><button onClick={() => removeWatch(symbol)} aria-label={`删除${symbol}`}>×</button></span>)}</div></section><section className="us-subpanel"><div className="subsection-head"><div><h3>{activeSector || "行业"}</h3><span>{activeSector ? "重点公司矩阵，可增删自定义" : "点击行业进入重点公司列表"}</span></div>{activeSector && <button className="sector-back" onClick={()=>setActiveSector(null)}>← 返回行业</button>}</div>{!activeSector ? <div className="sector-entry-grid">{Object.keys(sectorLists).map((sector) => <button key={sector} onClick={() => setActiveSector(sector)}><span>{sector}</span><small>{(sectorLists[sector] || []).length} 只重点股票</small><b>›</b></button>)}</div> : <><div className="watch-add sector-add"><input value={sectorInput} onChange={(event) => setSectorInput(event.target.value.toUpperCase())} onKeyDown={(event)=>{ if(event.key === "Enter") addToSector(); }} placeholder="Ticker" aria-label="添加行业股票" /><button onClick={addToSector}>+ 加入 {activeSector}</button></div><USQuoteMatrix symbols={currentSectorSymbols} quotes={quotes} holdings={holdings} onSelect={setSelectedSymbol} /><div className="watchlist-manage sector-manage">{currentSectorSymbols.map((symbol)=><span key={symbol}>{symbol}<button onClick={()=>removeFromSector(symbol)} aria-label={`从${activeSector}删除${symbol}`}>×</button></span>)}</div></>}</section></> : <section className="us-subpanel"><div className="subsection-head"><div><h3>我的美股持仓</h3><span>面积按持仓市值，颜色按今日涨跌</span></div></div><HoldingsHeatmap holdings={holdings} onSelect={setSelectedSymbol} /></section>}
    {selectedSymbol && <PortfolioQuickCard symbol={selectedSymbol} quote={selectedQuote} holding={selectedHolding} marketCap={marketCap} onClose={()=>setSelectedSymbol(null)} />}
  </section>;
}

function BottomNavigation({ page, onChange }: { page: PageKey; onChange: (page: PageKey) => void }) {
  return <nav className="bottom-nav" aria-label="主导航">{([["overview", "资产总览", "总览"], ["ashare", "A股行情", "A股"], ["us", "美股行情", "美股"]] as const).map(([key, label, short]) => <button key={key} className={page === key ? "active" : ""} onClick={() => onChange(key)}><strong>{short}</strong><span>{label}</span></button>)}</nav>;
}

function CnMarketPanel({ data, loading, expandedByDefault = false }: { data: CnMarketResponse | null; loading: boolean; expandedByDefault?: boolean }) {
  const [expanded, setExpanded] = useState(expandedByDefault);
  const items = todayMarketCodes.map((code) => data?.items?.[code]).filter((item): item is CnMarketItem => Boolean(item));
  const stateLabel = data?.marketState === "open" ? "交易中" : data?.marketState === "lunch" ? "午间休市" : data?.marketState === "holiday" ? "休市 / 节假日" : "已收盘";
  const fund = data?.items?.["515450"];
  return <details className="panel cn-market-panel collapsible-market" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary className="market-master-summary"><div><h2>当前实时行情</h2><p>515450、中证红利、科创50 · 按需展开</p></div><div className="cn-market-status"><span className={`market-state ${data?.marketState || "closed"}`}>{stateLabel}</span><small>{loading ? "更新中…" : data?.updatedAt ? `更新 ${new Date(data.updatedAt).toLocaleTimeString("zh-CN", { hour:"2-digit", minute:"2-digit" })}` : "等待数据"}</small></div><span className="collapse-chevron" aria-hidden="true">⌄</span></summary>
    <div className="market-collapsible-body">
      <details className="market-subsection">
        <summary><span><strong>南方红利低波 / 分红信息</strong><small>指数股息率、场外联接基金分红率</small></span><i aria-hidden="true">⌄</i></summary>
        <div className="market-subsection-content">
          <div className="index-yield dividend-yield-row"><span>515450 指数股息率</span><strong>{fund?.indexDividendYieldPercent == null ? "—" : `${fund.indexDividendYieldPercent.toFixed(2)}%`}</strong><small>{fund?.indexDividendYieldAsOf ? `截至 ${fund.indexDividendYieldAsOf}` : "等待更新"}</small></div>
          <div className="yield-explanation"><strong>怎么算？</strong><span>指数股息率 ≈ 过去12个月成分股现金分红 ÷ 成分股总市值。515450 是 ETF，指数股息率不等于 ETF 实际分红率。</span><span>场外联接基金年度分红率 = 过去12个月每份分红合计 ÷ 当前单位净值；A、C、I 份额分别计算，不能混加。</span></div>
          {fund?.linkedFunds?.length ? <div className="linked-fund-distributions"><div className="subsection-head"><h3>515450 场外联接基金分红</h3><span>按当前单位净值计算 · 元/份</span></div><p className="distribution-note">官方公告常按“每10份”披露，页面已除以10换算为“每1份”；日期按净值分红记录日展示。</p><div className="linked-fund-grid">{fund.linkedFunds.map((linkedFund) => <article key={linkedFund.code} className="linked-fund-card"><div className="linked-fund-title"><strong>{linkedFund.name}</strong><small>{linkedFund.code} · 净值 {linkedFund.nav.toFixed(4)}（{linkedFund.navDate}）</small></div><div className="linked-fund-rates"><span><b>近12个月</b><strong>{linkedFund.annualRate.toFixed(2)}%</strong></span><span><b>近半年</b><strong>{linkedFund.halfYearRate.toFixed(2)}%</strong></span><span><b>近季度</b><strong>{linkedFund.quarterRate.toFixed(2)}%</strong></span></div><div className="monthly-distributions">{linkedFund.monthly.map((item) => <span key={item.month}><b>{item.month.slice(5)}月</b><em>¥{item.perShare.toFixed(4)}/份</em><small>{item.date ? item.date.slice(5) : "—"} · {item.rate.toFixed(2)}%</small></span>)}</div></article>)}</div></div> : null}
        </div>
      </details>
      <details className="market-subsection">
        <summary><span><strong>今日行情走势</strong><small>3 个核心标的的价格与日内曲线</small></span><i aria-hidden="true">⌄</i></summary>
        <div className="market-subsection-content"><div className="market-chart-grid">{items.map((item) => <article className="market-chart-card" key={item.symbol}><div className="market-chart-title"><span><strong>{item.name}</strong><small>{item.symbol} · {item.instrumentType === "etf" ? "ETF" : "指数"}</small></span><span><b>{item.instrumentType === "etf" ? "¥" : ""}{item.price.toLocaleString("zh-CN", { maximumFractionDigits:3 })}</b><em className={item.changePercent == null ? "muted" : item.changePercent >= 0 ? "cn-up" : "cn-down"}>{item.changePercent == null ? "—" : `${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`}</em></span></div><MarketSparkline item={item} /></article>)}</div>{!items.length && !loading && <p className="cn-market-note">行情暂时未返回，请稍后刷新。</p>}</div>
      </details>
    </div>
  </details>;
}

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

function HoldingsTable({ holdings, allCount, filter, setFilter, quotes, quoteErrors, onLookup, onSaveAll, onDelete }: { holdings: Holding[]; allCount: number; filter: "全部" | AssetBucket; setFilter: (value: "全部" | AssetBucket) => void; quotes: Record<string, MarketQuote>; quoteErrors: Record<string, string>; onLookup:(symbol:string)=>Promise<MarketQuote | null>; onSaveAll:(edits:{item:Holding;originalSymbol:string}[])=>void; onDelete:(symbol:string)=>void }) {
  const blankHolding = (): Holding => ({ symbol:"", name:"", market:"美股", category:"美股", price:0, currency:"$", change:0, value:0, cost:0, avgCost:0, quantity:0, holdingDays:0, weight:0, spark:[35,35,35,35,35,35,35,35,35,35] });
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Holding>>({});
  const [newDraft, setNewDraft] = useState<Holding>(blankHolding);
  const [numberInputs, setNumberInputs] = useState<Record<string, { avgCost:string; quantity:string }>>({});
  const [editError, setEditError] = useState("");
  const [sortKey, setSortKey] = useState<"default" | "return" | "profit" | "value">("default");
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");
  const [expandedSymbols, setExpandedSymbols] = useState<string[]>([]);
  const sortedHoldings = useMemo(() => {
    if (sortKey === "default") return holdings;
    const metric = (item: Holding) => sortKey === "value" ? item.value : sortKey === "profit" ? item.value - item.cost : item.cost > 0 ? (item.value - item.cost) / item.cost : 0;
    return [...holdings].sort((a, b) => (metric(a) - metric(b)) * (sortDirection === "asc" ? 1 : -1));
  }, [holdings, sortDirection, sortKey]);

  const beginEdit = () => {
    setFilter("全部");
    setDrafts(Object.fromEntries(holdings.map((item) => [item.symbol, { ...item }])));
    setNumberInputs(Object.fromEntries(holdings.map((item) => [item.symbol, { avgCost:String(item.avgCost), quantity:String(item.quantity) }])));
    setNewDraft(blankHolding());
    setEditError("");
    setEditing(true);
  };
  const cancelEdit = () => { setEditing(false); setDrafts({}); setNewDraft(blankHolding()); setNumberInputs({}); setEditError(""); };
  const toggleExpanded = (symbol: string) => setExpandedSymbols((current) => current.includes(symbol) ? current.filter((item) => item !== symbol) : [...current, symbol]);
  const updateDraft = (key: string, patch: Partial<Holding>) => setDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  const lookupExisting = async (key: string) => {
    const draft = drafts[key];
    if (!draft?.symbol.trim()) return;
    const quote = await onLookup(draft.symbol);
    if (quote) updateDraft(key, { symbol:quote.symbol, name:quote.name, market:quote.market, price:quote.price, currency:quote.currency, change:quote.change });
  };
  const lookupNew = async () => {
    if (!newDraft.symbol.trim()) return;
    const quote = await onLookup(newDraft.symbol);
    if (quote) setNewDraft((current) => ({ ...current, symbol:quote.symbol, name:quote.name, market:quote.market, price:quote.price, currency:quote.currency, change:quote.change, category:quote.suggestedCategory ?? (quote.market === "A股" ? "A股" : current.category) }));
  };
  const saveAll = async () => {
    setEditError("");
    let pendingNew = newDraft;
    if (pendingNew.symbol.trim() && !pendingNew.name.trim()) {
      const quote = await onLookup(pendingNew.symbol);
      if (!quote) { setEditError("新增持仓代码无法识别，请检查后重试。"); return; }
      pendingNew = { ...pendingNew, symbol:quote.symbol, name:quote.name, market:quote.market, price:quote.price, currency:quote.currency, change:quote.change };
    }
    const edits = holdings.map((item) => ({ item:drafts[item.symbol] ?? item, originalSymbol:item.symbol }));
    if (pendingNew.symbol.trim()) edits.push({ item:pendingNew, originalSymbol:"" });
    if (edits.some(({ item }) => !item.symbol.trim() || !item.name.trim() || item.quantity <= 0 || item.avgCost < 0)) {
      setEditError("请检查代码、持仓均价和持仓数，持仓数必须大于 0。"); return;
    }
    onSaveAll(edits);
    cancelEdit();
  };

  const editableRow = (draft: Holding, key: string, isNew = false) => {
    const shown = recalculateHolding(draft, quotes);
    const hasQuote = shown.quoteSource !== "unavailable";
    const returnRate = shown.cost > 0 ? ((shown.value - shown.cost) / shown.cost) * 100 : 0;
    const patch = (value: Partial<Holding>) => isNew ? setNewDraft((current)=>({ ...current, ...value })) : updateDraft(key, value);
    const inputKey = isNew ? "__new__" : key;
    const numericText = numberInputs[inputKey] ?? { avgCost:draft.avgCost ? String(draft.avgCost) : "", quantity:draft.quantity ? String(draft.quantity) : "" };
    const updateNumericText = (field: "avgCost" | "quantity", value: string) => {
      setNumberInputs((current) => ({ ...current, [inputKey]: { avgCost:current[inputKey]?.avgCost ?? numericText.avgCost, quantity:current[inputKey]?.quantity ?? numericText.quantity, [field]:value } }));
      patch({ [field]:value === "" ? 0 : Number(value) } as Partial<Holding>);
    };
    return <div className={`holding-row row-editing ${isNew ? "new-holding-row" : hasQuote ? (returnRate >= 0 ? "row-profit" : "row-loss") : ""}`} key={key}>
      <div className="edit-group edit-identity"><span className="edit-group-title">{isNew ? "新增资产" : "资产信息"}</span><div className="inline-asset-fields"><label><small>代码</small><input className="inline-field code-field" value={draft.symbol} onChange={(event)=>patch({symbol:event.target.value.toUpperCase(),name:""})} onBlur={isNew ? lookupNew : ()=>void lookupExisting(key)} placeholder={isNew ? "输入新代码" : "资产代码"} aria-label="资产代码" /></label><label><small>资产分类</small><select className="inline-select" value={draft.category} onChange={(event)=>patch({category:event.target.value as AssetBucket})} aria-label="资产分类">{assetBuckets.map((bucket)=><option key={bucket}>{bucket}</option>)}</select></label></div><small className="inline-lookup-hint">{shown.name || "输入代码后自动识别"} · {shown.market}</small></div>
      <div className="edit-group edit-position"><span className="edit-group-title">持仓数据</span><div className="edit-number-grid"><label><small>持仓均价</small><input className="inline-field number-field" type="number" min="0" step="any" inputMode="decimal" value={numericText.avgCost} onChange={(event)=>updateNumericText("avgCost",event.target.value)} placeholder="均价" aria-label="持仓均价" /></label><label><small>持仓数</small><input className="inline-field number-field" type="number" min="0.00000001" step="any" inputMode="decimal" value={numericText.quantity} onChange={(event)=>updateNumericText("quantity",event.target.value)} placeholder="数量" aria-label="持仓数" /></label></div><small className="edit-cost-note">总成本 ¥{shown.cost.toLocaleString("zh-CN")} · {shown.market === "基金" ? "份额" : "股数"}</small></div>
      <div className="edit-group edit-result"><span className="edit-group-title">实时结果</span><span className="market-price-cell"><strong>{hasQuote ? `${shown.currency}${shown.price.toLocaleString("zh-CN")}` : "—"}</strong><small>{hasQuote ? `${shown.change >= 0 ? "+" : ""}${shown.change.toFixed(2)}% 今日` : quoteErrors[shown.symbol] || "等待行情"}</small></span><div className="inline-position-summary"><span>市值 {hasQuote ? `¥${shown.value.toLocaleString("zh-CN")}` : "—"}</span><b className={hasQuote ? (returnRate >= 0 ? "up" : "down") : ""}>{hasQuote ? `${returnRate >= 0 ? "+" : ""}${returnRate.toFixed(2)}%` : "—"}</b><b className={hasQuote ? (shown.value >= shown.cost ? "up" : "down") : ""}>{hasQuote ? `${shown.value >= shown.cost ? "+" : ""}¥${(shown.value-shown.cost).toLocaleString("zh-CN")}` : "—"}</b></div></div>
    </div>;
  };

  return <section className={`panel holdings-panel ${editing ? "holdings-edit-mode" : ""}`}>
    <div className="panel-head holdings-head">
      <div><h2>我的持仓</h2><p>共 {allCount} 项资产 · {editing ? "全部持仓已解锁，可直接修改或新增" : "盈亏状态与实时行情一目了然"}</p></div>
      <div className="holdings-actions"><span className="quote-status"><i className="status-dot" />行情每 20 秒刷新 · 已更新 {Object.keys(quotes).length} 项</span><select className="bucket-filter" value={filter} onChange={(event)=>setFilter(event.target.value as "全部" | AssetBucket)} aria-label="按资产分类筛选"><option value="全部">全部分类</option>{assetBuckets.map((item)=><option key={item}>{item}</option>)}</select><span className="sort-controls"><select value={sortKey} onChange={(event)=>setSortKey(event.target.value as typeof sortKey)} aria-label="持仓排序方式"><option value="default">默认排序</option><option value="return">按收益率</option><option value="profit">按绝对收益</option><option value="value">按持仓市值</option></select><button onClick={()=>setSortDirection((current)=>current === "desc" ? "asc" : "desc")} disabled={sortKey === "default"} aria-label="切换排序方向">{sortDirection === "desc" ? "↓" : "↑"}</button></span>{editing ? <span className="edit-mode-actions"><button onClick={cancelEdit}>取消</button><button onClick={()=>void saveAll()}>保存全部</button></span> : <button className="portfolio-edit-toggle" onClick={beginEdit}>✎ 编辑持仓</button>}</div>
    </div>
    {editError && <div className="portfolio-edit-error">{editError}</div>}
    {!editing && <div className="mobile-holding-header"><span>资产</span><span>持仓市值</span><span>累计盈亏</span><span>股价</span></div>}
    <div className="holding-table">
      <div className="holding-row holding-header">{editing ? <><span>资产信息</span><span>持仓数据</span><span>实时结果</span></> : <><span>资产</span><span>持仓（市值）</span><span>收益率</span><span>股价</span></>}</div>
      {editing ? <>{sortedHoldings.map((item)=>editableRow(drafts[item.symbol] ?? item, item.symbol))}{editableRow(newDraft, "__new__", true)}</> : sortedHoldings.map((item)=>{
        const hasQuote = item.quoteSource !== "unavailable";
        const returnRate = item.cost > 0 ? ((item.value-item.cost)/item.cost)*100 : 0;
        const expanded = expandedSymbols.includes(item.symbol);
        const toneClass = hasQuote ? (returnRate >= 0 ? "row-profit" : "row-loss") : "";
        return <div className={`holding-entry ${toneClass} ${expanded ? "is-expanded" : ""}`} key={item.symbol}>
          <button type="button" className={`holding-row holding-row-toggle ${toneClass}`} onClick={()=>toggleExpanded(item.symbol)} aria-expanded={expanded} aria-controls={`holding-details-${item.symbol}`}>
            <span className="asset-cell asset-open"><span><strong>{item.name}</strong><small>{item.symbol} · {item.market}</small></span></span>
            <span className="position-value"><strong>{hasQuote ? `¥${item.value.toLocaleString("zh-CN")}` : "—"}</strong><small>{item.category}</small></span>
            <span className={`cumulative-profit ${hasQuote ? (returnRate>=0?"up":"down") : ""}`}><strong>{hasQuote ? `${returnRate>=0?"+":""}${returnRate.toFixed(2)}%` : "—"}</strong><small>{hasQuote ? `${item.value>=item.cost?"+":""}¥${(item.value-item.cost).toLocaleString("zh-CN")}` : "等待行情"}</small></span>
            <span className="market-price-cell"><strong>{hasQuote ? `${item.currency}${item.price.toLocaleString("zh-CN")}` : "—"}</strong><small className={item.change >= 0 ? "up" : "down"}>{hasQuote ? `${item.change >= 0 ? "+" : ""}${item.change.toFixed(2)}%` : quoteErrors[item.symbol] || "等待行情"}</small></span>
          </button>
          {expanded && <div className="holding-details" id={`holding-details-${item.symbol}`}><div><span>资产分类</span><strong>{item.category}</strong></div><div><span>持仓市值</span><strong>{hasQuote ? `¥${item.value.toLocaleString("zh-CN")}` : "—"}</strong></div><div><span>累计收益</span><strong className={hasQuote ? (returnRate>=0?"up":"down") : ""}>{hasQuote ? `${item.value>=item.cost?"+":""}¥${(item.value-item.cost).toLocaleString("zh-CN")}` : "—"}</strong></div><div><span>当前价格</span><strong>{hasQuote ? `${item.currency}${item.price.toLocaleString("zh-CN")}` : "—"}</strong></div><div><span>持仓均价</span><strong>{item.currency}{item.avgCost.toLocaleString("zh-CN", {maximumFractionDigits:6})}</strong></div><div><span>总成本</span><strong>¥{item.cost.toLocaleString("zh-CN")}</strong></div><div><span>持仓数量</span><strong>{item.quantity.toLocaleString("zh-CN")} {item.market === "基金" ? "份" : "股"}</strong></div><button type="button" className="delete-holding-btn" onClick={() => onDelete(item.symbol)}>删除持仓</button></div>}
        </div>;
      })}
    </div>
  </section>;
}

function Modal({ title, eyebrow, description, onClose, children }: { title:string; eyebrow:string; description:string; onClose:()=>void; children:React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event)=>event.stopPropagation()}><div className="modal-head"><div><small>{eyebrow}</small><h2>{title}</h2></div><button onClick={onClose} aria-label="关闭">×</button></div><p>{description}</p>{children}</section></div>;
}

function ModalActions({ onCancel, label }: { onCancel:()=>void; label:string }) {
  return <div className="form-actions"><button type="button" onClick={onCancel}>取消</button><button type="submit">{label}</button></div>;
}
