CREATE TABLE `user_preferences` (
	`user_email` text PRIMARY KEY NOT NULL,
	`display_timezone` text NOT NULL,
	`reply_signature` text DEFAULT '' NOT NULL,
	`personal_calendar_display` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL
);
