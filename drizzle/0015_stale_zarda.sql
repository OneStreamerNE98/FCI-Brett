CREATE TABLE `workspace_blueprints` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_key` text NOT NULL,
	`version` integer NOT NULL,
	`blueprint_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_blueprints_connection_unique` ON `workspace_blueprints` (`connection_key`);