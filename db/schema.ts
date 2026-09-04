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

export const calendarEvents = sqliteTable("calendar_events", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), title: text("title").notNull(), eventType: text("event_type").notNull(), industriesJson: text("industries_json").notNull(), symbolsJson: text("symbols_json").notNull(), startAt: text("start_at").notNull(), endAt: text("end_at"), timezone: text("timezone").notNull(), datePrecision: text("date_precision").notNull(), importance: text("importance").notNull(), status: text("status").notNull(), verification: text("verification").notNull(), sourceName: text("source_name").notNull(), sourceUrl: text("source_url").notNull(), externalId: text("external_id"), manualOverride: integer("manual_override").notNull().default(0), hidden: integer("hidden").notNull().default(0), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const eventCandidates = sqliteTable("event_candidates", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), title: text("title").notNull(), eventType: text("event_type").notNull(), industriesJson: text("industries_json").notNull(), symbolsJson: text("symbols_json").notNull(), startAt: text("start_at"), timezone: text("timezone").notNull(), datePrecision: text("date_precision").notNull(), importance: text("importance").notNull(), candidateStatus: text("candidate_status").notNull().default("pending"), sourceName: text("source_name").notNull(), sourceUrl: text("source_url").notNull(), externalId: text("external_id"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
