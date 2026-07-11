CREATE TABLE `google_sheet_sync_state` (
	`connection_key` text NOT NULL,
	`entity_type` text NOT NULL,
	`status` text NOT NULL,
	`last_synced_at` integer,
	`last_error_code` text,
	`last_error_message` text,
	`last_attempt_at` integer,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_sheet_sync_state_profile_entity_unique` ON `google_sheet_sync_state` (`connection_key`,`entity_type`);