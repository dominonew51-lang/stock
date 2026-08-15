CREATE TABLE `portfolio_snapshots` (
	`user_id` text NOT NULL,
	`snapshot_date` text NOT NULL,
	`total_value` real NOT NULL,
	`total_cost` real NOT NULL,
	`return_rate` real NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `snapshot_date`)
);
--> statement-breakpoint
CREATE TABLE `portfolio_states` (
	`user_id` text PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
