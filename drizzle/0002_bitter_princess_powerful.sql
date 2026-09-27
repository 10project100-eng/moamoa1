CREATE TABLE `price_history` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`price` integer NOT NULL,
	`source` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `saved_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `saved_items` ADD `brand` text DEFAULT '' NOT NULL;
--> statement-breakpoint
INSERT INTO `price_history` (`id`, `item_id`, `user_id`, `price`, `source`, `recorded_at`)
SELECT 'initial-' || `id`, `id`, `user_id`, `price`, 'saved', `created_at`
FROM `saved_items` WHERE `price` IS NOT NULL;
