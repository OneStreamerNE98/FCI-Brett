PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mail_items` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_key` text NOT NULL,
	`gmail_message_id` text,
	`gmail_thread_id` text,
	`client_id` text,
	`suggested_project_id` text,
	`approved_project_id` text,
	`status` text NOT NULL,
	`match_reason` text,
	`email_drive_file_id` text,
	`analysis_payload` text,
	`party` text,
	`confidence` text,
	`content_hash` text,
	`label_definition_version` text,
	`attempted_label_definition_version` text,
	`subject` text,
	`sender` text,
	`received_at` integer,
	`failure_attempts` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`coverage_complete` integer DEFAULT false NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`accepted_intent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_mail_items`("id", "connection_key", "gmail_message_id", "gmail_thread_id", "client_id", "suggested_project_id", "approved_project_id", "status", "match_reason", "email_drive_file_id", "analysis_payload", "party", "confidence", "content_hash", "label_definition_version", "attempted_label_definition_version", "subject", "sender", "received_at", "failure_attempts", "error_code", "coverage_complete", "reviewed_by", "reviewed_at", "accepted_intent", "created_at", "updated_at") SELECT "id", "connection_key", "gmail_message_id", "gmail_thread_id", "client_id", "suggested_project_id", "approved_project_id", "status", "match_reason", "email_drive_file_id", "analysis_payload", "party", "confidence", "content_hash", "label_definition_version", "attempted_label_definition_version", "subject", "sender", "received_at", "failure_attempts", "error_code", "coverage_complete", "reviewed_by", "reviewed_at", "accepted_intent", "created_at", "updated_at" FROM `mail_items`;--> statement-breakpoint
DROP TABLE `mail_items`;--> statement-breakpoint
ALTER TABLE `__new_mail_items` RENAME TO `mail_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `mail_items_profile_message_unique` ON `mail_items` (`connection_key`,`gmail_message_id`);--> statement-breakpoint
CREATE INDEX `mail_items_profile_status_idx` ON `mail_items` (`connection_key`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `mail_items_status_idx` ON `mail_items` (`status`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `google_connections_google_subject_unique` ON `google_connections` (`google_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `google_connections_google_email_lower_unique` ON `google_connections` (lower("google_email"));
