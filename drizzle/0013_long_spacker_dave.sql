CREATE TABLE `workspace_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_key` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_key` text NOT NULL,
	`external_id` text NOT NULL,
	`parent_external_id` text,
	`external_url` text,
	`origin` text NOT NULL,
	`metadata_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_resources_connection_type_key_unique` ON `workspace_resources` (`connection_key`,`resource_type`,`resource_key`);