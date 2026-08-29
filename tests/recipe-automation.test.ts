import assert from "node:assert/strict";
import test from "node:test";
import {
  readAutomationToken,
  secureTokenEquals,
} from "../lib/recipe-automation-token.ts";
import { validateRecipePayload } from "../scripts/recipes-cli.mjs";

test("automation credentials use a dedicated bounded header", () => {
  const request = new Request("https://example.test/api/recipes", {
    headers: { "X-Recetulis-Automation-Token": "  private-token  " },
  });
  assert.equal(readAutomationToken(request), "private-token");

  const oversized = new Request("https://example.test/api/recipes", {
    headers: { "X-Recetulis-Automation-Token": "x".repeat(513) },
  });
  assert.equal(readAutomationToken(oversized), null);
});

test("automation credentials compare the complete token", async () => {
  assert.equal(await secureTokenEquals("same-token", "same-token"), true);
  assert.equal(await secureTokenEquals("same-token", "other-token"), false);
});

test("recipe CLI accepts the same top-level JSON shapes as the app", () => {
  const recipe = { name: "Sopa", ingredients: [{ name: "Calabaza" }] };
  assert.deepEqual(validateRecipePayload(recipe), [recipe]);
  assert.deepEqual(validateRecipePayload([recipe]), [recipe]);
  assert.deepEqual(validateRecipePayload({ recipe }), [recipe]);
  assert.deepEqual(validateRecipePayload({ recipes: [recipe] }), [recipe]);
});

test("recipe CLI rejects incomplete and oversized batches before the API call", () => {
  assert.throws(
    () => validateRecipePayload({ name: "Sin ingredientes", ingredients: [] }),
    /al menos un ingrediente/,
  );
  assert.throws(
    () => validateRecipePayload(Array.from({ length: 501 }, (_, index) => ({
      name: `Receta ${index}`,
      ingredients: [{ name: "Agua" }],
    }))),
    /máximo es 500/,
  );
});
