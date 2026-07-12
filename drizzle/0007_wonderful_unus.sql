CREATE TABLE `workspace_simulation_state` (
	`id` text PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
