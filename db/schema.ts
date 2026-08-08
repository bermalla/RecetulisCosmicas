import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const groupMembers = sqliteTable(
  "group_members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "editor", "reader"] })
      .notNull()
      .default("reader"),
    addedBy: text("added_by").references(() => users.id),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    uniqueIndex("group_members_user_idx").on(table.userId),
  ],
);

export const groupInvites = sqliteTable(
  "group_invites",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ["editor", "reader"] }).notNull().default("editor"),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.email] })],
);

export const recipes = sqliteTable("recipes", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().default("recetulis-cosmicas"),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default(""),
  instructions: text("instructions").notNull().default("[]"),
  nutrients: text("nutrients").notNull().default("[]"),
  durationMinutes: integer("duration_minutes"),
  servings: integer("servings"),
  image: text("image"),
  sourceUrl: text("source_url"),
  favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const recipeIngredients = sqliteTable("recipe_ingredients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recipeId: text("recipe_id")
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  quantity: text("quantity"),
  unit: text("unit"),
  optional: integer("optional", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const recipeRevisions = sqliteTable(
  "recipe_revisions",
  {
    sequence: integer("sequence").primaryKey({ autoIncrement: true }),
    recipeId: text("recipe_id").notNull(),
    groupId: text("group_id").notNull(),
    version: integer("version").notNull(),
    baseVersion: integer("base_version"),
    operation: text("operation", { enum: ["create", "update", "delete"] }).notNull(),
    payload: text("payload"),
    authorId: text("author_id").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("recipe_revisions_recipe_version_idx").on(table.recipeId, table.version),
  ],
);

export const recipeNameClaims = sqliteTable(
  "recipe_name_claims",
  {
    groupId: text("group_id").notNull(),
    normalizedName: text("normalized_name").notNull(),
    recipeId: text("recipe_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.normalizedName] })],
);
