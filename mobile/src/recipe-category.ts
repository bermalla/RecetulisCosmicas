import type { Recipe } from "./types";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export type RecipeCategoryOption = {
  value: string;
  label: string;
  count: number;
};

export function recipeCategoryOptions(recipes: Recipe[]): RecipeCategoryOption[] {
  const categories = new Map<string, RecipeCategoryOption>();
  for (const recipe of recipes) {
    const label = recipe.category?.trim();
    const key = normalize(label ?? "");
    if (!label || !key) continue;
    const existing = categories.get(key);
    if (existing) existing.count += 1;
    else categories.set(key, { value: key, label, count: 1 });
  }
  return [...categories.values()].sort((left, right) => left.label.localeCompare(right.label, "es"));
}

export function filterRecipesByCategory(recipes: Recipe[], category: string) {
  const selected = normalize(category);
  if (!selected) return recipes;
  return recipes.filter((recipe) => normalize(recipe.category ?? "") === selected);
}
