import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { ensureSchema, getD1, getDb } from "../../../db";
import { recipeIngredients, recipes } from "../../../db/schema";
import {
  type AuthorizedActor,
  authErrorResponse,
  requireActor,
} from "../../../lib/firebase-auth-server";
import {
  mergeNutrients,
  normalizeRecipeCategory,
  partitionRecipeDuplicates,
  recipeNameKey,
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
  version?: number;
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
        .filter((ingredient): ingredient is NonNullable<typeof ingredient> => ingredient !== null)
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
}

function revisionPayload(recipe: CleanRecipe, actor: AuthorizedActor) {
  return JSON.stringify({
    ...recipe,
    groupId: actor.groupId,
    version: 1,
    createdBy: actor.id,
    updatedBy: actor.id,
  });
}

async function saveRecipe(recipe: CleanRecipe, actor: AuthorizedActor) {
  const d1 = await getD1();
  const now = new Date().toISOString();

  const statements = [
    d1
      .prepare(`
        INSERT INTO recipe_name_claims (group_id, normalized_name, recipe_id)
        VALUES (?, ?, ?)
      `)
      .bind(actor.groupId, recipeNameKey(recipe.name), recipe.id),
    d1
      .prepare(`
        INSERT INTO recipes (
          id, group_id, name, description, category, instructions, nutrients,
          duration_minutes, servings, image, source_url, version,
          created_by, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `)
      .bind(
        recipe.id,
        actor.groupId,
        recipe.name,
        recipe.description,
        recipe.category,
        JSON.stringify(recipe.instructions),
        JSON.stringify(recipe.nutrients),
        recipe.durationMinutes,
        recipe.servings,
        recipe.image,
        recipe.sourceUrl,
        actor.id,
        actor.id,
        now,
      ),
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
    d1
      .prepare(`
        INSERT INTO recipe_revisions (
          recipe_id, group_id, version, base_version, operation, payload, author_id, created_at
        ) VALUES (?, ?, 1, NULL, 'create', ?, ?, ?)
      `)
      .bind(recipe.id, actor.groupId, revisionPayload(recipe, actor), actor.id, now),
  ];
  await d1.batch(statements);
  return recipe.id;
}

async function readAllRecipes(groupId: string) {
  await ensureEmptyBaselineOnce();
  const db = await getDb();
  const [recipeRows, ingredientRows] = await Promise.all([
    db
      .select()
      .from(recipes)
      .where(and(eq(recipes.groupId, groupId), isNull(recipes.deletedAt)))
      .orderBy(desc(recipes.updatedAt), asc(recipes.name)),
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

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    return Response.json({ recipes: await readAllRecipes(actor.groupId) });
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request, ["owner", "editor"]);
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
    const existingRecipes = await readAllRecipes(actor.groupId);
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
    for (const recipe of recipesToSave) ids.push(await saveRecipe(recipe, actor));
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
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("unique constraint") || message.includes("constraint failed")) {
      return Response.json(
        {
          error: "No se guardó la receta porque otro usuario ya creó una con el mismo nombre o identificador.",
          code: "CONCURRENT_DUPLICATE",
        },
        { status: 409 },
      );
    }
    return errorResponse(error);
  }
}

type StoredRecipe = Awaited<ReturnType<typeof readAllRecipes>>[number];

async function softDeleteRecipe(recipe: StoredRecipe, actor: AuthorizedActor) {
  const d1 = await getD1();
  const now = new Date().toISOString();
  const currentVersion = Number(recipe.version ?? 1);
  const nextVersion = currentVersion + 1;
  await d1.batch([
    d1
      .prepare(`
        UPDATE recipes
        SET deleted_at = ?, version = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND group_id = ? AND version = ? AND deleted_at IS NULL
      `)
      .bind(now, nextVersion, actor.id, now, recipe.id, actor.groupId, currentVersion),
    d1
      .prepare("DELETE FROM recipe_name_claims WHERE group_id = ? AND recipe_id = ?")
      .bind(actor.groupId, recipe.id),
    d1
      .prepare(`
        INSERT INTO recipe_revisions (
          recipe_id, group_id, version, base_version, operation, payload, author_id, created_at
        ) VALUES (?, ?, ?, ?, 'delete', NULL, ?, ?)
      `)
      .bind(recipe.id, actor.groupId, nextVersion, currentVersion, actor.id, now),
  ]);
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("all") === "true") {
      const actor = await requireActor(request, ["owner"]);
      if (request.headers.get("x-confirm-delete-all") !== "BORRAR") {
        return Response.json({ error: "Falta la confirmación para vaciar la base." }, { status: 400 });
      }
      await ensureEmptyBaselineOnce();
      const existing = await readAllRecipes(actor.groupId);
      for (const recipe of existing) await softDeleteRecipe(recipe, actor);
      return Response.json({ deleted: existing.length });
    }

    const actor = await requireActor(request, ["owner", "editor"]);
    const id = url.searchParams.get("id");
    if (!id) return Response.json({ error: "Falta el id de la receta." }, { status: 400 });
    await ensureEmptyBaselineOnce();
    const existing = (await readAllRecipes(actor.groupId)).find((recipe) => recipe.id === id);
    if (!existing) return Response.json({ error: "La receta ya no existe." }, { status: 404 });
    await softDeleteRecipe(existing, actor);
    return Response.json({ deleted: id });
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(error);
  }
}

export { readAllRecipes };
