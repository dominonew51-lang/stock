import { sql } from "drizzle-orm";
import { primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
