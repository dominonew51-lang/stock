export const strategies = ["AI Infrastructure", "Space", "Crypto", "US Index", "A", "Cash"] as const;
export type StrategyBucket = typeof strategies[number];
export const strategyColors: Record<StrategyBucket, string> = { "AI Infrastructure":"#111827", Space:"#4F83CC", Crypto:"#6366F1", "US Index":"#10B981", A:"#F59E0B", Cash:"#64748B" };
type StrategyHolding = { symbol:string; name?:string; category?:string; strategy?:string; value:number; cost?:number };
export function cashCode(symbol:string) {
  const code = symbol.trim().toUpperCase();
  if (["CNY", "RMB", "人民币"].includes(code)) return "CNY";
  if (["USD", "美元"].includes(code)) return "USD";
  if (["USDT", "TETHER"].includes(code)) return "USDT";
  return null;
}
export function resolveStrategy(item: Omit<StrategyHolding,"value">): StrategyBucket | undefined {
  if (cashCode(item.symbol)) return "Cash";
  if (strategies.includes(item.strategy as StrategyBucket)) return item.strategy as StrategyBucket;
  const code = item.symbol.trim().toUpperCase();
  if (["SPCX","TSLA"].includes(code)) return "AI Infrastructure";
  if (["RKLB","BKSY"].includes(code)) return "Space";
  if (["BTC","BTCUSDT","BITCOIN","比特币","ETH","COIN","CRCL"].includes(code)) return "Crypto";
  // Legacy choices remain in saved JSON; resolve renamed directions without a data migration.
  if (item.strategy === "周期轮动" || code === "601985" || item.category === "红利" || /科创50|科创板50/.test(item.name ?? "")) return "A";
  if (item.strategy === "NDX" || ["QQQ","QQQM","021000","159696"].includes(code) || item.category === "美股指数" || /纳指|纳斯达克/.test(item.name ?? "")) return "US Index";
  return undefined;
}
export function strategyAllocation(holdings: StrategyHolding[]) {
  const amounts = Object.fromEntries(strategies.map(s => [s,0])) as Record<StrategyBucket,number>;
  const costs = Object.fromEntries(strategies.map(s => [s,0])) as Record<StrategyBucket,number>;
  let unclassified = 0, unclassifiedCount = 0;
  for (const item of holdings) {
    const value = Number.isFinite(item.value) ? Math.max(0,item.value) : 0;
    const strategy = resolveStrategy(item);
    if (strategy) { amounts[strategy] += value; costs[strategy] += Number.isFinite(item.cost) ? Math.max(0,item.cost!) : 0; }
    else { unclassified += value; unclassifiedCount++; }
  }
  const invested = Object.values(amounts).reduce((a,b)=>a+b,0);
  const totalCost = Object.values(costs).reduce((a,b)=>a+b,0);
  return { invested, totalCost, unclassified, unclassifiedCount, rows:strategies.map(strategy=>({ strategy, amount:amounts[strategy], cost:costs[strategy], costPercent:totalCost ? costs[strategy]/totalCost*100 : 0, percent:invested ? amounts[strategy]/invested*100 : 0, color:strategyColors[strategy] })) };
}

function mixHex(start: string, end: string, amount: number) {
  const ratio = Math.max(0, Math.min(1, amount));
  const channel = (color:string, offset:number) => Number.parseInt(color.slice(offset, offset + 2), 16);
  const value = [1,3,5].map(offset => Math.round(channel(start,offset) + (channel(end,offset) - channel(start,offset)) * ratio));
  return `#${value.map(item=>item.toString(16).padStart(2,"0")).join("")}`.toUpperCase();
}

export function holdingHeatmapColor(historyRate: number) {
  if (!Number.isFinite(historyRate) || Math.abs(historyRate) < 0.005) return "#64748B";
  const intensity = Math.min(1, Math.abs(historyRate) / 18);
  return historyRate > 0 ? mixHex("#EF4444","#B91C1C",intensity) : mixHex("#10B981","#047857",intensity);
}
