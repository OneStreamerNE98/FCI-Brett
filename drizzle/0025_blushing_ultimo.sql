CREATE TABLE `assistant_label_definitions` (
	`slug` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`retired` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assistant_label_definitions_created_at_idx` ON `assistant_label_definitions` (`created_at`,`slug`);
--> statement-breakpoint
INSERT INTO `assistant_label_definitions` (`slug`, `description`, `retired`, `created_at`, `updated_at`) VALUES
	('lead', 'A new sales opportunity or request for an estimate.', 0, 0, 0),
	('project-update', 'Information or a requested change concerning existing project work.', 0, 0, 0),
	('schedule', 'A request or change involving an appointment, installation, or project timing.', 0, 0, 0),
	('warranty', 'A callback, repair, service, or warranty concern.', 0, 0, 0);
