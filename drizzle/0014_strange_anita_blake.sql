ALTER TABLE `projects` ADD `installation_started_at` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `installation_completed_at` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `had_callback` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `callback_note` text;