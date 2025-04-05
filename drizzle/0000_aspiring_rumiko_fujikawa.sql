CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`parent_message_id` text,
	`content` text NOT NULL,
	`sender` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
