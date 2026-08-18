import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

export function getD1() {
  if (!env.DB) throw new Error("Cloud database is unavailable");
  return env.DB;
}

export async function ensurePortfolioSchema() {
  const d1 = getD1();
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS portfolio_states (
      user_id TEXT PRIMARY KEY NOT NULL,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      user_id TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      total_value REAL NOT NULL,
      total_cost REAL NOT NULL,
      return_rate REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, snapshot_date)
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS portfolio_owners (
      id INTEGER PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS trusted_devices (
      token_hash TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )`),
    d1.prepare(`CREATE INDEX IF NOT EXISTS idx_trusted_devices_expires_at
      ON trusted_devices(expires_at)`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS app_auth (
      id INTEGER PRIMARY KEY NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_iterations INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS login_attempts (
      client_key TEXT PRIMARY KEY NOT NULL,
      failed_count INTEGER NOT NULL,
      window_started_at INTEGER NOT NULL,
      blocked_until INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    d1.prepare(`CREATE INDEX IF NOT EXISTS idx_login_attempts_updated_at
      ON login_attempts(updated_at)`),
  ]);
}
