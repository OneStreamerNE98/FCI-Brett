CREATE UNIQUE INDEX IF NOT EXISTS `clients_code_unique_idx` ON `clients` (`client_code`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `clients_name_idx` ON `clients` (`name`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `contacts_client_idx` ON `contacts` (`client_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `filing_rules_priority_idx` ON `filing_rules` (`priority`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `google_integration_events_created_idx` ON `google_integration_events` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mail_items_status_idx` ON `mail_items` (`status`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `projects_number_unique_idx` ON `projects` (`project_number`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `projects_client_idx` ON `projects` (`client_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `records_type_idx` ON `records` (`type`,`updated_at`);
