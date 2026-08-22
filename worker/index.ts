/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { resolveAsset } from "../app/api/assets/route";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type StoredHolding = {
  symbol?: string;
  market?: "美股" | "A股" | "基金";
  quantity?: number;
  avgCost?: number;
  value?: number;
  cost?: number;
};

function shanghaiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function saveDailyPortfolioSnapshots(env: Env) {
  const rows = await env.DB.prepare("SELECT user_id, state_json FROM portfolio_states").all<{ user_id: string; state_json: string }>();
  const snapshotDate = shanghaiDateKey();
  for (const row of rows.results) {
    try {
      const state = JSON.parse(row.state_json) as { holdings?: StoredHolding[] };
      const holdings = Array.isArray(state.holdings) ? state.holdings.slice(0, 500) : [];
      const resolved = await Promise.all(holdings.map(async (holding) => {
        const quantity = Number(holding.quantity) || 0;
        const averageCost = Number(holding.avgCost) || 0;
        const fx = holding.market === "美股" ? 7.18 : 1;
        const cost = averageCost > 0 ? averageCost * quantity * fx : Number(holding.cost) || 0;
        try {
          const quote = holding.symbol ? await resolveAsset(holding.symbol) : null;
          return { value: quote && quote.price > 0 ? quote.price * quantity * (quote.market === "美股" ? 7.18 : 1) : Number(holding.value) || 0, cost };
        } catch {
          return { value: Number(holding.value) || 0, cost };
        }
      }));
      const totalValue = resolved.reduce((sum, item) => sum + item.value, 0);
      const totalCost = resolved.reduce((sum, item) => sum + item.cost, 0);
      if (totalValue <= 0 || totalCost <= 0) continue;
      const returnRate = ((totalValue - totalCost) / totalCost) * 100;
      await env.DB.prepare(`INSERT INTO portfolio_snapshots
        (user_id, snapshot_date, total_value, total_cost, return_rate, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, snapshot_date) DO UPDATE SET
          total_value=excluded.total_value,
          total_cost=excluded.total_cost,
          return_rate=excluded.return_rate,
          updated_at=CURRENT_TIMESTAMP`
      ).bind(row.user_id, snapshotDate, totalValue, totalCost, returnRate).run();
    } catch {
      // 单个账户或单个行情源失败不影响其他账户的每日快照。
    }
  }
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(saveDailyPortfolioSnapshots(env));
  },
};

export default worker;
