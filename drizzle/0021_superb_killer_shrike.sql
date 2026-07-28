ALTER TABLE `mail_items` ADD `connection_key` text DEFAULT 'google-workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE `mail_items` ADD `analysis_payload` text;--> statement-breakpoint
ALTER TABLE `mail_items` ADD `party` text;--> statement-breakpoint
ALTER TABLE `mail_items` ADD `confidence` text;--> statement-breakpoint
ALTER TABLE `mail_items` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `mail_items` ADD `label_definition_version` text;--> statement-breakpoint
ALTER TABLE `mail_items` ADD `attempted_label_definition_version` text;--> statement-breakpoint
ALTER TABLE `mail_items` ADD `subject` text;--> statement-breakpoint
ALTER TABLE `mail_items` ADD `sender` text;--> statement-breakpoint
ALTER TABLE `mail_items` ADD `received_at` integer;--> statement-breakpoint
ALTER TABLE `mail_items` ADD `failure_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `mail_items` ADD `error_code` text;--> statement-breakpoint
ALTER TABLE `mail_items` ADD `coverage_complete` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `mail_items_profile_message_unique` ON `mail_items` (`connection_key`,`gmail_message_id`);--> statement-breakpoint
CREATE INDEX `mail_items_profile_status_idx` ON `mail_items` (`connection_key`,`status`,`updated_at`);
