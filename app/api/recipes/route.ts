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
  favorite?: boolean;
  nutrients?: string[];
  ingredients?: IngredientInput[];
};

class RecipeInputError extends Error {}

function boundedText(value: unknown, label: string, maximum: number) {
  const text = String(value ?? "").trim();
  if (text.length > maximum) {
    throw new RecipeInputError(`${label} supera el máximo de ${maximum} caracteres.`);
  }
  return text;
}

function optionalHttpUrl(value: unknown, label: string) {
  const text = boundedText(value, label, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.toString();
  } catch {
    throw new RecipeInputError(`${label} debe ser una dirección web http o https válida.`);
  }
}

function assertRequestSize(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 2_000_000) {
    throw new RecipeInputError("El archivo supera el máximo permitido de 2 MB.");
  }
}

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
  const name = boundedText(input.name, "El nombre", 180);
  if (Array.isArray(input.ingredients) && input.ingredients.length > 300) {
    throw new RecipeInputError("Una receta no puede superar los 300 ingredientes.");
  }
  const ingredientsList = Array.isArray(input.ingredients)
    ? input.ingredients
        .map((ingredient) => {
          const ingredientName = boundedText(ingredient.name, "El ingrediente", 250);
          if (!ingredientName) return null;
          return {
            name: ingredientName,
            normalizedName:
              String(ingredient.normalizedName ?? "").trim() ||
              normalizeIngredient(ingredientName),
            quantity:
              ingredient.quantity === null || ingredient.quantity === undefined
                ? null
                : boundedText(ingredient.quantity, "La cantidad", 100),
            unit: ingredient.unit ? boundedText(ingredient.unit, "La unidad", 100) : null,
            optional: Boolean(ingredient.optional),
          };
        })
        .filter((ingredient): ingredient is NonNullable<typeof ingredient> => ingredient !== null)
    : [];

  if (!name || ingredientsList.length === 0) {
    throw new RecipeInputError("Cada receta necesita un nombre y al menos un ingrediente.");
  }

  const instructions = instructionsToArray(input.instructions);
  if (instructions.length > 500 || instructions.some((item) => item.length > 5000)) {
    throw new RecipeInputError("Las instrucciones superan el tamaño permitido.");
  }
  const nutrients = nutrientsToArray(input.nutrients ?? []);
  if (nutrients.length > 100 || nutrients.some((item) => item.length > 120)) {
    throw new RecipeInputError("La lista de nutrientes supera el tamaño permitido.");
  }

  return {
    id: preserveId && input.id ? String(input.id) : crypto.randomUUID(),
    name,
    description: boundedText(input.description, "La descripción", 10000),
    category: normalizeRecipeCategory(input.category, name),
    instructions,
    nutrients: mergeNutrients(nutrients, ingredientsList),
    durationMinutes:
      typeof input.durationMinutes === "number" && input.durationMinutes > 0
        ? Math.round(input.durationMinutes)
        : null,
    servings:
      typeof input.servings === "number" && input.servings > 0
        ? Math.round(input.servings)
        : null,
    image: input.image ? optionalHttpUrl(input.image, "La imagen") : null,
    sourceUrl: input.sourceUrl ? optionalHttpUrl(input.sourceUrl, "La fuente") : null,
    favorite: Boolean(input.favorite),
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
          duration_minutes, servings, image, source_url, favorite, version,
          created_by, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
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
        recipe.favorite ? 1 : 0,
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
  if (error instanceof RecipeInputError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
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
    assertRequestSize(request);
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

async function updateRecipe(
  input: RecipeInput,
  actor: AuthorizedActor,
  baseVersion: number,
) {
  const id = String(input.id ?? "").trim();
  if (!id) throw new RecipeInputError("Falta el id de la receta.");
  const current = (await readAllRecipes(actor.groupId)).find((recipe) => recipe.id === id);
  if (!current) return { status: "missing" as const };
  const currentVersion = Number(current.version ?? 1);
  if (baseVersion !== currentVersion) return { status: "conflict" as const };

  const recipe = cleanRecipe({ ...input, id }, true);
  const nextVersion = currentVersion + 1;
  const now = new Date().toISOString();
  const payload = JSON.stringify({
    ...recipe,
    groupId: actor.groupId,
    version: nextVersion,
    createdBy: current.createdBy,
    updatedBy: actor.id,
    createdAt: current.createdAt,
    updatedAt: now,
  });
  const d1 = await getD1();
  const statements = [
    d1
      .prepare(`
        UPDATE recipes
        SET name = ?, description = ?, category = ?, instructions = ?, nutrients = ?,
            duration_minutes = ?, servings = ?, image = ?, source_url = ?, favorite = ?,
            version = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND group_id = ? AND version = ? AND deleted_at IS NULL
      `)
      .bind(
        recipe.name,
        recipe.description,
        recipe.category,
        JSON.stringify(recipe.instructions),
        JSON.stringify(recipe.nutrients),
        recipe.durationMinutes,
        recipe.servings,
        recipe.image,
        recipe.sourceUrl,
        recipe.favorite ? 1 : 0,
        nextVersion,
        actor.id,
        now,
        id,
        actor.groupId,
        currentVersion,
      ),
    d1
      .prepare(`
        DELETE FROM recipe_name_claims
        WHERE group_id = ? AND recipe_id = ?
          AND EXISTS (
            SELECT 1 FROM recipes
            WHERE id = ? AND group_id = ? AND version = ? AND updated_by = ? AND updated_at = ?
          )
      `)
      .bind(actor.groupId, id, id, actor.groupId, nextVersion, actor.id, now),
    d1
      .prepare(`
        INSERT INTO recipe_name_claims (group_id, normalized_name, recipe_id)
        SELECT ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM recipes
          WHERE id = ? AND group_id = ? AND version = ? AND updated_by = ? AND updated_at = ?
        )
      `)
      .bind(
        actor.groupId,
        recipeNameKey(recipe.name),
        id,
        id,
        actor.groupId,
        nextVersion,
        actor.id,
        now,
      ),
    d1
      .prepare(`
        DELETE FROM recipe_ingredients
        WHERE recipe_id = ?
          AND EXISTS (
            SELECT 1 FROM recipes
            WHERE id = ? AND group_id = ? AND version = ? AND updated_by = ? AND updated_at = ?
          )
      `)
      .bind(id, id, actor.groupId, nextVersion, actor.id, now),
    ...recipe.ingredients.map((ingredient, index) =>
      d1
        .prepare(`
          INSERT INTO recipe_ingredients (
            recipe_id, name, normalized_name, quantity, unit, optional, sort_order
          )
          SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM recipes
            WHERE id = ? AND group_id = ? AND version = ? AND updated_by = ? AND updated_at = ?
          )
        `)
        .bind(
          id,
          ingredient.name,
          ingredient.normalizedName,
          ingredient.quantity,
          ingredient.unit,
          ingredient.optional ? 1 : 0,
          index,
          id,
          actor.groupId,
          nextVersion,
          actor.id,
          now,
        ),
    ),
    d1
      .prepare(`
        INSERT INTO recipe_revisions (
          recipe_id, group_id, version, base_version, operation, payload, author_id, created_at
        )
        SELECT ?, ?, ?, ?, 'update', ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM recipes
          WHERE id = ? AND group_id = ? AND version = ? AND updated_by = ? AND updated_at = ?
        )
      `)
      .bind(
        id,
        actor.groupId,
        nextVersion,
        currentVersion,
        payload,
        actor.id,
        now,
        id,
        actor.groupId,
        nextVersion,
        actor.id,
        now,
      ),
  ];
  const results = await d1.batch(statements);
  const changed = Number(results[0]?.meta?.changes ?? 0);
  return changed > 0
    ? { status: "updated" as const, recipe: JSON.parse(payload) }
    : { status: "conflict" as const };
}

export async function PUT(request: Request) {
  try {
    const actor = await requireActor(request, ["owner", "editor"]);
    assertRequestSize(request);
    await ensureEmptyBaselineOnce();
    const payload = (await request.json()) as { recipe?: RecipeInput; baseVersion?: number };
    if (!payload.recipe) {
      return Response.json({ error: "Falta la receta para actualizar." }, { status: 400 });
    }
    const baseVersion = Number(payload.baseVersion);
    if (!Number.isInteger(baseVersion) || baseVersion < 1) {
      return Response.json({ error: "Falta la versión original de la receta." }, { status: 400 });
    }
    const result = await updateRecipe(payload.recipe, actor, baseVersion);
    if (result.status === "missing") {
      return Response.json({ error: "La receta ya no existe." }, { status: 404 });
    }
    if (result.status === "conflict") {
      return Response.json(
        { error: "Otra persona modificó esta receta. Actualizá la base y volvé a editarla." },
        { status: 409 },
      );
    }
    return Response.json({ recipe: result.recipe });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("unique constraint") || message.includes("constraint failed")) {
      return Response.json(
        { error: "Ya existe otra receta con ese nombre." },
        { status: 409 },
      );
    }
    return errorResponse(error);
  }
}

async function softDeleteRecipe(recipe: StoredRecipe, actor: AuthorizedActor) {
  const d1 = await getD1();
  const now = new Date().toISOString();
  const currentVersion = Number(recipe.version ?? 1);
  const nextVersion = currentVersion + 1;
  const results = await d1.batch([
    d1
      .prepare(`
        UPDATE recipes
        SET deleted_at = ?, version = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND group_id = ? AND version = ? AND deleted_at IS NULL
      `)
      .bind(now, nextVersion, actor.id, now, recipe.id, actor.groupId, currentVersion),
    d1
      .prepare(`
        DELETE FROM recipe_name_claims
        WHERE group_id = ? AND recipe_id = ?
          AND EXISTS (
            SELECT 1 FROM recipes
            WHERE id = ? AND group_id = ? AND version = ? AND deleted_at = ?
          )
      `)
      .bind(actor.groupId, recipe.id, recipe.id, actor.groupId, nextVersion, now),
    d1
      .prepare(`
        INSERT INTO recipe_revisions (
          recipe_id, group_id, version, base_version, operation, payload, author_id, created_at
        )
        SELECT ?, ?, ?, ?, 'delete', NULL, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM recipes
          WHERE id = ? AND group_id = ? AND version = ? AND deleted_at = ?
        )
      `)
      .bind(
        recipe.id,
        actor.groupId,
        nextVersion,
        currentVersion,
        actor.id,
        now,
        recipe.id,
        actor.groupId,
        nextVersion,
        now,
      ),
  ]);
  return Number(results[0]?.meta?.changes ?? 0) > 0;
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
    const requestedVersion = Number(url.searchParams.get("version"));
    if (Number.isInteger(requestedVersion) && requestedVersion > 0 && requestedVersion !== Number(existing.version ?? 1)) {
      return Response.json(
        { error: "Otra persona modificó esta receta. Actualizá la base antes de borrarla." },
        { status: 409 },
      );
    }
    const deleted = await softDeleteRecipe(existing, actor);
    if (!deleted) {
      return Response.json(
        { error: "Otra persona modificó esta receta. Actualizá la base antes de borrarla." },
        { status: 409 },
      );
    }
    return Response.json({ deleted: id });
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(error);
  }
}

export { readAllRecipes };
