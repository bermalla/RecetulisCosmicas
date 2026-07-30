import assert from "node:assert/strict";
import test from "node:test";
import {
  filterRecipesByIngredientMatches,
  inferRecipeCategory,
  inferNutrients,
  ingredientBaseSuggestions,
  ingredientMatchesQuery,
  isAssumedPantryIngredient,
  normalizeIngredientSearch,
  normalizeRecipeCategory,
  mergeNutrients,
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
});

test("matches whole ingredient words without broad compound false positives", () => {
  assert.equal(
    ingredientMatchesQuery({ name: "aceite de coco" }, "coco"),
    false,
  );
  assert.equal(
    ingredientMatchesQuery({ name: "cocodrilo vegano" }, "coco"),
    false,
  );
  assert.equal(
    ingredientMatchesQuery({ name: "sal y pimienta" }, "pimienta"),
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
