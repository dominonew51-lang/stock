import { asc, eq, sql } from "drizzle-orm";
import { ensurePortfolioSchema, getDb } from "../../../db";
import { portfolioSnapshots, portfolioStates } from "../../../db/schema";

function userIdFor(request: Request) {
  const userId = request.headers.get("oai-authenticated-user-id");
  if (userId) return userId;
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" ? "local-preview-user" : null;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "云端同步失败";
  return Response.json({ error: message }, { status: 500 });
}

export async function GET(request: Request) {
  const userId = userIdFor(request);
  if (!userId) return Response.json({ error: "请先登录后再同步" }, { status: 401 });
  try {
    await ensurePortfolioSchema();
    const db = getDb();
    const [stored] = await db.select().from(portfolioStates).where(eq(portfolioStates.userId, userId)).limit(1);
    const snapshots = await db.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.userId, userId)).orderBy(asc(portfolioSnapshots.snapshotDate)).limit(1825);
    return Response.json({
      state: stored ? JSON.parse(stored.stateJson) : null,
      updatedAt: stored?.updatedAt ?? null,
      snapshots: snapshots.map((item) => ({ date:item.snapshotDate, value:item.totalValue, cost:item.totalCost, returnRate:item.returnRate })),
    });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  const userId = userIdFor(request);
  if (!userId) return Response.json({ error: "请先登录后再同步" }, { status: 401 });
  try {
    const payload = await request.json() as { holdings?: unknown; profile?: unknown; useDemoHoldings?: unknown; longTermStart?: unknown };
    const state = {
      holdings: Array.isArray(payload.holdings) ? payload.holdings.slice(0, 500) : [],
      profile: payload.profile && typeof payload.profile === "object" ? payload.profile : {},
      useDemoHoldings: Boolean(payload.useDemoHoldings),
      longTermStart: typeof payload.longTermStart === "string" ? payload.longTermStart : "",
    };
    const stateJson = JSON.stringify(state);
    if (stateJson.length > 1_500_000) return Response.json({ error: "持仓数据过大" }, { status: 413 });
    await ensurePortfolioSchema();
    const db = getDb();
    await db.insert(portfolioStates).values({ userId, stateJson }).onConflictDoUpdate({
      target: portfolioStates.userId,
      set: { stateJson, updatedAt: sql`CURRENT_TIMESTAMP` },
    });
    return Response.json({ ok:true, updatedAt:new Date().toISOString() });
  } catch (error) { return errorResponse(error); }
}
