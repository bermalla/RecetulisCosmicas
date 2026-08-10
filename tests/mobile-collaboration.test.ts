import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { filterRecipesByPantry, ingredientMatchesPantry } from "../mobile/src/recipe-filter.ts";
import { filterRecipesByCategory, recipeCategoryOptions } from "../mobile/src/recipe-category.ts";
import { mergeLocalRecipeImport, parseRecipeImport } from "../mobile/src/recipe-import.ts";
import {
  ingredientSuggestionQuery,
  rankIngredientSuggestions,
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

test("filters Android recipes by category and lists only available categories", () => {
  const dessert: Recipe = { ...recipes[0], id: "dessert", category: "Postre" };
  const main: Recipe = { ...recipes[1], id: "main", category: "Plato principal" };
  const secondDessert: Recipe = { ...recipes[1], id: "dessert-2", category: "postre" };
  const collection = [dessert, main, secondDessert];

  assert.deepEqual(filterRecipesByCategory(collection, "POSTRE"), [dessert, secondDessert]);
  assert.deepEqual(filterRecipesByCategory(collection, ""), collection);
  assert.deepEqual(recipeCategoryOptions(collection), [
    { value: "plato principal", label: "Plato principal", count: 1 },
    { value: "postre", label: "Postre", count: 2 },
  ]);
});

test("parses recipe JSON exports and simple generated ingredient lists", () => {
  const imported = parseRecipeImport(JSON.stringify({ recipes: [{
    name: "Tarta de cebolla",
    category: "Plato principal",
    ingredients: ["cebolla", { name: "harina", quantity: 200, unit: "g" }],
    instructions: "Picar la cebolla\nHornear",
  }] }));
  assert.equal(imported[0].name, "Tarta de cebolla");
  assert.deepEqual(imported[0].ingredients, [
    { name: "cebolla" },
    { name: "harina", normalizedName: undefined, quantity: "200", unit: "g", optional: false },
  ]);
  assert.deepEqual(imported[0].instructions, ["Picar la cebolla", "Hornear"]);
});

test("local JSON import adds recipes and skips duplicate names", () => {
  const incoming = [
    { ...recipes[0], id: "external-1", name: "Sopa de lentejas" },
    { ...recipes[1], id: "external-2", name: "Tarta nueva" },
    { ...recipes[1], id: "external-3", name: "tarta NUEVA" },
  ];
  const merged = mergeLocalRecipeImport([recipes[0]], incoming, () => "new-id", "2026-08-09T00:00:00.000Z");
  assert.equal(merged.imported, 1);
  assert.equal(merged.skipped, 2);
  assert.equal(merged.recipes.length, 2);
  assert.equal(merged.recipes[1].id, "new-id");
  assert.equal(merged.recipes[1].localOnly, true);
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

test("ingredient autocomplete understands common quantities and units", () => {
  const candidates = ["harina integral", "huevo", "aceite de oliva", "ajo"];
  const source = "2 cucharadas de hari";
  assert.equal(ingredientSuggestionQuery(source, source.length), "hari");
  assert.deepEqual(rankIngredientSuggestions(source, source.length, candidates), ["harina", "harina integral"]);

  const impreciseUnit = "un poco de acei";
  assert.ok(rankIngredientSuggestions(impreciseUnit, impreciseUnit.length, candidates).includes("aceite de oliva"));
});

test("ingredient autocomplete ranks basic and frequent ingredients before variants", () => {
  const candidates = [
    "cebolla de verdeo",
    "cebolla",
    "cebolla morada",
    "cebolla",
    "cebolla de verdeo",
    "cebolla caramelizada",
  ];
  const suggestions = rankIngredientSuggestions("cebo", 4, candidates);
  assert.equal(suggestions.length, 4);
  assert.deepEqual(suggestions.slice(0, 2), ["cebolla", "cebolla de verdeo"]);
  assert.ok(suggestions.length <= 5);
});

test("ingredient autocomplete derives a basic suggestion from complex ingredients", () => {
  const candidates = ["aceite de oliva extra virgen", "aceite de coco"];
  assert.deepEqual(
    rankIngredientSuggestions("acei", 4, candidates),
    ["aceite", "aceite de coco", "aceite de oliva extra virgen"],
  );
});

test("ingredient autocomplete never returns more than five ranked candidates", () => {
  const candidates = [
    "cebolla",
    "cebolla de verdeo",
    "cebolla morada",
    "cebolla blanca",
    "cebolla caramelizada",
    "cebolla deshidratada",
    "cebollín",
  ];
  assert.equal(rankIngredientSuggestions("cebo", 4, candidates).length, 5);
});

test("Android native back handling remains enabled", () => {
  const config = readFileSync(new URL("../mobile/capacitor.config.ts", import.meta.url), "utf8");
  assert.match(config, /disableBackButtonHandler:\s*false/);
  assert.doesNotMatch(config, /disableBackButtonHandler:\s*true/);
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
