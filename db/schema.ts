import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const savedItems = sqliteTable("saved_items", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull().default(""),
  category: text("category").notNull(),
  price: integer("price"),
  note: text("note").notNull().default(""),
  imageKey: text("image_key"),
  createdAt: text("created_at").notNull(),
});
