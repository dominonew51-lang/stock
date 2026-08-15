import { ensurePortfolioSchema, getD1 } from "../../../../db";
import { resolvePortfolioUserId, sameOriginMutation } from "../../../device-session";

type Snapshot = { date: string; value: number; cost: number; returnRate: number };

function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Snapshot;
  return /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Number.isFinite(item.value) && item.value >= 0 && Number.isFinite(item.cost) && item.cost >= 0 && Number.isFinite(item.returnRate);
}

export async function POST(request: Request) {
  if (!sameOriginMutation(request)) return Response.json({ error:"请求来源无效" }, { status:403 });
  const userId = await resolvePortfolioUserId(request);
  if (!userId) return Response.json({ error:"此设备尚未获得访问权限" }, { status:401 });
  try {
    const payload = await request.json() as { snapshots?: unknown };
    const snapshots = (Array.isArray(payload.snapshots) ? payload.snapshots : []).filter(validSnapshot).slice(-1825);
    if (!snapshots.length) return Response.json({ error:"没有有效快照" }, { status:400 });
    await ensurePortfolioSchema();
    const d1 = getD1();
    for (let index = 0; index < snapshots.length; index += 80) {
      const chunk = snapshots.slice(index, index + 80);
      await d1.batch(chunk.map((item) => d1.prepare(`INSERT INTO portfolio_snapshots
        (user_id, snapshot_date, total_value, total_cost, return_rate, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, snapshot_date) DO UPDATE SET
          total_value=excluded.total_value,
          total_cost=excluded.total_cost,
          return_rate=excluded.return_rate,
          updated_at=CURRENT_TIMESTAMP`
      ).bind(userId, item.date, item.value, item.cost, item.returnRate)));
    }
    return Response.json({ ok:true, count:snapshots.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "快照同步失败";
    return Response.json({ error:message }, { status:500 });
  }
}
