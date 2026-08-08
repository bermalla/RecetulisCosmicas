import type { Ingredient, Recipe } from "./types";

const TOKEN_ALIASES: Record<string, string> = {
  ajies: "aji",
  lentejas: "lenteja",
  manies: "mani",
  nueces: "nuez",
};

const DERIVED_PRODUCT_TOKENS = new Set([
  "aceite", "almidon", "azucar", "bebida", "crema", "esencia", "extracto",
  "fecula", "harina", "jarabe", "leche", "manteca", "mantequilla", "pasta",
  "polvo", "proteina", "pure", "queso", "salsa", "sirope", "vinagre", "yogur",
]);

function singularize(token: string) {
  if (TOKEN_ALIASES[token]) return TOKEN_ALIASES[token];
  if (token.length > 4 && token.endsWith("ces")) return `${token.slice(0, -3)}z`;
  if (token.length > 3 && /[aeiou]s$/.test(token)) return token.slice(0, -1);
  if (token.length > 4 && /[^aeiou]es$/.test(token)) return token.slice(0, -2);
  return token;
}

function tokens(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(singularize);
}

function sequenceIndex(candidate: string[], query: string[]) {
  for (let index = 0; index <= candidate.length - query.length; index += 1) {
    if (query.every((token, offset) => candidate[index + offset] === token)) return index;
  }
  return -1;
}

export function ingredientMatchesPantry(ingredient: Ingredient, pantryItem: string) {
  const query = tokens(pantryItem);
  if (query.length === 0) return false;
  return [ingredient.normalizedName, ingredient.name]
    .filter((value): value is string => Boolean(value))
    .some((value) => {
      const candidate = tokens(value);
      const matchIndex = sequenceIndex(candidate, query);
      if (matchIndex < 0) return false;
      if (matchIndex === 0) return true;
      const connectorIndex = candidate.slice(0, matchIndex).lastIndexOf("de");
      if (connectorIndex < 0) return true;
      return !candidate.slice(0, connectorIndex).some((token) => DERIVED_PRODUCT_TOKENS.has(token));
    });
}

export function filterRecipesByPantry(recipes: Recipe[], pantry: string[]) {
  if (pantry.length === 0) return [...recipes];
  return recipes.filter((recipe) =>
    recipe.ingredients.some((ingredient) =>
      pantry.some((pantryItem) => ingredientMatchesPantry(ingredient, pantryItem)),
    ),
  );
}
