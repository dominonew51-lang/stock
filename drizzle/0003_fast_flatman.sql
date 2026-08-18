CREATE TABLE `app_auth` (
	`id` integer PRIMARY KEY NOT NULL,
	`password_salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_iterations` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`client_key` text PRIMARY KEY NOT NULL,
	`failed_count` integer NOT NULL,
	`window_started_at` integer NOT NULL,
	`blocked_until` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_login_attempts_updated_at` ON `login_attempts` (`updated_at`);