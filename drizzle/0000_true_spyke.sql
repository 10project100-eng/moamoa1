CREATE TABLE `saved_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`price` integer,
	`note` text DEFAULT '' NOT NULL,
	`image_key` text,
	`created_at` text NOT NULL
);
