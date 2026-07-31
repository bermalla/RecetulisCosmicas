import { asc, desc, eq } from "drizzle-orm";
import { ensureSchema, getD1, getDb } from "../../../db";
import { appMeta, recipeIngredients, recipes } from "../../../db/schema";
import {
  mergeNutrients,
  normalizeRecipeCategory,
  partitionRecipeDuplicates,
  reviewRecipeDuplicates,
} from "../../../lib/recipe-intelligence";

type IngredientInput = {
  name?: string;
  normalizedName?: string;
  quantity?: string | number | null;
  unit?: string | null;
  optional?: boolean;
};

type RecipeInput = {
  id?: string;
  name?: string;
  description?: string;
  category?: string | null;
  instructions?: string[] | string;
  durationMinutes?: number | null;
  servings?: number | null;
  image?: string | null;
  sourceUrl?: string | null;
  nutrients?: string[];
  ingredients?: IngredientInput[];
};

function normalizeIngredient(value: string) {
  const cleaned = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const aliases: Record<string, string> = {
    papas: "papa",
    patata: "papa",
    patatas: "papa",
    huevos: "huevo",
    tomates: "tomate",
    cebollas: "cebolla",
    dientes_de_ajo: "ajo",
    ajos: "ajo",
    quesos: "queso",
  };
  return aliases[cleaned.replace(/\s/g, "_")] ?? cleaned;
}

function instructionsToArray(value: RecipeInput["instructions"]) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map(String).map((item) => item.trim()).filter(Boolean);
        }
      } catch {
        // If it is not valid JSON, continue with the pasted-text parser.
      }
    }
    return value
      .split(/\r?\n/)
      .map((item) => item.replace(/^\s*(?:\d+[.)-]?|[-•])\s*/, "").trim())
      .filter(Boolean);
  }
  return [];
}

function nutrientsToArray(value: RecipeInput["nutrients"] | string) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return [...new Set(parsed.map(String).map((item) => item.trim()).filter(Boolean))];
      }
    } catch {
      return value.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function cleanRecipe(input: RecipeInput, preserveId = false) {
  const name = String(input.name ?? "").trim();
  const ingredientsList = Array.isArray(input.ingredients)
    ? input.ingredients
        .map((ingredient) => {
          const ingredientName = String(ingredient.name ?? "").trim();
          if (!ingredientName) return null;
          return {
            name: ingredientName,
            normalizedName:
              String(ingredient.normalizedName ?? "").trim() ||
              normalizeIngredient(ingredientName),
            quantity:
              ingredient.quantity === null || ingredient.quantity === undefined
                ? null
                : String(ingredient.quantity).trim(),
            unit: ingredient.unit ? String(ingredient.unit).trim() : null,
            optional: Boolean(ingredient.optional),
          };
        })
        .filter(Boolean)
    : [];

  if (!name || ingredientsList.length === 0) {
    throw new Error("Cada receta necesita un nombre y al menos un ingrediente.");
  }

  return {
    id: preserveId && input.id ? String(input.id) : crypto.randomUUID(),
    name,
    description: String(input.description ?? "").trim(),
    category: normalizeRecipeCategory(input.category, name),
    instructions: instructionsToArray(input.instructions),
    nutrients: mergeNutrients(nutrientsToArray(input.nutrients ?? []), ingredientsList),
    durationMinutes:
      typeof input.durationMinutes === "number" && input.durationMinutes > 0
        ? Math.round(input.durationMinutes)
        : null,
    servings:
      typeof input.servings === "number" && input.servings > 0
        ? Math.round(input.servings)
        : null,
    image: input.image ? String(input.image) : null,
    sourceUrl: input.sourceUrl ? String(input.sourceUrl) : null,
    ingredients: ingredientsList as Array<{
      name: string;
      normalizedName: string;
      quantity: string | null;
      unit: string | null;
      optional: boolean;
    }>,
  };
}

type CleanRecipe = ReturnType<typeof cleanRecipe>;

async function ensureEmptyBaselineOnce() {
  await ensureSchema();
  const db = await getDb();
  const resetKey = "reset:empty-repository-baseline:v1";
  const reset = await db
    .select({ key: appMeta.key })
    .from(appMeta)
    .where(eq(appMeta.key, resetKey))
    .limit(1);
  if (reset.length > 0) return;

  await db.delete(recipes);
  await db
    .insert(appMeta)
    .values({
      key: resetKey,
      value: "La colección se inició vacía para la versión de repositorio.",
    })
    .onConflictDoNothing();
}

async function saveRecipe(recipe: CleanRecipe) {
  const d1 = await getD1();
  const now = new Date().toISOString();

  const statements = [
    d1
      .prepare(`
        INSERT INTO recipes (
          id, name, description, category, instructions, nutrients,
          duration_minutes, servings, image, source_url, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          category = excluded.category,
          instructions = excluded.instructions,
          nutrients = excluded.nutrients,
          duration_minutes = excluded.duration_minutes,
          servings = excluded.servings,
          image = excluded.image,
          source_url = excluded.source_url,
          updated_at = excluded.updated_at
      `)
      .bind(
        recipe.id,
        recipe.name,
        recipe.description,
        recipe.category,
        JSON.stringify(recipe.instructions),
        JSON.stringify(recipe.nutrients),
        recipe.durationMinutes,
        recipe.servings,
        recipe.image,
        recipe.sourceUrl,
        now,
      ),
    d1.prepare("DELETE FROM recipe_ingredients WHERE recipe_id = ?").bind(recipe.id),
    ...recipe.ingredients.map((ingredient, index) =>
      d1
        .prepare(`
          INSERT INTO recipe_ingredients (
            recipe_id, name, normalized_name, quantity, unit, optional, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          recipe.id,
          ingredient.name,
          ingredient.normalizedName,
          ingredient.quantity,
          ingredient.unit,
          ingredient.optional ? 1 : 0,
          index,
        ),
    ),
  ];
  await d1.batch(statements);
  return recipe.id;
}

async function readAllRecipes() {
  await ensureEmptyBaselineOnce();
  const db = await getDb();
  const [recipeRows, ingredientRows] = await Promise.all([
    db.select().from(recipes).orderBy(desc(recipes.updatedAt), asc(recipes.name)),
    db
      .select()
      .from(recipeIngredients)
      .orderBy(asc(recipeIngredients.recipeId), asc(recipeIngredients.sortOrder)),
  ]);

  const grouped = new Map<string, typeof ingredientRows>();
  for (const ingredient of ingredientRows) {
    const current = grouped.get(ingredient.recipeId) ?? [];
    current.push(ingredient);
    grouped.set(ingredient.recipeId, current);
  }

  return recipeRows.map((recipe) => {
    const ingredients = (grouped.get(recipe.id) ?? []).map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      normalizedName: ingredient.normalizedName,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      optional: ingredient.optional,
      sortOrder: ingredient.sortOrder,
    }));
    return {
      ...recipe,
      category: normalizeRecipeCategory(recipe.category, recipe.name),
      instructions: instructionsToArray(recipe.instructions),
      nutrients: mergeNutrients(nutrientsToArray(recipe.nutrients), ingredients),
      ingredients,
    };
  });
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Ocurrió un error inesperado.";
  const detail =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const combined = `${message}\n${detail}`;
  const friendly = combined.includes("no such table")
    ? "La base todavía no está preparada. Volvé a intentar en unos instantes."
    : message;
  return Response.json({ error: friendly }, { status: 500 });
}

export async function GET() {
  try {
    return Response.json({ recipes: await readAllRecipes() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      recipe?: RecipeInput;
      recipes?: RecipeInput[];
      preserveIds?: boolean;
      skipDuplicates?: boolean;
    };
    const list = payload.recipes ?? (payload.recipe ? [payload.recipe] : []);
    if (list.length === 0) {
      return Response.json({ error: "No se encontraron recetas para guardar." }, { status: 400 });
    }
    if (list.length > 500) {
      return Response.json({ error: "El archivo supera el máximo de 500 recetas." }, { status: 400 });
    }

    await ensureEmptyBaselineOnce();
    const cleanedRecipes = list.map((recipe) =>
      cleanRecipe(recipe, Boolean(payload.preserveIds)),
    );
    const existingRecipes = await readAllRecipes();
    let duplicates = reviewRecipeDuplicates(cleanedRecipes, existingRecipes);
    let recipesToSave = cleanedRecipes;

    if (payload.skipDuplicates) {
      const partition = partitionRecipeDuplicates(cleanedRecipes, existingRecipes);
      duplicates = partition.duplicates;
      recipesToSave = partition.accepted;
    }

    if (duplicates.length > 0 && !payload.skipDuplicates) {
      const names = [...new Set(duplicates.map((duplicate) => duplicate.incomingName))];
      const summary =
        names.length === 1
          ? `“${names[0]}” ya existe o está repetida en el archivo.`
          : `${names.length} recetas ya existen o están repetidas en el archivo: ${names.join(", ")}.`;
      return Response.json(
        {
          error: `No se guardó ninguna receta. ${summary}`,
          code: "DUPLICATE_RECIPES",
          duplicates,
        },
        { status: 409 },
      );
    }

    const ids: string[] = [];
    for (const recipe of recipesToSave) ids.push(await saveRecipe(recipe));
    return Response.json(
      {
        imported: ids.length,
        skipped: cleanedRecipes.length - recipesToSave.length,
        duplicates,
        ids,
        review: recipesToSave.map((recipe) => ({
          name: recipe.name,
          category: recipe.category,
          nutrients: recipe.nutrients,
        })),
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("all") === "true") {
      if (request.headers.get("x-confirm-delete-all") !== "BORRAR") {
        return Response.json({ error: "Falta la confirmación para vaciar la base." }, { status: 400 });
      }
      await ensureEmptyBaselineOnce();
      const db = await getDb();
      const existing = await db.select({ id: recipes.id }).from(recipes);
      const d1 = await getD1();
      await d1.batch([
        d1.prepare("DELETE FROM recipe_ingredients"),
        d1.prepare("DELETE FROM recipes"),
      ]);
      return Response.json({ deleted: existing.length });
    }

    const id = url.searchParams.get("id");
    if (!id) return Response.json({ error: "Falta el id de la receta." }, { status: 400 });
    await ensureEmptyBaselineOnce();
    const db = await getDb();
    await db.delete(recipes).where(eq(recipes.id, id));
    return Response.json({ deleted: id });
  } catch (error) {
    return errorResponse(error);
  }
}

export { readAllRecipes };
