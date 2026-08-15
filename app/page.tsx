"use client";

import { useEffect, useMemo, useState } from "react";

type Market = "美股" | "A股" | "基金";
type AssetBucket = "美股指数" | "红利" | "美股" | "现金/类现金";
type MarketQuote = { symbol: string; name: string; market: Market; price: number; currency: "$" | "¥"; change: number; asOf: string; provider: string; suggestedCategory?: AssetBucket };
type Holding = {
  symbol: string; name: string; market: Market; price: number; currency: "$" | "¥";
  change: number; value: number; cost: number; avgCost: number; quantity: number;
  holdingDays: number; weight: number; spark: number[]; category: AssetBucket;
  quoteSource?: "api" | "demo" | "unavailable"; quoteProvider?: string; quoteAsOf?: string; sourceSymbol?: string;
};
type Profile = { name: string; target: string; risk: string };
type CloudPortfolioState = { holdings: Holding[]; profile: Profile; useDemoHoldings: boolean; longTermStart: string };
type SyncStatus = "loading" | "syncing" | "synced" | "offline";
type DeviceAccessState = {
  status: "checking" | "authorized" | "locked" | "error";
  source: "chatgpt" | "device" | "local" | null;
  trusted: boolean;
  message: string;
};

const assetBuckets: AssetBucket[] = ["美股指数", "红利", "美股", "现金/类现金"];
const bucketClasses: Record<AssetBucket, string> = { "美股指数": "c-nasdaq", "红利": "c-dividend", "美股": "c-growth", "现金/类现金": "c-cash" };
const bucketColors: Record<AssetBucket, string> = { "美股指数":"#635BFF", "红利":"#00BFA6", "美股":"#00AEEF", "现金/类现金":"#FFB15C" };

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
  return name;
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
  if (legacy === "加密货币") return "现金/类现金";
  if (assetBuckets.includes(legacy as AssetBucket)) return legacy as AssetBucket;
  if (item.symbol === "QQQ") return "美股指数";
  if (item.symbol === "006962") return "现金/类现金";
  if (item.market === "美股") return "美股";
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

type TrendMode = "return" | "assets";
type PortfolioSnapshot = { date: string; value: number; cost: number; returnRate: number };
type PortfolioTrend = { dates: string[]; returns: number[]; costs: number[]; values: number[] };

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

function trendAxisLabel(value: number, mode: TrendMode) {
  if (mode === "return") return `${value.toFixed(value < 10 && value > -10 ? 1 : 0)}%`;
  const absolute = Math.abs(value);
  return absolute >= 10000 ? `${value < 0 ? "-" : ""}¥${(absolute / 10000).toFixed(0)}万` : `¥${Math.round(value / 1000)}千`;
}

function PerformanceChart({ compact = false, mode = "return", trend, range = "1年" }: { compact?: boolean; mode?: TrendMode; trend: PortfolioTrend; range?: string }) {
  const primary = mode === "return" ? trend.returns : trend.values;
  const secondary = mode === "assets" ? trend.costs : undefined;
  const allValues = (secondary ? [...primary, ...secondary] : primary).filter(Number.isFinite);
  const rawMin = allValues.length ? Math.min(...allValues) : 0;
  const rawMax = allValues.length ? Math.max(...allValues) : 1;
  const observedSpan = rawMax - rawMin;
  const fallbackSpan = Math.max(Math.abs(rawMax), Math.abs(rawMin), mode === "return" ? 1 : 1000);
  const padding = observedSpan > 0
    ? observedSpan * .12
    : Math.max(fallbackSpan * .02, mode === "return" ? .25 : 500);
  const min = rawMin - padding;
  const max = rawMax + padding;
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
    <svg viewBox="0 0 760 250" preserveAspectRatio="none" role="img" aria-label={`${mode === "return" ? "收益率" : "成本投入与总市值"}走势`}>
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

export default function Home() {
  const [range, setRange] = useState("1年");
  const [trendMode, setTrendMode] = useState<TrendMode>("return");
  const [query, setQuery] = useState("");
  const [bucketFilter, setBucketFilter] = useState<"全部" | AssetBucket>("全部");
  const [customHoldings, setCustomHoldings] = useState<Holding[]>([]);
  const [remoteQuotes, setRemoteQuotes] = useState<Record<string, MarketQuote>>({});
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
  const [deviceAccess, setDeviceAccess] = useState<DeviceAccessState>({ status:"checking", source:null, trusted:false, message:"正在确认设备权限…" });
  const [longTermStart, setLongTermStart] = useState("");
  const [profile, setProfile] = useState<Profile>({ name: "", target: "12", risk: "均衡型" });
  const [assetForm, setAssetForm] = useState({ symbol: "", name: "", market: "" as Market | "", category: "美股" as AssetBucket, avgCost: "", quantity: "", holdingDays: "" });
  const [assetLookup, setAssetLookup] = useState<{ state: "idle" | "loading" | "success" | "error"; message: string }>({ state: "idle", message: "" });

  const quoteCodes = useMemo(() => {
    const symbols = new Set<string>();
    if (useDemoHoldings) initialHoldings.forEach((item) => symbols.add(item.symbol));
    customHoldings.forEach((item) => symbols.add(item.symbol.trim().toUpperCase()));
    return [...symbols].filter(Boolean).join(",");
  }, [customHoldings, useDemoHoldings]);

  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/device-session", { cache:"no-store", credentials:"same-origin" })
      .then(async (response) => {
        const payload = await response.json() as { authorized?:boolean; source?:DeviceAccessState["source"]; trusted?:boolean; error?:string };
        if (cancelled) return;
        if (response.ok && payload.authorized) {
          setDeviceAccess({ status:"authorized", source:payload.source ?? null, trusted:Boolean(payload.trusted), message:"" });
        } else {
          setDeviceAccess({ status:"locked", source:null, trusted:false, message:"此设备尚未获得访问权限" });
        }
      })
      .catch(() => { if (!cancelled) setDeviceAccess({ status:"error", source:null, trusted:false, message:"暂时无法验证设备，请稍后重试" }); });
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
        .then((payload: { quotes?: Record<string, MarketQuote>; errors?: Record<string, string> }) => {
          if (payload.quotes) setRemoteQuotes((current) => ({ ...current, ...payload.quotes }));
          setQuoteErrors(payload.errors ?? {});
        })
        .catch(() => { /* 保留上一次成功行情 */ });
    };
    refreshQuotes();
    const refreshTimer = window.setInterval(refreshQuotes, 20000);
    return () => { window.clearInterval(refreshTimer); controller?.abort(); };
  }, [quoteCodes]);

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
    setAssetForm((current) => ({ ...current, symbol: quote.symbol, name: displayName, market: quote.market }));
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
        const cleaned = stored.filter((item) => (item.market as string) !== "加密货币" && (item.category as string) !== "加密货币" && !["BTC","ETH","SOL","USDT","USDC","BNB","XRP","DOGE"].includes(item.symbol.toUpperCase()));
        setCustomHoldings(cleaned);
        if (cleaned.length !== stored.length) window.localStorage.setItem("hengce-custom-holdings", JSON.stringify(cleaned));
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
      if ((item.market as string) === "加密货币" || (item.category as string) === "加密货币") return;
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
  const trendView = {
    return: { description:"按每日资产快照计算", primary:"组合收益率", primaryValue:`${latestReturn >= 0 ? "+" : ""}${latestReturn.toFixed(2)}%`, secondary:"", secondaryValue:"", note:`每日 23:59 保存 · ${portfolioTrend.dates.length} 个日期` },
    assets: { description:"总市值与成本投入同图对照", primary:"总市值", primaryValue:`¥${totalValue.toLocaleString("zh-CN")}`, secondary:"成本投入", secondaryValue:`¥${totalCost.toLocaleString("zh-CN")}`, note:`浮动盈亏 ${profit >= 0 ? "+" : ""}¥${profit.toLocaleString("zh-CN")}` },
  }[trendMode];
  const allocationData = assetBuckets.map((category) => {
    const amount = allHoldings.filter((item) => item.category === category).reduce((sum, item) => sum + item.value, 0);
    return { category, amount, percent: totalValue > 0 ? (amount / totalValue) * 100 : 0, className: bucketClasses[category] };
  });
  let allocationCursor = 0;
  const allocationGradient = allocationData.map((item) => {
    const start = allocationCursor;
    allocationCursor += item.percent;
    return `${bucketColors[item.category]} ${start}% ${allocationCursor}%`;
  }).join(", ");
  let allocationLabelCursor = 0;
  const allocationLabels = allocationData.filter((item) => item.percent > 0).map((item) => {
    const midpoint = allocationLabelCursor + item.percent / 2;
    allocationLabelCursor += item.percent;
    const angle = (midpoint / 100) * Math.PI * 2 - Math.PI / 2;
    return { ...item, left: 50 + Math.cos(angle) * 55, top: 50 + Math.sin(angle) * 55 };
  });
  const shownTotal = baseCurrency === "CNY" ? totalValue : totalValue / 7.18;
  const shownDailyProfit = baseCurrency === "CNY" ? dailyProfit : dailyProfit / 7.18;
  const currencySymbol = baseCurrency === "CNY" ? "¥" : "$";
  const filteredHoldings = useMemo(() => allHoldings.filter((item) => {
    const keyword = query.trim().toLowerCase();
    const bucketMatch = bucketFilter === "全部" || item.category === bucketFilter;
    return bucketMatch && (!keyword || item.name.toLowerCase().includes(keyword) || item.symbol.toLowerCase().includes(keyword));
  }), [allHoldings, bucketFilter, query]);

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

  function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); window.localStorage.setItem("hengce-profile", JSON.stringify(profile)); setShowSettings(false);
  }

  async function trustCurrentDevice() {
    setDeviceMessage("正在授权此设备…");
    try {
      const response = await fetch("/api/device-session", { method:"POST", credentials:"same-origin" });
      const payload = await response.json() as { trusted?:boolean; error?:string };
      if (!response.ok || !payload.trusted) throw new Error(payload.error || "设备授权失败");
      setDeviceAccess((current) => ({ ...current, status:"authorized", source:"device", trusted:true }));
      setDeviceMessage("已信任此设备，未来 180 天可以直接打开。 ");
    } catch (error) {
      setDeviceMessage(error instanceof Error ? error.message : "设备授权失败，请重试");
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
    return <main className="device-access-shell">
      <section className="device-access-card" aria-live="polite">
        <div className="device-access-brand">M</div>
        <p>MINIMALISM · PRIVATE PORTFOLIO</p>
        <h1>{deviceAccess.status === "checking" ? "正在打开你的面板" : "需要授权此设备"}</h1>
        <span>{deviceAccess.message}</span>
        {deviceAccess.status !== "checking" && <a href="/signin-with-chatgpt?return_to=/">使用 ChatGPT 授权一次</a>}
        <small>授权并信任后，未来 180 天点击桌面图标即可直接进入。</small>
      </section>
    </main>;
  }

  return <main className="app-shell overview-only">
    <section className="workspace">
      <header className="topbar">
        <div><h1>Minimalism</h1></div>
        <div className="top-actions">
          <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索股票 / 基金代码" aria-label="搜索股票或基金" /></label>
          <span className={`cloud-sync-status ${syncStatus}`}><i />{syncStatus === "loading" ? "连接云端" : syncStatus === "syncing" ? "同步中" : syncStatus === "synced" ? "已同步" : "离线"}</span>
          {!deviceAccess.trusted && <button className="trust-device-btn" onClick={()=>void trustCurrentDevice()}>信任此设备</button>}
          <button className="icon-btn" aria-label="偏好设置" onClick={() => setShowSettings(true)}>⚙</button>
          <button className="primary-btn" onClick={() => setShowAdd(true)}><span className="add-asset-icon" aria-hidden="true" /><span className="add-asset-label">添加资产</span></button>
        </div>
      </header>

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

        <section className="dashboard-grid">
          <article className="panel performance-panel">
            <div className="panel-head trend-head"><div><h2>资产走势</h2><p>{trendView.description}</p></div><div className="trend-controls"><div className="trend-switch">{([['return','收益率'],['assets','成本投入 & 总市值']] as [TrendMode,string][]).map(([id,label])=><button key={id} className={trendMode === id ? "selected" : ""} onClick={()=>setTrendMode(id)}>{label}</button>)}</div><div className="segmented">{["1月","3月","6月","1年","全部"].map((item) => <button key={item} className={range === item ? "selected" : ""} onClick={() => setRange(item)}>{item}</button>)}</div></div></div>
            <div className="chart-legend"><span><i className="legend-value" />{trendView.primary} <b className={trendMode === "return" ? "up" : ""}>{trendView.primaryValue}</b></span>{trendView.secondary && <span><i className="legend-cost" />{trendView.secondary} <b>{trendView.secondaryValue}</b></span>}<span className="chart-note">{trendView.note}</span></div>
            <PerformanceChart mode={trendMode} trend={portfolioTrend} range={range} />
          </article>
          <article className="panel allocation-panel">
            <div className="panel-head"><div><h2>资产配置</h2><p>按当前持仓市值实时统计</p></div></div>
            <div className="allocation-chart-layout">
              <div className="allocation-pie" style={{background:totalValue > 0 ? `conic-gradient(${allocationGradient})` : "#e7e6e3"}} role="img" aria-label="四类资产分类占比饼图"><div><span>总市值</span><strong>¥{totalValue >= 10000 ? `${(totalValue/10000).toFixed(1)}万` : totalValue.toLocaleString("zh-CN")}</strong></div><div className="allocation-pie-labels" aria-hidden="true">{allocationLabels.map((item)=><span key={item.category} style={{left:`${item.left}%`,top:`${item.top}%`}}><b>{item.category}</b>{item.percent.toFixed(0)}%</span>)}</div></div>
              <div className="allocation-legend-list">{allocationData.map((item)=><div key={item.category}><span><i style={{background:bucketColors[item.category]}} />{item.category}</span><b>{item.percent.toFixed(1)}%</b><small>¥{item.amount.toLocaleString("zh-CN")}</small></div>)}</div>
            </div>
          </article>
        </section>
        <HoldingsTable holdings={filteredHoldings} allCount={allHoldings.length} filter={bucketFilter} setFilter={setBucketFilter} quotes={remoteQuotes} quoteErrors={quoteErrors} onLookup={lookupAssetCode} onSaveAll={saveHoldings} />
    </section>

    {showAdd && <Modal title="添加一项持仓" eyebrow="PERSONAL PORTFOLIO" description="输入代码后自动显示全名和市场；持仓总成本由均价 × 数量计算。" onClose={() => setShowAdd(false)}><form className="modal-form" onSubmit={addHolding}><label className="wide">代码<input required value={assetForm.symbol} onChange={(event)=>setAssetForm({...assetForm,symbol:event.target.value,market:"",name:""})} placeholder="021000 / 600036 / AAPL" /><small>停止输入约半秒后自动查询</small></label><div className="resolved-identity wide"><span><small>持仓名称</small><strong>{assetLookup.state === "loading" ? "正在识别…" : assetForm.name || "输入代码后自动显示"}</strong></span><span><small>市场种类</small><strong className={assetForm.market ? `market-${assetForm.market}` : ""}>{assetForm.market || "待识别"}</strong></span></div><input type="hidden" required value={assetForm.name} readOnly /><label className="wide">资产分类（由你选择）<select value={assetForm.category} onChange={(event)=>setAssetForm({...assetForm,category:event.target.value as AssetBucket})}>{assetBuckets.map((item)=><option key={item}>{item}</option>)}</select></label><label>持仓均价（{assetForm.market === "美股" ? "USD" : "CNY"}）<input required type="number" min="0" step="any" value={assetForm.avgCost} onChange={(event)=>setAssetForm({...assetForm,avgCost:event.target.value})} /></label><label>持仓数<input required type="number" min="0.00000001" step="any" value={assetForm.quantity} onChange={(event)=>setAssetForm({...assetForm,quantity:event.target.value})} /></label><div className={`api-form-note wide ${assetLookup.state}`}>{assetLookup.state === "idle" ? "行情来源：东方财富、Nasdaq。" : assetLookup.message}</div><ModalActions onCancel={()=>setShowAdd(false)} label="保存到持仓" /></form></Modal>}
    {showSettings && <Modal title="个人偏好" eyebrow="PERSONAL SETTINGS" description="偏好与持仓会安全同步到你的私人面板。" onClose={() => setShowSettings(false)}><form className="modal-form" onSubmit={saveProfile}><label className="wide">你的称呼<input value={profile.name} onChange={(event)=>setProfile({...profile,name:event.target.value})} /></label><label>年度目标（%）<input type="number" value={profile.target} onChange={(event)=>setProfile({...profile,target:event.target.value})} /></label><label>风险偏好<select value={profile.risk} onChange={(event)=>setProfile({...profile,risk:event.target.value})}><option>稳健型</option><option>均衡型</option><option>进取型</option></select></label><div className="device-trust-tools wide"><div><strong>快速打开</strong><small>{deviceAccess.trusted ? "此设备已受信任，180 天内无需再次登录" : "信任本设备后，未来 180 天可以直接打开"}</small></div>{!deviceAccess.trusted && <button type="button" onClick={()=>void trustCurrentDevice()}>信任此设备</button>}{deviceMessage && <p>{deviceMessage}</p>}</div><div className="backup-tools wide"><div><strong>数据备份与迁移</strong><small>首次从 localhost 迁移到正式网页时使用一次</small></div><button type="button" onClick={exportBackup}>导出备份</button><label className="import-backup-button">导入并同步<input type="file" accept="application/json,.json" onChange={(event)=>void importBackup(event)} /></label>{backupMessage && <p>{backupMessage}</p>}</div><ModalActions onCancel={()=>setShowSettings(false)} label="保存偏好" /></form></Modal>}
  </main>;
}

function HoldingsTable({ holdings, allCount, filter, setFilter, quotes, quoteErrors, onLookup, onSaveAll }: { holdings: Holding[]; allCount: number; filter: "全部" | AssetBucket; setFilter: (value: "全部" | AssetBucket) => void; quotes: Record<string, MarketQuote>; quoteErrors: Record<string, string>; onLookup:(symbol:string)=>Promise<MarketQuote | null>; onSaveAll:(edits:{item:Holding;originalSymbol:string}[])=>void }) {
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
    if (quote) setNewDraft((current) => ({ ...current, symbol:quote.symbol, name:quote.name, market:quote.market, price:quote.price, currency:quote.currency, change:quote.change }));
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
      <div className="inline-asset-fields"><input className="inline-field code-field" value={draft.symbol} onChange={(event)=>patch({symbol:event.target.value.toUpperCase(),name:""})} onBlur={isNew ? lookupNew : ()=>void lookupExisting(key)} placeholder={isNew ? "输入新代码" : "资产代码"} aria-label="资产代码" /><select className="inline-select" value={draft.category} onChange={(event)=>patch({category:event.target.value as AssetBucket})} aria-label="资产分类">{assetBuckets.map((bucket)=><option key={bucket}>{bucket}</option>)}</select><small className="inline-lookup-hint">{shown.name || "输入代码后自动识别"} · {shown.market}</small><div className="inline-position-summary"><span>市值 {hasQuote ? `¥${shown.value.toLocaleString("zh-CN")}` : "—"}</span><b className={hasQuote ? (returnRate >= 0 ? "up" : "down") : ""}>收益 {hasQuote ? `${returnRate >= 0 ? "+" : ""}${returnRate.toFixed(2)}%` : "—"}</b><b className={hasQuote ? (shown.value >= shown.cost ? "up" : "down") : ""}>盈亏 {hasQuote ? `${shown.value >= shown.cost ? "+" : ""}¥${(shown.value-shown.cost).toLocaleString("zh-CN")}` : "—"}</b></div></div>
      <span className="market-price-cell"><strong className={shown.change >= 0 ? "up" : "down"}>{hasQuote ? `${shown.currency}${shown.price.toLocaleString("zh-CN")}` : "—"}</strong><small className={shown.change >= 0 ? "up" : "down"}>{hasQuote ? `${shown.change >= 0 ? "+" : ""}${shown.change.toFixed(2)}% 今日` : quoteErrors[shown.symbol] || "等待行情"}</small></span>
      <span><input className="inline-field number-field" type="number" min="0" step="any" inputMode="decimal" value={numericText.avgCost} onChange={(event)=>updateNumericText("avgCost",event.target.value)} placeholder="均价" aria-label="持仓均价" /><small>总成本 ¥{shown.cost.toLocaleString("zh-CN")}</small></span>
      <span><input className="inline-field number-field" type="number" min="0.00000001" step="any" inputMode="decimal" value={numericText.quantity} onChange={(event)=>updateNumericText("quantity",event.target.value)} placeholder="持仓数" aria-label="持仓数" /><small>{shown.market === "基金" ? "份" : "股"}</small></span>
    </div>;
  };

  return <section className={`panel holdings-panel ${editing ? "holdings-edit-mode" : ""}`}>
    <div className="panel-head holdings-head">
      <div><h2>我的持仓</h2><p>共 {allCount} 项资产 · {editing ? "全部持仓已解锁，可直接修改或新增" : "盈亏状态与实时行情一目了然"}</p></div>
      <div className="holdings-actions"><span className="quote-status"><i className="status-dot" />行情每 20 秒刷新 · 已更新 {Object.keys(quotes).length} 项</span><select className="bucket-filter" value={filter} onChange={(event)=>setFilter(event.target.value as "全部" | AssetBucket)} aria-label="按资产分类筛选"><option value="全部">全部分类</option>{assetBuckets.map((item)=><option key={item}>{item}</option>)}</select><span className="sort-controls"><select value={sortKey} onChange={(event)=>setSortKey(event.target.value as typeof sortKey)} aria-label="持仓排序方式"><option value="default">默认排序</option><option value="return">按收益率</option><option value="profit">按绝对收益</option><option value="value">按持仓市值</option></select><button onClick={()=>setSortDirection((current)=>current === "desc" ? "asc" : "desc")} disabled={sortKey === "default"} aria-label="切换排序方向">{sortDirection === "desc" ? "↓" : "↑"}</button></span>{editing ? <span className="edit-mode-actions"><button onClick={cancelEdit}>取消</button><button onClick={()=>void saveAll()}>保存全部</button></span> : <button className="portfolio-edit-toggle" onClick={beginEdit}>✎ 编辑持仓</button>}</div>
    </div>
    {editError && <div className="portfolio-edit-error">{editError}</div>}
    <div className="holding-table">
      <div className="holding-row holding-header">{editing ? <><span>资产</span><span>股价</span><span>成本</span><span>数量</span></> : <><span>资产</span><span>持仓（市值）</span><span>累计盈亏</span><span>股价</span></>}</div>
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
            <span className="market-price-cell"><strong className={item.change >= 0 ? "up" : "down"}>{hasQuote ? `${item.currency}${item.price.toLocaleString("zh-CN")}` : "—"}</strong><small className={item.change >= 0 ? "up" : "down"}>{hasQuote ? `${item.change >= 0 ? "+" : ""}${item.change.toFixed(2)}%` : quoteErrors[item.symbol] || "等待行情"}</small></span>
          </button>
          {expanded && <div className="holding-details" id={`holding-details-${item.symbol}`}><div><span>持仓均价</span><strong>{item.currency}{item.avgCost.toLocaleString("zh-CN", {maximumFractionDigits:6})}</strong></div><div><span>总成本</span><strong>¥{item.cost.toLocaleString("zh-CN")}</strong></div><div><span>持仓数量</span><strong>{item.quantity.toLocaleString("zh-CN")} {item.market === "基金" ? "份" : "股"}</strong></div><div><span>资产分类</span><strong>{item.category}</strong></div></div>}
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
