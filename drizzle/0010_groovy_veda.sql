CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_number` text NOT NULL,
	`company` text NOT NULL,
	`contact_name` text NOT NULL,
	`contact_email` text,
	`contact_phone` text,
	`project_name` text NOT NULL,
	`source` text NOT NULL,
	`stage` text NOT NULL,
	`site` text NOT NULL,
	`estimated_value` integer NOT NULL,
	`next_action` text NOT NULL,
	`next_action_at` integer,
	`owner_email` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_number_unique` ON `leads` (`lead_number`);--> statement-breakpoint
CREATE INDEX `leads_status_updated_idx` ON `leads` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `leads_stage_updated_idx` ON `leads` (`stage`,`updated_at`);