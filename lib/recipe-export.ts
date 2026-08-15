export const MAX_RECIPES_PER_EXPORT = 500;

export type RecipeExportPayload<T> = Record<string, unknown> & {
  recipes: T[];
  exportPart?: number;
  exportParts?: number;
  totalRecipes?: number;
};

export function createRecipeExportParts<T>(
  payload: RecipeExportPayload<T>,
  limit = MAX_RECIPES_PER_EXPORT,
): RecipeExportPayload<T>[] {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("El límite de exportación no es válido.");
  const totalRecipes = payload.recipes.length;
  const exportParts = Math.max(1, Math.ceil(totalRecipes / limit));
  return Array.from({ length: exportParts }, (_, index) => ({
    ...payload,
    exportPart: index + 1,
    exportParts,
    totalRecipes,
    recipes: payload.recipes.slice(index * limit, (index + 1) * limit),
  }));
}

export function recipeExportFilename(
  prefix: string,
  date: string,
  exportPart: number,
  exportParts: number,
) {
  const suffix = exportParts > 1 ? `-parte-${exportPart}-de-${exportParts}` : "";
  return `${prefix}-${date}${suffix}.json`;
}

function exportPayload(value: unknown): RecipeExportPayload<unknown> {
  if (!value || typeof value !== "object" || !Array.isArray((value as { recipes?: unknown }).recipes)) {
    throw new Error("El respaldo generado no contiene una lista de recetas.");
  }
  return value as RecipeExportPayload<unknown>;
}

export async function fetchRecipeExportParts(
  fetchPart: (part: number) => Promise<Response>,
) {
  const firstResponse = await fetchPart(1);
  if (!firstResponse.ok) throw new Error("No se pudo generar el respaldo online.");
  const first = exportPayload(await firstResponse.json());
  const totalParts = Number(first.exportParts ?? 1);
  if (!Number.isInteger(totalParts) || totalParts < 1 || totalParts > 10_000) {
    throw new Error("El respaldo generado tiene una cantidad de partes inválida.");
  }
  const parts = [first];
  for (let part = 2; part <= totalParts; part += 1) {
    const response = await fetchPart(part);
    if (!response.ok) throw new Error(`No se pudo generar la parte ${part} del respaldo.`);
    const payload = exportPayload(await response.json());
    if (payload.exportPart !== part || payload.exportParts !== totalParts) {
      throw new Error("Las partes del respaldo no coinciden entre sí.");
    }
    parts.push(payload);
  }
  return parts;
}

export function downloadRecipeExportParts(
  parts: RecipeExportPayload<unknown>[],
  prefix: string,
  date = new Date().toISOString().slice(0, 10),
) {
  parts.forEach((payload, index) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = recipeExportFilename(prefix, date, index + 1, parts.length);
    link.click();
    URL.revokeObjectURL(href);
  });
  return parts.length;
}
