CREATE TABLE `saved_item_images` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`image_key` text NOT NULL,
	`content_type` text NOT NULL,
	`source_url` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `saved_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `saved_items` ADD `source_description` text DEFAULT '' NOT NULL;