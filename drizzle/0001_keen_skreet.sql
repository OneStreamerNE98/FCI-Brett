CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`client_code` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`industry` text,
	`drive_folder_id` text,
	`drive_url` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`role` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `filing_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer NOT NULL,
	`match_summary` text NOT NULL,
	`action` text NOT NULL,
	`target_category` text NOT NULL,
	`approval_required` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_items` (
	`id` text PRIMARY KEY NOT NULL,
	`gmail_message_id` text,
	`gmail_thread_id` text,
	`client_id` text,
	`suggested_project_id` text,
	`approved_project_id` text,
	`status` text NOT NULL,
	`match_reason` text,
	`email_drive_file_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`project_number` text NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'planning' NOT NULL,
	`site` text,
	`project_manager` text,
	`estimated_value` integer,
	`drive_folder_id` text,
	`drive_url` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`shared_drive_id` text,
	`client_directory_sheet_id` text,
	`intake_mailbox` text,
	`settings_json` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
