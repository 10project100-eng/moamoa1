import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const savedItems = sqliteTable("saved_items", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull().default(""),
  category: text("category").notNull(),
  price: integer("price"),
  note: text("note").notNull().default(""),
  sourceDescription: text("source_description").notNull().default(""),
  imageKey: text("image_key"),
  createdAt: text("created_at").notNull(),
});

export const savedItemImages = sqliteTable("saved_item_images", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull().references(() => savedItems.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  imageKey: text("image_key").notNull(),
  contentType: text("content_type").notNull(),
  sourceUrl: text("source_url").notNull(),
  position: integer("position").notNull(),
});
