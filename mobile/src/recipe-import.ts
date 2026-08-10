import type { Ingredient, Recipe } from "./types";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function textList(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  return value
    .split(/\r?\n/u)
    .map((item) => item.replace(/^\s*(?:\d+[.)-]?|[-•])\s*/u, "").trim())
    .filter(Boolean);
}

function ingredient(value: unknown): Ingredient | null {
  if (typeof value === "string") {
    const name = value.trim();
    return name ? { name } : null;
  }
  const source = record(value);
  const name = text(source?.name);
  if (!source || !name) return null;
  const quantity = source.quantity;
  return {
    name,
    normalizedName: text(source.normalizedName) || undefined,
    quantity: quantity === null || quantity === undefined ? null : String(quantity).trim(),
    unit: text(source.unit) || null,
    optional: Boolean(source.optional),
  };
}

function recipe(value: unknown, index: number): Recipe {
  const source = record(value);
  const name = text(source?.name);
  const ingredients = Array.isArray(source?.ingredients)
    ? source.ingredients.map(ingredient).filter((item): item is Ingredient => Boolean(item))
    : [];
  if (!source || !name || ingredients.length === 0) {
    throw new Error(`La receta ${index + 1} necesita un nombre y al menos un ingrediente.`);
  }
  return {
    id: text(source.id),
    name,
    description: text(source.description),
    category: text(source.category),
    instructions: textList(source.instructions),
    nutrients: Array.isArray(source.nutrients)
      ? source.nutrients.map(String).map((item) => item.trim()).filter(Boolean)
      : [],
    durationMinutes: typeof source.durationMinutes === "number" ? source.durationMinutes : null,
    servings: typeof source.servings === "number" ? source.servings : null,
    image: text(source.image) || null,
    sourceUrl: text(source.sourceUrl) || null,
    favorite: Boolean(source.favorite),
    ingredients,
  };
}

export function parseRecipeImport(contents: string) {
  let payload: unknown;
  try {
    payload = JSON.parse(contents);
  } catch {
    throw new Error("El archivo no contiene JSON válido.");
  }
  const source = record(payload);
  const incoming = Array.isArray(payload) ? payload : source?.recipes;
  if (!Array.isArray(incoming)) throw new Error("El archivo no contiene una lista de recetas.");
  if (incoming.length === 0) throw new Error("El archivo no contiene recetas.");
  if (incoming.length > 500) throw new Error("El archivo supera las 500 recetas.");
  return incoming.map(recipe);
}

function recipeNameKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function mergeLocalRecipeImport(
  existing: Recipe[],
  incoming: Recipe[],
  createId: () => string,
  now = new Date().toISOString(),
) {
  const names = new Set(existing.map((item) => recipeNameKey(item.name)));
  const accepted: Recipe[] = [];
  let skipped = 0;
  for (const recipeToImport of incoming) {
    const key = recipeNameKey(recipeToImport.name);
    if (!key || names.has(key)) {
      skipped += 1;
      continue;
    }
    names.add(key);
    accepted.push({
      ...recipeToImport,
      id: createId(),
      version: 1,
      updatedAt: now,
      localOnly: true,
    });
  }
  return { recipes: [...existing, ...accepted], imported: accepted.length, skipped };
}
