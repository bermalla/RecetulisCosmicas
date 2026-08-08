import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { filterRecipesByPantry, ingredientMatchesPantry } from "../mobile/src/recipe-filter.ts";
import {
  ingredientSuggestionQuery,
  rankSuggestions,
  replaceActiveIngredient,
} from "../mobile/src/autocomplete.ts";
import { groupScope } from "../mobile/src/storage.ts";
import type { Recipe } from "../mobile/src/types.ts";

const recipes: Recipe[] = [
  {
    id: "lentil-soup",
    name: "Sopa de lentejas",
    description: "",
    category: "Sopa",
    instructions: [],
    nutrients: [],
    ingredients: [{ name: "lentejas cocidas" }, { name: "tomates" }],
  },
  {
    id: "coconut-oil-cookie",
    name: "Galletas con aceite de coco",
    description: "",
    category: "Galletas",
    instructions: [],
    nutrients: [],
    ingredients: [{ name: "aceite de coco" }, { name: "avena" }],
  },
];

test("filters Android recipes by pantry ingredients", () => {
  assert.deepEqual(filterRecipesByPantry(recipes, ["lenteja"]), [recipes[0]]);
  assert.deepEqual(filterRecipesByPantry(recipes, ["tomate"]), [recipes[0]]);
  assert.deepEqual(filterRecipesByPantry(recipes, []), recipes);
});

test("keeps derived products distinct in the Android filter", () => {
  assert.equal(ingredientMatchesPantry({ name: "aceite de coco" }, "coco"), false);
  assert.equal(ingredientMatchesPantry({ name: "aceite de coco" }, "aceite de coco"), true);
});

test("isolates Android caches and cursors by group", () => {
  assert.equal(groupScope("group-a"), "group:group-a");
  assert.notEqual(groupScope("group-a"), groupScope("group-b"));
});

test("database invariant allows one active group per user", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE group_members (
        group_id text NOT NULL,
        user_id text NOT NULL,
        role text NOT NULL,
        PRIMARY KEY (group_id, user_id)
      );
      CREATE UNIQUE INDEX group_members_user_idx ON group_members (user_id);
    `);
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)")
      .run("group-a", "user-1", "reader");
    assert.throws(
      () => db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)")
        .run("group-b", "user-1", "editor"),
      /unique/i,
    );
    db.prepare("DELETE FROM group_members WHERE user_id = ?").run("user-1");
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)")
      .run("group-b", "user-1", "editor");
    const membership = db.prepare("SELECT group_id FROM group_members WHERE user_id = ?")
      .get("user-1") as { group_id: string };
    assert.equal(membership.group_id, "group-b");
  } finally {
    db.close();
  }
});

test("autocomplete returns at most five nearby unique suggestions", () => {
  const suggestions = rankSuggestions("tom", [
    "Tomate",
    "tomates",
    "Tomillo",
    "Salsa de tomate",
    "Tomatillo",
    "Toma",
    "Cebolla",
  ]);
  assert.equal(suggestions.length, 5);
  assert.equal(suggestions[0], "Toma");
  assert.ok(suggestions.includes("Tomate"));
  assert.ok(!suggestions.includes("Cebolla"));
});

test("ingredient autocomplete only replaces the active line and keeps its amount", () => {
  const source = "2 tazas hari\n1 huevo";
  const cursor = source.indexOf("hari") + 4;
  assert.equal(ingredientSuggestionQuery(source, cursor), "hari");
  const replacement = replaceActiveIngredient(source, cursor, "harina integral");
  assert.equal(replacement.value, "2 tazas harina integral\n1 huevo");
});

test("recipe edits reject a stale shared version", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE recipes (id text PRIMARY KEY, version integer NOT NULL, name text NOT NULL)");
    db.prepare("INSERT INTO recipes (id, version, name) VALUES (?, ?, ?)").run("recipe-1", 1, "Original");
    const first = db.prepare("UPDATE recipes SET name = ?, version = ? WHERE id = ? AND version = ?")
      .run("Primera edición", 2, "recipe-1", 1);
    const stale = db.prepare("UPDATE recipes SET name = ?, version = ? WHERE id = ? AND version = ?")
      .run("Edición atrasada", 2, "recipe-1", 1);
    assert.equal(first.changes, 1);
    assert.equal(stale.changes, 0);
    assert.equal((db.prepare("SELECT name FROM recipes WHERE id = ?").get("recipe-1") as { name: string }).name, "Primera edición");
  } finally {
    db.close();
  }
});
