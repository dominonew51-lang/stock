import { chinaMarketState, resolveCnMarketItem, type CnMarketItem } from "@/app/market-data/cn-market";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const codes = [...new Set((params.get("codes") || "").split(",").map((code) => code.trim().toUpperCase()).filter((code) => /^\d{6}$/.test(code)))].slice(0, 30);
  const dividendCodes = new Set((params.get("dividendCodes") || "").split(",").map((code) => code.trim().toUpperCase()).filter(Boolean));
  if (!codes.length) return Response.json({ marketState: chinaMarketState(), timezone: "Asia/Shanghai", updatedAt: new Date().toISOString(), items: {}, errors: {} });
  const entries = await Promise.all(codes.map(async (code) => {
    try { return [code, await resolveCnMarketItem(code, dividendCodes.has(code))] as const; }
    catch (error) { return [code, error instanceof Error ? error.message : "行情查询失败"] as const; }
  }));
  const items: Record<string, CnMarketItem> = {};
  const errors: Record<string, string> = {};
  for (const [code, result] of entries) {
    if (typeof result === "string") errors[code] = result;
    else items[code] = result;
  }
  return Response.json({ marketState: chinaMarketState(), timezone: "Asia/Shanghai", updatedAt: new Date().toISOString(), items, errors }, { headers: { "Cache-Control": "no-store" } });
}
