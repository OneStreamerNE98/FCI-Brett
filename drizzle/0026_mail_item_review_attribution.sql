ALTER TABLE `mail_items` ADD COLUMN `reviewed_by` text;--> statement-breakpoint
ALTER TABLE `mail_items` ADD COLUMN `reviewed_at` integer;--> statement-breakpoint
ALTER TABLE `mail_items` ADD COLUMN `accepted_intent` text;
