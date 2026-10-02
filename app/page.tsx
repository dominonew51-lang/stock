"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { strategies, resolveStrategy, strategyAllocation, holdingHeatmapColor, type StrategyBucket } from "./strategy";
import { analysisRanges, filterAnalysisDates } from "./analysis-range";
import { normalizeLookupSymbol } from "./asset-symbol";

type Market = "美股" | "A股" | "基金" | "加密货币" | "现金";
type AssetBucket = "美股指数" | "红利" | "美股" | "A股" | "加密货币" | "现金/类现金";
type MarketQuote = { symbol: string; name: string; market: Market; price: number; currency: "$" | "¥"; change: number; asOf: string; provider: string; suggestedCategory?: AssetBucket; marketCap?: number };
type Holding = {
  symbol: string; name: string; market: Market; price: number; currency: "$" | "¥";
  change: number; value: number; cost: number; avgCost: number; quantity: number;
  holdingDays: number; weight: number; spark: number[]; category: AssetBucket; strategy?: StrategyBucket;
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
const bucketColors: Record<AssetBucket, string> = { "美股指数":"#6366F1", "红利":"#10B981", "美股":"#111827", "A股":"#EF4444", "加密货币":"#818CF8", "现金/类现金":"#F59E0B" };

function normalizeAssetSymbol(value: string) {
  return normalizeLookupSymbol(value);
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

type TrendMode = "return" | "profit" | "assets" | "cost";
type PortfolioSnapshot = { date: string; value: number; cost: number; returnRate: number };
type PortfolioTrend = { dates: string[]; returns: number[]; profits: number[]; costs: number[]; values: number[] };
const usCompanyNames: Record<string,string> = {
  TSLA:"Tesla", COIN:"Coinbase", CRCL:"Circle", NVDA:"NVIDIA", RKLB:"Rocket Lab", PLTR:"Palantir", AVGO:"Broadcom", MSFT:"Microsoft", GOOGL:"Alphabet", AMZN:"Amazon", AMD:"AMD", TSM:"TSMC", ASTS:"AST SpaceMobile", LUNR:"Intuitive Machines", RDW:"Redwire", BA:"Boeing", LMT:"Lockheed Martin", NOC:"Northrop Grumman", RTX:"RTX", PL:"Planet Labs", META:"Meta", NFLX:"Netflix", JPM:"JPMorgan", BAC:"Bank of America", GS:"Goldman Sachs", "BRK.B":"Berkshire Hathaway", LLY:"Eli Lilly", UNH:"UnitedHealth", JNJ:"Johnson & Johnson", MRK:"Merck", XOM:"Exxon Mobil", CVX:"Chevron", COP:"ConocoPhillips", SLB:"SLB", QQQ:"Nasdaq 100 ETF", SPY:"S&P 500 ETF", DIA:"Dow Jones ETF",
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

function buildPortfolioTrend(history: PortfolioSnapshot[], range: string, currentValue: number, currentCost: number, start="", end=""): PortfolioTrend {
  const today = localDateKey();
  const liveSnapshot: PortfolioSnapshot = {
    date: today,
    value: currentValue,
    cost: currentCost,
    returnRate: currentCost > 0 ? ((currentValue - currentCost) / currentCost) * 100 : 0,
  };
  const records = filterAnalysisDates(upsertSnapshot(history, liveSnapshot), range, today, start, end);
  return {
    dates: records.map((item) => item.date),
    values: records.map((item) => item.value),
    costs: records.map((item) => item.cost),
    returns: records.map((item) => item.returnRate),
    profits: records.map((item) => item.value - item.cost),
  };
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
  const primary = mode === "return" ? trend.returns : mode === "profit" ? trend.profits : mode === "cost" ? trend.costs : trend.values;
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
    return ["全部","3年","5年","自定义"].includes(range) ? `${year.slice(2)}/${month}/${day}` : `${month}/${day}`;
  });
  const primaryPoints = trendPoints(primary, min, max);
  const lastPrimaryPoint = primaryPoints[primaryPoints.length - 1];
  const secondaryPoints = secondary ? trendPoints(secondary, min, max) : [];
  const lastSecondaryPoint = secondaryPoints[secondaryPoints.length - 1];
  return <div className={`performance-chart ${compact ? "compact" : ""}`}>
    <div className="chart-y">{labels.map((label,index)=><span key={`${label}-${index}`}>{label}</span>)}</div>
    <svg viewBox="0 0 760 250" preserveAspectRatio="none" role="img" aria-label={`${mode === "return" ? "收益率" : mode === "profit" ? "绝对收益" : mode === "cost" ? "投入本金" : "成本投入与总市值"}走势`}>
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

function allocationPoint(cx:number, cy:number, radius:number, angle:number) {
  const radians = (angle - 90) * Math.PI / 180;
  return { x:cx + radius * Math.cos(radians), y:cy + radius * Math.sin(radians) };
}

function allocationArcPath(start:number, end:number, innerRadius:number, outerRadius:number) {
  const span = Math.max(0, end - start);
  const gap = Math.min(0.9, span * 0.18);
  const arcStart = start + gap;
  const arcEnd = Math.min(end - gap, arcStart + 359.99);
  const outerStart = allocationPoint(210, 145, outerRadius, arcStart);
  const outerEnd = allocationPoint(210, 145, outerRadius, arcEnd);
  const innerEnd = allocationPoint(210, 145, innerRadius, arcEnd);
  const innerStart = allocationPoint(210, 145, innerRadius, arcStart);
  const largeArc = arcEnd - arcStart > 180 ? 1 : 0;
  return `M ${outerStart.x} ${outerStart.y} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y} L ${innerEnd.x} ${innerEnd.y} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y} Z`;
}


function StrategyRing({rows, invested, onSelect, caption = "已投资资产"}:{caption?:string;rows:ReturnType<typeof strategyAllocation>["rows"]; invested:number; onSelect:(strategy:StrategyBucket)=>void}) {
  let offset=0;
  const segments=rows.filter(row=>row.amount>0).map(row=>{
    const start=offset; offset+=row.percent*3.6;
    const point=allocationPoint(210,145,91,(start+offset)/2);
    return {...row,start,end:offset,point,left:point.x<210,labelY:point.y};
  });
  for(const left of [true,false]) {
    const side=segments.filter(row=>row.left===left).sort((a,b)=>a.labelY-b.labelY);
    side.forEach((row,index)=>{ row.labelY=Math.max(40,row.labelY,index ? side[index-1].labelY+38 : 40); });
    if(side.length && side[side.length-1].labelY>246) {
      side[side.length-1].labelY=246;
      for(let i=side.length-2;i>=0;i--) side[i].labelY=Math.min(side[i].labelY,side[i+1].labelY-38);
    }
  }
  return <svg viewBox="0 0 420 290" role="img" aria-label="投资方向及实际占比">
    {segments.map(row=><g key={row.strategy} role="button" tabIndex={0} aria-label={`${row.strategy} ${row.percent.toFixed(1)}%，查看持仓`} className="strategy-chart-segment" onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();onSelect(row.strategy);}}} onClick={()=>onSelect(row.strategy)}>
      <path d={allocationArcPath(row.start,row.end,53,85)} fill={row.color}><title>{row.strategy} {row.percent.toFixed(1)}%</title></path>
      <polyline points={`${row.point.x},${row.point.y} ${row.left?112:308},${row.labelY} ${row.left?100:320},${row.labelY}`} fill="none" stroke="#aab8c5" strokeWidth="1"/>
      <text x={row.left?96:324} y={row.labelY-4} textAnchor={row.left?"end":"start"} className="strategy-callout"><tspan>{row.strategy==="AI Infrastructure"?"AI Infra":row.strategy}</tspan><tspan x={row.left?96:324} dy="17">{row.percent.toFixed(1)}%</tspan></text>
    </g>)}
    <text x="210" y="138" textAnchor="middle" className="strategy-center-label">{caption}</text>
    <text x="210" y="159" textAnchor="middle" className="strategy-center-value">¥{invested.toLocaleString("zh-CN",{maximumFractionDigits:0})}</text>
  </svg>;
}

function AllocationContent({ holdings, onManage, onSelect }: { holdings:Holding[]; onManage:(strategy?:StrategyBucket)=>void; onSelect:(symbol:string)=>void }) {
  const [basis, setBasis] = useState<"value"|"cost">("value");
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyBucket | null>(null);
  useEffect(()=>{
    if (!selectedStrategy) return;
    const scrollY=window.scrollY;
    const oldStyle=document.body.style.cssText;
    document.body.style.position="fixed";
    document.body.style.top=`-${scrollY}px`;
    document.body.style.width="100%";
    document.body.style.overflow="hidden";
    const close=(event:KeyboardEvent)=>{ if(event.key==="Escape") setSelectedStrategy(null); };
    window.addEventListener("keydown",close);
    return ()=>{ document.body.style.cssText=oldStyle; window.scrollTo(0,scrollY); window.removeEventListener("keydown",close); };
  },[selectedStrategy]);
  const allocation = strategyAllocation(holdings);
  const { unclassified, unclassifiedCount } = allocation;
  const invested = basis === "cost" ? allocation.totalCost : allocation.invested;
  const rows = allocation.rows.map(row => basis === "cost" ? {...row, amount:row.cost, percent:row.costPercent} : row);
  const money = (value:number) => `¥${value.toLocaleString("zh-CN", {maximumFractionDigits:0})}`;
  const selectedRow = selectedStrategy ? rows.find(item=>item.strategy===selectedStrategy) : null;
  const strategyHoldings = selectedStrategy ? holdings.filter(item=>resolveStrategy(item)===selectedStrategy && item.value>0) : [];
  return <div className="allocation-content">
    <div className="strategy-allocation">
      <div className="strategy-basis-switch" role="group" aria-label="投资方向统计口径">{([["value","市值"],["cost","成本"]] as const).map(([id,label])=><button type="button" key={id} aria-pressed={basis===id} onClick={()=>setBasis(id)}>{label}</button>)}</div>
      <div className="strategy-main">
        {invested > 0 ? <StrategyRing rows={rows} invested={invested} caption={basis==="cost" ? "已分类资产成本" : "已投资资产"} onSelect={setSelectedStrategy}/> : <div className="empty-state">{basis==="cost" ? "暂无已分类资产成本" : "暂无已分类投资资产"}</div>}
        <div className="strategy-rows">{rows.map(row=><button type="button" className="strategy-row" key={row.strategy} onClick={()=>setSelectedStrategy(row.strategy)}><span className="strategy-name"><i style={{background:row.color}}/>{row.strategy}</span><span className="strategy-money">{money(row.amount)}</span><strong>{row.percent.toFixed(1)}%</strong></button>)}</div>
      </div>
      <p className="strategy-note">{basis==="cost" ? "按当前已分类持仓成本统计，包含 Cash；非历史累计入金。" : "策略占比按全部已分类资产计算，Cash 包含人民币、美元与 USDT。"}</p>
      {unclassifiedCount > 0 && <button className="strategy-unclassified" onClick={()=>onManage()}>待分类 {unclassifiedCount} 项 · {money(unclassified)} <span>去分类 ›</span></button>}
    </div>
    {selectedStrategy && selectedRow && createPortal(<div className="app-shell overview-only" style={{display:"contents"}}><div className="strategy-modal-backdrop" role="presentation" onMouseDown={()=>setSelectedStrategy(null)}>
      <section className="strategy-modal" role="dialog" aria-modal="true" aria-label={`${selectedStrategy} 持仓详情`} onMouseDown={(event)=>event.stopPropagation()}>
        <div className="strategy-modal-grabber" />
        <header className="strategy-modal-head"><div><span>投资方向</span><h3>{selectedStrategy}</h3><p>{basis==="cost" ? "成本" : "市值"} {money(selectedRow.amount)} · {selectedRow.percent.toFixed(1)}%</p></div><button type="button" onClick={()=>setSelectedStrategy(null)} aria-label={`关闭 ${selectedStrategy} 详情`}>×</button></header>
        <p className="strategy-modal-note">方向内持仓按市值分布</p>
        {strategyHoldings.length ? <HoldingsHeatmap holdings={strategyHoldings} onSelect={(symbol)=>{ setSelectedStrategy(null); onSelect(symbol); }} includeAll /> : <div className="strategy-modal-empty"><p>这个方向暂时没有持仓</p><button type="button" onClick={()=>{setSelectedStrategy(null);onManage(selectedStrategy);}}>新增持仓</button></div>}
        {strategyHoldings.length > 0 && <footer><button type="button" onClick={()=>{ setSelectedStrategy(null); onManage(selectedStrategy); }}>编辑持仓</button></footer>}
      </section>
    </div></div>,document.body)}
  </div>;
}
export default function Home() {
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [query, setQuery] = useState("");
  const [bucketFilter, setBucketFilter] = useState<"全部" | AssetBucket>("全部");
  const [customHoldings, setCustomHoldings] = useState<Holding[]>([]);
  const [remoteQuotes, setRemoteQuotes] = useState<Record<string, MarketQuote>>({});
  const [quoteErrors, setQuoteErrors] = useState<Record<string, string>>({});
  const [useDemoHoldings, setUseDemoHoldings] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showHoldingsEditor, setShowHoldingsEditor] = useState(false);
  const [editingHoldingSymbol, setEditingHoldingSymbol] = useState<string | null>(null);
  const [editorStrategyFilter, setEditorStrategyFilter] = useState<StrategyBucket | null>(null);
  const [amountsVisible, setAmountsVisible] = useState(true);
  const [baseCurrency, setBaseCurrency] = useState<"CNY" | "USD">("CNY");
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
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
      void navigator.serviceWorker.register("/sw.js?rev=20261001-compact-summary").then((registration) => registration.update()).catch(() => undefined);
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

  const portfolioTrend = useMemo(() => buildPortfolioTrend(portfolioHistory, "1年", totalValue, totalCost), [portfolioHistory, totalCost, totalValue]);
  const monthTrend = useMemo(() => buildPortfolioTrend(portfolioHistory, "1月", totalValue, totalCost), [portfolioHistory, totalCost, totalValue]);
  const currentMonth = localDateKey().slice(0, 7);
  const monthStartIndex = monthTrend.dates.findIndex((date) => date.startsWith(currentMonth));
  const monthStartProfit = monthStartIndex >= 0 ? monthTrend.values[monthStartIndex] - monthTrend.costs[monthStartIndex] : profit;
  const monthStartCost = monthStartIndex >= 0 ? monthTrend.costs[monthStartIndex] : totalCost;
  const monthlyProfit = profit - monthStartProfit;
  const monthlyReturn = monthStartCost > 0 ? (monthlyProfit / monthStartCost) * 100 : 0;
  const longTermStartDate = longTermStart ? new Date(`${longTermStart}T00:00:00`) : new Date();
  const todayStart = new Date(`${localDateKey()}T00:00:00`);
  const longTermDays = Math.max(1, Math.floor((todayStart.getTime() - longTermStartDate.getTime()) / 86400000) + 1);
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

  return <main className="app-shell overview-only portfolio-home">
    <section className="workspace">
      <header className="topbar">
        <div><div className="topbar-title-line"><h1>Minimalism</h1><span className="long-term-inline">坚持长期主义 <b>{longTermDays}</b> 天</span></div><div className="topbar-meta"><span className="page-kicker">PRIVATE PORTFOLIO</span><span className="topbar-updated">{lastUpdatedAt ? `更新于 ${lastUpdatedAt.toLocaleTimeString("zh-CN", { hour:"2-digit", minute:"2-digit" })}` : "等待数据"}</span></div></div>
      </header>
      <>
        <section className="portfolio-summary">
          <div className="portfolio-balance">
            <div className="balance-heading"><span>总资产 · {baseCurrency}</span><button type="button" onClick={()=>setAmountsVisible(!amountsVisible)} aria-label="显示或隐藏金额">{amountsVisible ? "◉" : "○"}</button><div className="balance-currency">{(["CNY","USD"] as const).map(currency=><button type="button" key={currency} aria-pressed={baseCurrency===currency} onClick={()=>setBaseCurrency(currency)}>{currency}</button>)}</div></div>
            <div className="balance-number">{amountsVisible ? `${currencySymbol}${shownTotal.toLocaleString("zh-CN",{maximumFractionDigits:2})}` : "••••••"}</div>
            <div className="balance-daily"><span>今日盈亏</span><strong className={dailyProfit>=0?"up":"down"}>{amountsVisible ? `${dailyProfit>=0?"+":"−"}${currencySymbol}${Math.abs(shownDailyProfit).toLocaleString("zh-CN",{maximumFractionDigits:2})}` : "••••"} <small>{dailyReturn>=0?"+":""}{dailyReturn.toFixed(2)}%</small></strong></div>
            <div className="balance-kpis">
              <div><span>当月收益</span><strong className={monthlyReturn>=0?"up":"down"}>{monthlyReturn>=0?"+":""}{monthlyReturn.toFixed(2)}%</strong><small>{amountsVisible ? `${monthlyProfit>=0?"+":"−"}¥${Math.abs(monthlyProfit).toLocaleString("zh-CN",{maximumFractionDigits:2})}` : "••••"}</small></div>
              <div><span>今年收益</span><strong className={profitRate>=0?"up":"down"}>{profitRate>=0?"+":""}{profitRate.toFixed(2)}%</strong><small>{amountsVisible ? `${profit>=0?"+":"−"}¥${Math.abs(profit).toLocaleString("zh-CN",{maximumFractionDigits:2})}` : "••••"}</small></div>
            </div>
          </div>
          <div className="portfolio-preview"><header><div><span>组合收益率</span><strong className={profitRate>=0?"up":"down"}>{profitRate>=0?"+":""}{profitRate.toFixed(2)}%</strong></div><button type="button" className="portfolio-button" onClick={()=>setShowAnalysis(true)}>资产分析 <span aria-hidden="true">↗</span></button></header><ReturnSparkline trend={portfolioTrend}/><p>近一年走势 · 按每日资产快照记录</p></div>
        </section>
        <section className="portfolio-allocation"><header className="portfolio-section-heading"><div><h2>投资方向</h2><p>看清资产分布，保持自己的节奏</p></div></header><AllocationContent holdings={allHoldings} onSelect={setSelectedOverviewSymbol} onManage={(strategy)=>{setEditorStrategyFilter(strategy ?? null);setEditingHoldingSymbol(null);setShowHoldingsEditor(true);}} /></section>
        <section className="panel overview-heatmap-section"><div className="section-inline-head"><div><h2>持仓热力图</h2><p>面积按持仓市值，颜色按历史收益；点击查看持仓详情</p></div><button className="heatmap-edit-btn" onClick={() => { setEditorStrategyFilter(null); setEditingHoldingSymbol(null); setShowHoldingsEditor(true); }}>{showHoldingsEditor ? "关闭管理" : "管理持仓"}</button></div><HoldingsHeatmap holdings={allHoldings} onSelect={setSelectedOverviewSymbol} includeAll /></section>
        <HoldingCards holdings={allHoldings} onManage={()=>{setEditorStrategyFilter(null);setEditingHoldingSymbol(null);setShowHoldingsEditor(true);}} />
        {showAnalysis && <AnalysisDialog history={portfolioHistory} totalValue={totalValue} totalCost={totalCost} onClose={()=>setShowAnalysis(false)}/>}
        {selectedOverviewHolding && <PortfolioQuickCard symbol={selectedOverviewHolding.symbol} quote={remoteQuotes[selectedOverviewHolding.symbol]} holding={selectedOverviewHolding} onClose={()=>setSelectedOverviewSymbol(null)} />}
        {showHoldingsEditor && <HoldingEditorDrawer holdings={editorStrategyFilter ? allHoldings.filter(item=>resolveStrategy(item)===editorStrategyFilter) : allHoldings} quotes={remoteQuotes} initialSymbol={editingHoldingSymbol} initialStrategy={editorStrategyFilter} onLookup={lookupAssetCode} onSaveAll={saveHoldings} onDelete={deleteHolding} onClose={()=>{ setShowHoldingsEditor(false); setEditingHoldingSymbol(null); setEditorStrategyFilter(null); }} />}
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
  </main>;
}

function ReturnSparkline({trend}:{trend:PortfolioTrend}) {
  const values=trend.returns.filter(Number.isFinite);
  if(values.length<2) return <div className="sparkline-empty">累计两天记录后显示走势</div>;
  const lo=Math.min(...values), hi=Math.max(...values), padding=Math.max((hi-lo)*.2,.1);
  const points=trendPoints(values,lo-padding,hi+padding);
  const last=points[points.length-1];
  return <svg className="return-sparkline" viewBox="-8 0 776 250" preserveAspectRatio="none" role="img" aria-label="近一年组合收益率简图"><path d={smoothTrendPath(values,lo-padding,hi+padding)} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/><circle cx={last.x} cy={last.y} r="4" fill="currentColor"/></svg>;
}

function AnalysisDialog({history,totalValue,totalCost,onClose}:{history:PortfolioSnapshot[];totalValue:number;totalCost:number;onClose:()=>void}) {
  const [mode,setMode]=useState<TrendMode>("return");
  const [range,setRange]=useState("1年");
  const [start,setStart]=useState("");
  const [end,setEnd]=useState(localDateKey());
  const dialog=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement | null;
    const style=document.body.style.cssText, scrollY=window.scrollY;
    document.body.style.position="fixed";document.body.style.top=`-${scrollY}px`;document.body.style.width="100%";
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==="Escape") onClose();
      if(event.key!=="Tab") return;
      const controls=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]') ?? []);
      const first=controls[0], last=controls[controls.length-1];
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
      if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener("keydown",keydown);
    return ()=>{document.body.style.cssText=style;window.scrollTo(0,scrollY);document.removeEventListener("keydown",keydown);previous?.focus();};
  },[onClose]);
  const invalid=range==="自定义" && !!start && !!end && start>end;
  const trend=buildPortfolioTrend(history,range,totalValue,totalCost,start,end);
  const series=mode==="return"?trend.returns:mode==="profit"?trend.profits:mode==="cost"?trend.costs:trend.values;
  const last=series.at(-1);
  const title={return:"组合收益率",profit:"持仓收益",assets:"总市值",cost:"投入本金"}[mode];
  const display=last===undefined?"—":mode==="return"?`${last>=0?"+":""}${last.toFixed(2)}%`:`¥${last.toLocaleString("zh-CN",{maximumFractionDigits:2})}`;
  return createPortal(<div className="app-shell overview-only portfolio-home" style={{display:"contents"}}><div className="analysis-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={dialog} className="analysis-dialog" role="dialog" aria-modal="true" aria-labelledby="analysis-dialog-title">
    <header className="analysis-dialog-heading"><div><h2 id="analysis-dialog-title">资产分析</h2><p>从时间中观察，而不是从波动中判断</p></div><button type="button" className="analysis-close" aria-label="关闭资产分析" onClick={onClose}>×</button></header>
    <div className="analysis-modes" role="group" aria-label="分析指标">{([["return","收益率"],["profit","收益"],["assets","市值"],["cost","投入本金"]] as const).map(([id,label])=><button type="button" key={id} aria-pressed={mode===id} onClick={()=>setMode(id)}>{label}</button>)}</div>
    <div className="analysis-stat"><span>{title}<small>所选区间最后记录</small></span><strong className={mode==="return"||mode==="profit"?(last!==undefined&&last<0?"down":"up"):""}>{display}</strong>{mode==="assets" && <small>虚线为持仓成本</small>}</div>
    <div className="analysis-periods" role="group" aria-label="分析时间范围">{analysisRanges.map(item=><button type="button" key={item} aria-pressed={range===item} onClick={()=>setRange(item)}>{item}</button>)}</div>
    {range==="自定义" && <div className="analysis-dates"><label>开始日期<input type="date" aria-label="开始日期" max={localDateKey()} value={start} onChange={e=>setStart(e.target.value)}/></label><span>至</span><label>结束日期<input type="date" aria-label="结束日期" max={localDateKey()} value={end} onChange={e=>setEnd(e.target.value)}/></label></div>}
    {invalid?<p className="analysis-empty" role="alert">开始日期不能晚于结束日期</p>:!trend.dates.length?<p className="analysis-empty">这段时间还没有资产记录，请选择其他日期。</p>:<PerformanceChart trend={trend} mode={mode} range={range}/>}
    <footer>{trend.dates.length>0&&!invalid?`${trend.dates[0]} — ${trend.dates.at(-1)} · ${trend.dates.length} 条记录` : "仅展示真实资产记录"}<span>按人民币计价 · 本金为当前持仓成本，不是历史累计入金</span></footer>
  </div></div></div>,document.body);
}

function HoldingCards({holdings,onManage}:{holdings:Holding[];onManage:()=>void}) {
  const [sort,setSort]=useState<"value"|"return">("value");
  const [descending,setDescending]=useState(true);
  const [expanded,setExpanded]=useState<string|null>(null);
  const rate=(item:Holding)=>item.cost>0?(item.value-item.cost)/item.cost*100:0;
  const sorted=[...holdings].sort((a,b)=>(descending?-1:1)*((sort==="value"?a.value-b.value:rate(a)-rate(b)))||a.symbol.localeCompare(b.symbol));
  const money=(value:number,currency="¥")=>`${currency}${value.toLocaleString("zh-CN",{maximumFractionDigits:2})}`;
  return <section className="holding-cards"><header className="portfolio-section-heading"><div><h2>持仓明细 <small>{holdings.length}</small></h2><p>点击持仓，查看成本与数量</p></div><div className="holding-sort"><label className="sr-only" htmlFor="holding-sort">持仓排序</label><select id="holding-sort" value={sort} onChange={e=>setSort(e.target.value as "value"|"return")}><option value="value">按金额</option><option value="return">按收益率</option></select><button type="button" aria-label={descending?"切换为升序":"切换为降序"} onClick={()=>setDescending(!descending)}>{descending?"↓":"↑"}</button></div></header>
    <div className="holding-card-columns" aria-hidden="true"><span>资产</span><span>持仓市值</span><span>收益率</span><span/></div>
    {!sorted.length && <div className="analysis-empty">暂无持仓 <button type="button" className="portfolio-button" onClick={onManage}>添加持仓</button></div>}
    {sorted.map(item=><article className="holding-card" key={item.symbol}><button type="button" className="holding-card-toggle" aria-expanded={expanded===item.symbol} aria-controls={`holding-details-${item.symbol}`} onClick={()=>setExpanded(expanded===item.symbol?null:item.symbol)}><span className="holding-card-name"><strong>{localizedAssetName(item.symbol,item.name,item.market)}</strong><small>{item.symbol} · {resolveStrategy(item)??"待分类"}</small></span><strong className="holding-card-amount">{money(item.value)}</strong><strong className={rate(item)>=0?"up":"down"}>{rate(item)>=0?"+":""}{rate(item).toFixed(2)}%</strong><span className="holding-card-chevron" aria-hidden="true">{expanded===item.symbol?"−":"+"}</span></button>{expanded===item.symbol && <dl id={`holding-details-${item.symbol}`} className="holding-card-details"><div><dt>持仓成本</dt><dd>{money(item.cost)}</dd></div><div><dt>成本价</dt><dd>{money(item.avgCost,item.currency)}</dd></div><div><dt>持仓数量</dt><dd>{item.quantity.toLocaleString("zh-CN",{maximumFractionDigits:8})}</dd></div><div><dt>当前价格</dt><dd>{money(item.price,item.currency)}</dd></div><div><dt>持仓收益</dt><dd className={item.value>=item.cost?"up":"down"}>{money(item.value-item.cost)}</dd></div><div><dt>今日涨跌</dt><dd className={item.change>=0?"up":"down"}>{item.change>=0?"+":""}{item.change.toFixed(2)}%</dd></div></dl>}</article>)}
  </section>;
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
    const background = holdingHeatmapColor(historyRate);
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

function HoldingEditorDrawer({ holdings, quotes, initialSymbol, initialStrategy, onLookup, onSaveAll, onDelete, onClose }: { holdings: Holding[]; quotes: Record<string, MarketQuote>; initialSymbol: string | null; initialStrategy?: StrategyBucket | null; onLookup:(symbol:string)=>Promise<MarketQuote | null>; onSaveAll:(edits:{item:Holding;originalSymbol:string}[])=>void; onDelete:(symbol:string)=>void; onClose:()=>void }) {
  const blankHolding = (): Holding => ({ symbol:"", name:"", market:"美股", category:"美股", price:0, currency:"$", change:0, value:0, cost:0, avgCost:0, quantity:0, holdingDays:0, weight:0, spark:[35,35,35,35,35,35,35,35,35,35] });
  const [selected, setSelected] = useState<string | null>(initialSymbol);
  const [draft, setDraft] = useState<Holding>(() => initialSymbol ? { ...(holdings.find((item)=>item.symbol === initialSymbol) ?? blankHolding()) } : blankHolding());
  const [numberText, setNumberText] = useState({ avgCost: initialSymbol ? String(holdings.find((item)=>item.symbol === initialSymbol)?.avgCost ?? "") : "", quantity: initialSymbol ? String(holdings.find((item)=>item.symbol === initialSymbol)?.quantity ?? "") : "" });
  const [message, setMessage] = useState("");
  const isNew = selected === "__new__";
  const choose = (symbol: string) => { const item = holdings.find((holding)=>holding.symbol === symbol); if (!item) return; setSelected(symbol); setDraft({ ...item }); setNumberText({ avgCost:String(item.avgCost), quantity:String(item.quantity) }); setMessage(""); };
  const startNew = () => { setSelected("__new__"); setDraft({...blankHolding(), strategy:initialStrategy ?? undefined}); setNumberText({ avgCost:"", quantity:"" }); setMessage(""); };
  const lookup = async () => { const symbol = normalizeAssetSymbol(draft.symbol); if (!symbol) return; const quote = await onLookup(symbol); if (!quote) { setMessage("代码无法识别，请检查后重试。"); return; } const cash = quote.market === "现金" || isCashSymbol(symbol); setDraft((current)=>({ ...current, symbol:quote.symbol, name:quote.name, market:quote.market, price:quote.price, currency:quote.currency, change:quote.change, avgCost:cash ? 1 : current.avgCost, strategy:cash ? "Cash" : current.strategy, category:quote.suggestedCategory ?? (quote.market === "A股" ? "A股" : quote.market === "加密货币" ? "加密货币" : current.category) })); if (cash) setNumberText((current)=>({ ...current, avgCost:"1" })); setMessage(cash ? "现金资产已识别，策略固定为 Cash" : `${conciseUSCompanyName(quote.symbol, quote.name)} 已识别${quote.price > 0 ? ` · ${quote.currency}${quote.price}` : " · 行情稍后更新"}`); };
  const save = async () => { setMessage(""); let next = draft; if (next.symbol.trim() && (!next.name.trim() || isCashSymbol(next.symbol))) { const quote = await onLookup(next.symbol); if (!quote) { setMessage("代码无法识别，请检查后重试。"); return; } next = { ...next, symbol:quote.symbol, name:quote.name, market:quote.market, price:quote.price, currency:quote.currency, change:quote.change, category:quote.suggestedCategory ?? next.category, avgCost:quote.market === "现金" ? 1 : next.avgCost }; }
    if (!next.symbol.trim() || !next.name.trim() || next.quantity <= 0 || next.avgCost < 0) { setMessage("请填写代码、均价和持仓数，持仓数必须大于 0。"); return; }
    next = { ...next, strategy:resolveStrategy(next) };
    if (!isCashSymbol(next.symbol) && !next.strategy) { setMessage("请选择策略仓位后保存。"); return; }
    onSaveAll([{ item:next, originalSymbol:isNew ? "" : selected || next.symbol }]); onClose();
  };
  const shown = recalculateHolding(draft, quotes);
  const cashDraft = isCashSymbol(draft.symbol);
  return <div className="holding-editor-backdrop" role="presentation" onMouseDown={onClose}><section className="holding-editor-drawer" role="dialog" aria-modal="true" aria-label="管理持仓" onMouseDown={(event)=>event.stopPropagation()}><div className="holding-editor-grabber" /><header><div><span>PORTFOLIO CONTROL</span><h2>{selected ? (isNew ? "新增持仓" : "编辑持仓") : "管理持仓"}</h2></div><button type="button" onClick={onClose} aria-label="关闭持仓管理">×</button></header>{!selected ? <div className="holding-picker"><p>选择一项持仓进行修改，或新增一项资产。</p><div>{holdings.map((item)=><button type="button" key={item.symbol} onClick={()=>choose(item.symbol)}><span><strong>{localizedAssetName(item.symbol,item.name,item.market)}</strong><small>{item.symbol} · {item.category}</small></span><b>›</b></button>)}</div><button type="button" className="holding-add-entry" onClick={startNew}>＋ 新增持仓</button></div> : <div className="holding-editor-form"><div className="drawer-identity"><strong>{shown.name || (isNew ? "待识别资产" : localizedAssetName(shown.symbol,shown.name,shown.market))}</strong><small>{shown.symbol || "输入代码"} · {shown.market}</small></div><div className="drawer-fields"><label><small>代码</small><input className="inline-field code-field" value={draft.symbol} onChange={(event)=>setDraft((current)=>({ ...current, symbol:event.target.value, name:"", strategy:undefined }))} onBlur={()=>void lookup()} autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off" placeholder="AAPL / 601985 / BTC" aria-label="资产代码" /></label><label><small>资产分类</small><select className="inline-select" value={draft.category} onChange={(event)=>setDraft((current)=>({ ...current, category:event.target.value as AssetBucket }))} aria-label="资产分类">{assetBuckets.map((bucket)=><option key={bucket}>{bucket}</option>)}</select></label><label className="strategy-editor-field"><small>策略仓位</small><select className="inline-select" aria-label="策略仓位" disabled={cashDraft} value={cashDraft ? "Cash" : resolveStrategy(draft) ?? ""} onChange={(event)=>setDraft(current=>({...current,strategy:event.target.value as StrategyBucket}))}>{cashDraft ? <option value="Cash">Cash</option> : <><option value="">待分类 · 请选择</option>{strategies.filter(strategy=>strategy!=="Cash").map(strategy=><option key={strategy} value={strategy}>{strategy}</option>)}</>}</select></label><label><small>{cashDraft ? "现金面值" : "持仓均价"}</small><input className="inline-field number-field" type="number" min="0" step="any" inputMode="decimal" value={cashDraft ? "1" : numberText.avgCost} readOnly={cashDraft} onChange={(event)=>{ const value=event.target.value; setNumberText((current)=>({ ...current, avgCost:value })); setDraft((current)=>({ ...current, avgCost:value === "" ? 0 : Number(value) })); }} placeholder="均价" aria-label={cashDraft ? "现金面值" : "持仓均价"} /></label><label><small>持仓数 / 余额</small><input className="inline-field number-field" type="number" min="0.00000001" step="any" inputMode="decimal" value={numberText.quantity} onChange={(event)=>{ const value=event.target.value; setNumberText((current)=>({ ...current, quantity:value })); setDraft((current)=>({ ...current, quantity:value === "" ? 0 : Number(value) })); }} placeholder="数量" aria-label="持仓数或现金余额" /></label></div><p className={`drawer-message ${message ? "visible" : ""}`} role="status">{message || (cashDraft ? "现金资产归入 Cash 方向" : "代码失焦后自动识别名称和行情")}</p><div className="drawer-actions"><button type="button" className="drawer-secondary" onClick={()=>setSelected(null)}>返回列表</button>{!isNew && <button type="button" className="drawer-danger" onClick={()=>{ if (window.confirm("确定删除这项持仓吗？")) { onDelete(selected || draft.symbol); onClose(); } }}>删除持仓</button>}<button type="button" className="drawer-primary" onClick={()=>void save()}>保存</button></div></div>}</section></div>;
}

function Modal({ title, eyebrow, description, onClose, children }: { title:string; eyebrow:string; description:string; onClose:()=>void; children:React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event)=>event.stopPropagation()}><div className="modal-head"><div><small>{eyebrow}</small><h2>{title}</h2></div><button onClick={onClose} aria-label="关闭">×</button></div><p>{description}</p>{children}</section></div>;
}

function ModalActions({ onCancel, label }: { onCancel:()=>void; label:string }) {
  return <div className="form-actions"><button type="button" onClick={onCancel}>取消</button><button type="submit">{label}</button></div>;
}
