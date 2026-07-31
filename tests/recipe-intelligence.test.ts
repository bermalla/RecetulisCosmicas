import assert from "node:assert/strict";
import test from "node:test";
import {
  filterRecipesByCategory,
  filterRecipesByIngredientMatches,
  inferRecipeCategory,
  inferNutrients,
  ingredientBaseSuggestions,
  ingredientMatchesQuery,
  isAssumedPantryIngredient,
  normalizeIngredientSearch,
  normalizeRecipeCategory,
  mergeNutrients,
  partitionRecipeDuplicates,
  reviewRecipeDuplicates,
} from "../lib/recipe-intelligence.ts";

test("hides recipes without ingredient matches only while filtering", () => {
  const recipes = [
    { name: "Coincide", matched: [{ name: "banana" }] },
    { name: "No coincide", matched: [] },
  ];

  assert.deepEqual(filterRecipesByIngredientMatches(recipes, true), [recipes[0]]);
  assert.deepEqual(filterRecipesByIngredientMatches(recipes, false), recipes);
});

test("filters recipes by dish category and preserves all recipes when unset", () => {
  const recipes = [
    { name: "Tarta de verduras", category: "Tarta" },
    { name: "Budín de limón", category: "Postre" },
    { name: "Guiso", category: "Plato principal" },
  ];

  assert.deepEqual(filterRecipesByCategory(recipes, "Postre"), [recipes[1]]);
  assert.deepEqual(filterRecipesByCategory(recipes, "postre"), [recipes[1]]);
  assert.deepEqual(filterRecipesByCategory(recipes, ""), recipes);
});

test("normalizes common Spanish singular and plural forms", () => {
  assert.equal(normalizeIngredientSearch("banana"), "banana");
  assert.equal(normalizeIngredientSearch("bananas"), "banana");
  assert.equal(normalizeIngredientSearch("tomates"), "tomate");
  assert.equal(normalizeIngredientSearch("nueces"), "nuez");
  assert.equal(normalizeIngredientSearch("garbanzos"), "garbanzo");
  assert.equal(normalizeIngredientSearch("maníes"), "mani");
  assert.equal(
    ingredientMatchesQuery({ name: "bananas maduras" }, "banana"),
    true,
  );
  assert.equal(
    ingredientMatchesQuery({ name: "banana madura" }, "bananas"),
    true,
  );
});

test("derives singular base ingredients for autocomplete", () => {
  assert.deepEqual(
    ingredientBaseSuggestions({ name: "una banana chica" }),
    ["banana"],
  );
  assert.deepEqual(
    ingredientBaseSuggestions({ name: "bananas pisadas" }),
    ["banana"],
  );
  assert.deepEqual(
    ingredientBaseSuggestions({ name: "harina integral" }),
    ["harina"],
  );
  assert.deepEqual(
    ingredientBaseSuggestions({ name: "2 dientes de ajo" }),
    ["ajo"],
  );
  assert.deepEqual(
    ingredientBaseSuggestions({ name: "un atado de acelgas" }),
    ["acelga"],
  );
  assert.deepEqual(
    ingredientBaseSuggestions({ name: "sal y pimienta" }),
    ["sal", "pimienta"],
  );
});

test("matches a base ingredient despite quantities and preparation details", () => {
  assert.equal(
    ingredientMatchesQuery(
      { name: "1/2 taza de coco rallado", normalizedName: "coco rallado" },
      "coco",
    ),
    true,
  );
  assert.equal(
    ingredientMatchesQuery({ name: "tomates picados" }, "tomate"),
    true,
  );
  assert.equal(
    ingredientMatchesQuery({ name: "atado de acelgas" }, "Acelga"),
    true,
  );
  assert.equal(
    ingredientMatchesQuery({ name: "manojo de acelgas" }, "acelgas"),
    true,
  );
  assert.equal(
    ingredientMatchesQuery({ name: "relleno casero con acelgas tiernas" }, "acelga"),
    true,
  );
  assert.equal(
    ingredientMatchesQuery({ name: "mezcla de nueces y coco rallado" }, "coco"),
    true,
  );
});

test("matches whole words while keeping derived products distinct", () => {
  assert.equal(
    ingredientMatchesQuery({ name: "aceite de coco" }, "coco"),
    false,
  );
  assert.equal(
    ingredientMatchesQuery({ name: "harina integral de coco" }, "coco"),
    false,
  );
  assert.equal(
    ingredientMatchesQuery({ name: "leche de almendras" }, "almendra"),
    false,
  );
  assert.equal(
    ingredientMatchesQuery({ name: "aceite de coco" }, "aceite de coco"),
    true,
  );
  assert.equal(
    ingredientMatchesQuery({ name: "cocodrilo vegano" }, "coco"),
    false,
  );
  assert.equal(
    ingredientMatchesQuery({ name: "sal y pimienta" }, "pimienta"),
    true,
  );
  assert.equal(
    ingredientMatchesQuery({ name: "aceite de oliva y coco rallado" }, "coco"),
    true,
  );
});

test("infers useful recipe categories from names", () => {
  assert.equal(inferRecipeCategory("Buñuelos de espinaca"), "Buñuelos");
  assert.equal(inferRecipeCategory("Tortilla de papa"), "Tortilla");
  assert.equal(inferRecipeCategory("Ensalada tibia de lentejas"), "Ensalada");
  assert.equal(inferRecipeCategory("Galletas de avena"), "Galletas");
  assert.equal(inferRecipeCategory("Pasta frola integral"), "Tarta");
  assert.equal(inferRecipeCategory("Pan de lentejas"), "Pan");
  assert.equal(inferRecipeCategory("Zapallitos rellenos"), "Plato principal");
  assert.equal(normalizeRecipeCategory("ensalada", "Otro nombre"), "Ensalada");
});

test("treats only everyday pantry staples as assumed available", () => {
  for (const name of [
    "agua tibia",
    "sal marina",
    "azúcar mascabo",
    "pimienta negra",
    "aceite",
    "aceite neutro",
    "aceite vegetal",
  ]) {
    assert.equal(isAssumedPantryIngredient({ name }), true, name);
  }

  for (const name of ["aceite de coco", "aceite de oliva", "harina", "ajo"]) {
    assert.equal(isAssumedPantryIngredient({ name }), false, name);
  }
});

test("infers reference nutrients from required ingredients", () => {
  const nutrients = inferNutrients([
    { name: "lentejas cocidas" },
    { name: "tomate" },
  ]);

  assert.deepEqual(nutrients, [
    "Zinc",
    "Ácido fólico",
    "Vitamina C",
    "Hierro",
  ]);
});

test("does not infer nutrients from optional ingredients", () => {
  assert.deepEqual(
    inferNutrients([{ name: "semillas de chía", optional: true }]),
    [],
  );
  assert.deepEqual(
    inferNutrients([{ name: "semillas de chía", optional: false }]),
    ["Omega 3"],
  );
});

test("does not treat plant alternatives as dairy sources of iodine or selenium", () => {
  const nutrients = inferNutrients([
    { name: "leche de almendras" },
    { name: "queso vegetal" },
  ]);

  assert.equal(nutrients.includes("Yodo"), false);
  assert.equal(nutrients.includes("Selenio"), false);
});

test("canonicalizes and merges explicit nutrients without duplicates", () => {
  assert.deepEqual(
    mergeNutrients(["hierro", "CoQ10"], [{ name: "lentejas" }]),
    ["Zinc", "Ácido fólico", "Coenzima Q10", "Hierro"],
  );
});

test("detects an existing recipe despite accents and capitalization", () => {
  const existing = [
    {
      id: "one",
      name: "Granola de lenteja",
      instructions: ["Hornear las lentejas durante veinte minutos."],
      ingredients: [{ name: "lentejas" }],
    },
  ];
  const incoming = [
    {
      id: "two",
      name: "GRANOLA DE LENTÉJA",
      instructions: ["Otro procedimiento suficientemente extenso."],
      ingredients: [{ name: "lentejas" }],
    },
  ];

  assert.deepEqual(reviewRecipeDuplicates(incoming, existing), [
    {
      incomingName: "GRANOLA DE LENTÉJA",
      existingName: "Granola de lenteja",
      source: "database",
      reason: "same-name",
    },
  ]);
});

test("detects repeated content inside a single import file", () => {
  const incoming = [
    {
      name: "Preparación A",
      instructions: ["Mezclar todos los ingredientes y cocinar veinte minutos."],
      ingredients: [{ name: "lentejas", quantity: "1", unit: "taza" }],
    },
    {
      name: "Preparación B",
      instructions: ["Mezclar todos los ingredientes y cocinar veinte minutos."],
      ingredients: [{ name: "lentejas", quantity: "1", unit: "taza" }],
    },
  ];

  assert.deepEqual(reviewRecipeDuplicates(incoming, []), [
    {
      incomingName: "Preparación B",
      existingName: "Preparación A",
      source: "file",
      reason: "same-content",
    },
  ]);
});

test("keeps missing recipes and skips existing ones when resuming an import", () => {
  const existing = [
    {
      name: "Sopa ya guardada",
      instructions: ["Cocinar la sopa durante veinte minutos."],
      ingredients: [{ name: "calabaza" }],
    },
  ];
  const missing = {
    name: "Ensalada pendiente",
    instructions: ["Mezclar todos los ingredientes y servir."],
    ingredients: [{ name: "tomate" }],
  };
  const partition = partitionRecipeDuplicates([existing[0], missing], existing);

  assert.deepEqual(partition.accepted, [missing]);
  assert.equal(partition.duplicates.length, 1);
  assert.equal(partition.duplicates[0].incomingName, "Sopa ya guardada");
});

test("accepts the first occurrence and skips later duplicates in the same batch", () => {
  const first = {
    name: "Preparación original",
    instructions: ["Mezclar y cocinar durante treinta minutos."],
    ingredients: [{ name: "garbanzos" }],
  };
  const repeated = { ...first };
  const partition = partitionRecipeDuplicates([first, repeated], []);

  assert.deepEqual(partition.accepted, [first]);
  assert.equal(partition.duplicates.length, 1);
  assert.equal(partition.duplicates[0].source, "file");
});
