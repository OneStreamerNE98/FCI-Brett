CREATE TABLE `address_validation_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`entity_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`input_address` text NOT NULL,
	`standardized_address` text,
	`latitude` real,
	`longitude` real,
	`verdict` text NOT NULL,
	`failure_code` text,
	`simulated` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE INDEX `address_validation_reviews_expiry_idx` ON `address_validation_reviews` (`expires_at`);--> statement-breakpoint
CREATE INDEX `address_validation_reviews_actor_idx` ON `address_validation_reviews` (`actor_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `clients` ADD `site_address` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `latitude` real;--> statement-breakpoint
ALTER TABLE `clients` ADD `longitude` real;--> statement-breakpoint
ALTER TABLE `clients` ADD `address_validation_verdict` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `latitude` real;--> statement-breakpoint
ALTER TABLE `leads` ADD `longitude` real;--> statement-breakpoint
ALTER TABLE `leads` ADD `address_validation_verdict` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `latitude` real;--> statement-breakpoint
ALTER TABLE `projects` ADD `longitude` real;--> statement-breakpoint
ALTER TABLE `projects` ADD `address_validation_verdict` text;