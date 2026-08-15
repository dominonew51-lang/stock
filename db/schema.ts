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
