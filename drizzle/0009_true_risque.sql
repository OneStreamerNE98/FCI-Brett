CREATE TABLE `project_meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`meeting_at` integer NOT NULL,
	`meeting_type` text NOT NULL,
	`source_provider` text NOT NULL,
	`source_url` text,
	`attendees_json` text NOT NULL,
	`notes` text,
	`transcript` text,
	`summary` text,
	`decisions` text,
	`action_items_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_meetings_project_date_idx` ON `project_meetings` (`project_id`,`meeting_at`);