import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

export async function ensureCoverPositionColumns() {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }

  const readColumns = async () => {
    const result = await env.DB.prepare("PRAGMA table_info(saved_items)").all<{ name: string }>();
    return new Set((result.results ?? []).map((column) => column.name));
  };

  let columns = await readColumns();
  const migrations = [
    ["cover_position_x", "ALTER TABLE `saved_items` ADD `cover_position_x` integer DEFAULT 50 NOT NULL"],
    ["cover_position_y", "ALTER TABLE `saved_items` ADD `cover_position_y` integer DEFAULT 50 NOT NULL"],
  ] as const;

  for (const [column, statement] of migrations) {
    if (columns.has(column)) continue;
    try {
      await env.DB.prepare(statement).run();
      columns.add(column);
    } catch (error) {
      // Another request can finish the same one-time migration concurrently.
      columns = await readColumns();
      if (!columns.has(column)) throw error;
    }
  }
}
