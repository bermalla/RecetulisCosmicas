import assert from "node:assert/strict";
import test from "node:test";
import {
  inferNutrients,
  ingredientMatchesQuery,
  mergeNutrients,
  reviewRecipeDuplicates,
} from "../lib/recipe-intelligence.ts";

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
