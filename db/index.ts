import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export async function getD1() {
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
      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY NOT NULL,
        email text NOT NULL UNIQUE,
        display_name text DEFAULT '' NOT NULL,
        created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
        last_seen_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `),
    d1.prepare(`
      CREATE TABLE IF NOT EXISTS groups (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        created_by text,
        created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `),
    d1.prepare(`
      CREATE TABLE IF NOT EXISTS group_members (
        group_id text NOT NULL,
        user_id text NOT NULL,
        role text DEFAULT 'reader' NOT NULL,
        added_by text,
        created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
        PRIMARY KEY (group_id, user_id),
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (added_by) REFERENCES users(id)
      )
    `),
    d1.prepare(`
      CREATE TABLE IF NOT EXISTS group_invites (
        group_id text NOT NULL,
        email text NOT NULL,
        role text DEFAULT 'editor' NOT NULL,
        invited_by text NOT NULL,
        created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
        PRIMARY KEY (group_id, email),
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
        FOREIGN KEY (invited_by) REFERENCES users(id)
      )
    `),
    d1.prepare(`
      CREATE TABLE IF NOT EXISTS recipes (
        id text PRIMARY KEY NOT NULL,
        group_id text DEFAULT 'recetulis-cosmicas' NOT NULL,
        name text NOT NULL,
        description text DEFAULT '' NOT NULL,
        category text DEFAULT '' NOT NULL,
        instructions text DEFAULT '[]' NOT NULL,
        nutrients text DEFAULT '[]' NOT NULL,
        duration_minutes integer,
        servings integer,
        image text,
        source_url text,
        version integer DEFAULT 1 NOT NULL,
        created_by text,
        updated_by text,
        deleted_at text,
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
    d1.prepare(`
      CREATE TABLE IF NOT EXISTS recipe_revisions (
        sequence integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        recipe_id text NOT NULL,
        group_id text NOT NULL,
        version integer NOT NULL,
        base_version integer,
        operation text NOT NULL,
        payload text,
        author_id text NOT NULL,
        created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `),
    d1.prepare(`
      CREATE TABLE IF NOT EXISTS recipe_name_claims (
        group_id text NOT NULL,
        normalized_name text NOT NULL,
        recipe_id text NOT NULL,
        PRIMARY KEY (group_id, normalized_name)
      )
    `),
  ]);

  const recipeColumns = [
    "nutrients text DEFAULT '[]' NOT NULL",
    "category text DEFAULT '' NOT NULL",
    "group_id text DEFAULT 'recetulis-cosmicas' NOT NULL",
    "version integer DEFAULT 1 NOT NULL",
    "created_by text",
    "updated_by text",
    "deleted_at text",
  ];
  for (const definition of recipeColumns) {
    try {
      await d1.prepare(`ALTER TABLE recipes ADD COLUMN ${definition}`).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("duplicate column")) throw error;
    }
  }

  await d1.batch([
    d1.prepare(
      "CREATE INDEX IF NOT EXISTS recipe_ingredients_recipe_id_idx ON recipe_ingredients (recipe_id)",
    ),
    d1.prepare(
      "CREATE INDEX IF NOT EXISTS recipes_group_active_idx ON recipes (group_id, deleted_at, updated_at)",
    ),
    d1.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS recipe_revisions_recipe_version_idx ON recipe_revisions (recipe_id, version)",
    ),
    d1.prepare(
      "CREATE INDEX IF NOT EXISTS recipe_revisions_group_sequence_idx ON recipe_revisions (group_id, sequence)",
    ),
    d1.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS group_members_user_idx ON group_members (user_id)",
    ),
  ]);
}
