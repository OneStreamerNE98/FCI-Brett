CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`detail` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`project_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`payload` text NOT NULL,
	`created_by` text DEFAULT 'system' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`received_at` integer NOT NULL
);
