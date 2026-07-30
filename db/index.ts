import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }
  return env.DB;
}

export async function getDb() {
  return drizzle(await getD1(), { schema });
}

export async function ensureSchema() {
  const d1 = await getD1();

  await d1.batch([
    d1.prepare(`
      CREATE TABLE IF NOT EXISTS recipes (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        description text DEFAULT '' NOT NULL,
        category text DEFAULT '' NOT NULL,
        instructions text DEFAULT '[]' NOT NULL,
        nutrients text DEFAULT '[]' NOT NULL,
        duration_minutes integer,
        servings integer,
        image text,
        source_url text,
        created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `),
    d1.prepare(`
      CREATE TABLE IF NOT EXISTS recipe_ingredients (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        recipe_id text NOT NULL,
        name text NOT NULL,
        normalized_name text NOT NULL,
        quantity text,
        unit text,
        optional integer DEFAULT false NOT NULL,
        sort_order integer DEFAULT 0 NOT NULL,
        FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
      )
    `),
    d1.prepare(
      "CREATE INDEX IF NOT EXISTS recipe_ingredients_recipe_id_idx ON recipe_ingredients (recipe_id)",
    ),
    d1.prepare(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key text PRIMARY KEY NOT NULL,
        value text DEFAULT '' NOT NULL,
        created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `),
  ]);

  try {
    await d1
      .prepare("ALTER TABLE recipes ADD COLUMN nutrients text DEFAULT '[]' NOT NULL")
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("duplicate column")) throw error;
  }

  try {
    await d1
      .prepare("ALTER TABLE recipes ADD COLUMN category text DEFAULT '' NOT NULL")
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("duplicate column")) throw error;
  }
}
