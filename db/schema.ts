import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const portfolioStates = sqliteTable("portfolio_states", {
  userId: text("user_id").primaryKey(),
  stateJson: text("state_json").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const portfolioSnapshots = sqliteTable("portfolio_snapshots", {
  userId: text("user_id").notNull(),
  snapshotDate: text("snapshot_date").notNull(),
  totalValue: real("total_value").notNull(),
  totalCost: real("total_cost").notNull(),
  returnRate: real("return_rate").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.userId, table.snapshotDate] })]);

export const portfolioOwners = sqliteTable("portfolio_owners", {
  id: integer("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  createdAt: integer("created_at").notNull(),
});

export const trustedDevices = sqliteTable("trusted_devices", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
}, (table) => [index("idx_trusted_devices_expires_at").on(table.expiresAt)]);

export const appAuth = sqliteTable("app_auth", {
  id: integer("id").primaryKey(),
  passwordSalt: text("password_salt").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordIterations: integer("password_iterations").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const loginAttempts = sqliteTable("login_attempts", {
  clientKey: text("client_key").primaryKey(),
  failedCount: integer("failed_count").notNull(),
  windowStartedAt: integer("window_started_at").notNull(),
  blockedUntil: integer("blocked_until").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("idx_login_attempts_updated_at").on(table.updatedAt)]);
