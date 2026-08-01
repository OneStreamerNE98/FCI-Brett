CREATE TABLE `google_form_lead_intake_watermarks` (
	`connection_key` text NOT NULL,
	`spreadsheet_id` text NOT NULL,
	`last_processed_row` integer NOT NULL,
	`last_processed_submission_key` text NOT NULL,
	`last_processed_at` integer NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_form_lead_watermarks_scope_unique` ON `google_form_lead_intake_watermarks` (`connection_key`,`spreadsheet_id`);--> statement-breakpoint
CREATE TABLE `google_form_lead_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_key` text NOT NULL,
	`spreadsheet_id` text NOT NULL,
	`submission_key` text NOT NULL,
	`source_row` integer NOT NULL,
	`submitted_at` text,
	`state` text NOT NULL,
	`status` text DEFAULT 'needs-review' NOT NULL,
	`proposal_json` text NOT NULL,
	`reasons_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`accepted_lead_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_form_lead_reviews_submission_unique` ON `google_form_lead_reviews` (`connection_key`,`spreadsheet_id`,`submission_key`);--> statement-breakpoint
CREATE INDEX `google_form_lead_reviews_queue_idx` ON `google_form_lead_reviews` (`connection_key`,`status`,`source_row`);