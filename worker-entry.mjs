import application from "./dist/server/index.js";

const SNAPSHOT_TIME_ZONE = "Asia/Shanghai";
const QUOTE_BATCH_SIZE = 30;
const USD_CNY_RATE = 7.18;

function shanghaiDateKey(timestamp) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SNAPSHOT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function normalizedHoldings(stateJson) {
  try {
    const state = JSON.parse(stateJson);
    return Array.isArray(state.holdings) ? state.holdings.slice(0, 500) : [];
  } catch {
    return [];
  }
}

async function fetchQuoteMap(holdings, env, ctx) {
  const symbols = [...new Set(holdings.map((item) => String(item.symbol || "").trim().toUpperCase()).filter(Boolean))];
  const quotes = {};
  for (let index = 0; index < symbols.length; index += QUOTE_BATCH_SIZE) {
    const codes = symbols.slice(index, index + QUOTE_BATCH_SIZE).join(",");
    const response = await application.fetch(new Request(`https://minimalism.internal/api/assets?codes=${encodeURIComponent(codes)}`), env, ctx);
    if (!response.ok) continue;
    const payload = await response.json();
    Object.assign(quotes, payload.quotes || {});
  }
  return quotes;
}

function calculateSnapshot(holdings, quotes) {
  let value = 0;
  let cost = 0;
  for (const item of holdings) {
    const symbol = String(item.symbol || "").trim().toUpperCase();
    if (!symbol || item.market === "加密货币" || item.category === "加密货币") continue;
    const quote = quotes[symbol];
    const market = quote?.market || item.market;
    const fx = market === "美股" ? USD_CNY_RATE : 1;
    const quantity = Number(item.quantity) || 0;
    const averageCost = Number(item.avgCost) || 0;
    const liveValue = quote?.price > 0 ? quote.price * quantity * fx : Number(item.value) || 0;
    value += liveValue;
    cost += averageCost > 0 ? averageCost * quantity * fx : Number(item.cost) || 0;
  }
  const roundedValue = Math.round(value * 100) / 100;
  const roundedCost = Math.round(cost * 100) / 100;
  return {
    value: roundedValue,
    cost: roundedCost,
    returnRate: roundedCost > 0 ? ((roundedValue - roundedCost) / roundedCost) * 100 : 0,
  };
}

async function captureDailySnapshots(event, env, ctx) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS portfolio_states (
      user_id TEXT PRIMARY KEY NOT NULL,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      user_id TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      total_value REAL NOT NULL,
      total_cost REAL NOT NULL,
      return_rate REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, snapshot_date)
    )`),
  ]);
  const states = await env.DB.prepare("SELECT user_id, state_json FROM portfolio_states").all();
  const snapshotDate = shanghaiDateKey(event.scheduledTime);
  let saved = 0;
  for (const row of states.results || []) {
    const holdings = normalizedHoldings(row.state_json);
    if (!holdings.length) continue;
    const quotes = await fetchQuoteMap(holdings, env, ctx);
    const snapshot = calculateSnapshot(holdings, quotes);
    if (snapshot.cost <= 0) continue;
    await env.DB.prepare(`INSERT INTO portfolio_snapshots
      (user_id, snapshot_date, total_value, total_cost, return_rate, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, snapshot_date) DO UPDATE SET
        total_value=excluded.total_value,
        total_cost=excluded.total_cost,
        return_rate=excluded.return_rate,
        updated_at=CURRENT_TIMESTAMP`
    ).bind(row.user_id, snapshotDate, snapshot.value, snapshot.cost, snapshot.returnRate).run();
    saved += 1;
  }
  console.log(JSON.stringify({ event: "portfolio_daily_snapshot", snapshotDate, saved }));
}

export default {
  fetch(request, env, ctx) {
    return application.fetch(request, env, ctx);
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(captureDailySnapshots(event, env, ctx));
  },
};
