CREATE TABLE `gmail_file_archive_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`archive_id` text NOT NULL,
	`artifact_key` text NOT NULL,
	`kind` text NOT NULL,
	`gmail_attachment_id` text,
	`original_filename` text,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text,
	`drive_file_id` text NOT NULL,
	`drive_url` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_file_archive_artifacts_archive_key_unique` ON `gmail_file_archive_artifacts` (`archive_id`,`artifact_key`);--> statement-breakpoint
CREATE INDEX `gmail_file_archive_artifacts_archive_idx` ON `gmail_file_archive_artifacts` (`archive_id`,`kind`);--> statement-breakpoint
CREATE TABLE `gmail_file_archives` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_key` text NOT NULL,
	`gmail_message_id` text NOT NULL,
	`gmail_thread_id` text,
	`project_id` text NOT NULL,
	`project_drive_folder_id` text NOT NULL,
	`email_archive_folder_id` text NOT NULL,
	`attachment_folder_id` text NOT NULL,
	`status` text NOT NULL,
	`approval_actor` text NOT NULL,
	`approved_at` integer NOT NULL,
	`email_drive_file_id` text,
	`email_drive_url` text,
	`attachment_count` integer DEFAULT 0 NOT NULL,
	`last_error_code` text,
	`filed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_file_archives_profile_message_unique` ON `gmail_file_archives` (`connection_key`,`gmail_message_id`);--> statement-breakpoint
CREATE INDEX `gmail_file_archives_project_status_idx` ON `gmail_file_archives` (`connection_key`,`project_id`,`status`,`updated_at`);