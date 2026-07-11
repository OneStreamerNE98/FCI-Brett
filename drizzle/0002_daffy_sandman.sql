CREATE TABLE `drive_folder_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_key` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`folder_key` text NOT NULL,
	`drive_file_id` text NOT NULL,
	`parent_drive_file_id` text,
	`drive_url` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drive_folder_mappings_drive_file_id_unique` ON `drive_folder_mappings` (`drive_file_id`);--> statement-breakpoint
CREATE TABLE `google_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_key` text NOT NULL,
	`google_subject` text NOT NULL,
	`google_email` text NOT NULL,
	`scopes_json` text NOT NULL,
	`refresh_token_ciphertext` text NOT NULL,
	`key_version` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`last_error_code` text,
	`last_success_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_connections_connection_key_unique` ON `google_connections` (`connection_key`);--> statement-breakpoint
CREATE TABLE `google_drive_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_key` text NOT NULL,
	`operation_key` text NOT NULL,
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`lease_expires_at` integer,
	`last_error_code` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_drive_operations_operation_key_unique` ON `google_drive_operations` (`operation_key`);--> statement-breakpoint
CREATE TABLE `google_integration_events` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_key` text NOT NULL,
	`event_type` text NOT NULL,
	`actor` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`detail` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `google_oauth_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_key` text NOT NULL,
	`state_hash` text NOT NULL,
	`pkce_verifier_ciphertext` text NOT NULL,
	`browser_nonce_hash` text NOT NULL,
	`initiated_by` text NOT NULL,
	`scopes_json` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_oauth_attempts_state_hash_unique` ON `google_oauth_attempts` (`state_hash`);