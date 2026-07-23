CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`details` text,
	`status` text DEFAULT 'open' NOT NULL,
	`due_date` text,
	`project_id` text,
	`lead_id` text,
	`assignee_email` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_ref` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `tasks_status_due_date_idx` ON `tasks` (`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `tasks_project_status_idx` ON `tasks` (`project_id`,`status`);