function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function distance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function proximity(query: string, candidate: string) {
  if (candidate === query) return 0;
  if (candidate.startsWith(query)) return 1 + (candidate.length - query.length) / 100;
  const wordIndex = candidate.split(" ").findIndex((word) => word.startsWith(query));
  if (wordIndex >= 0) return 2 + wordIndex / 10;
  const containedAt = candidate.indexOf(query);
  if (containedAt >= 0) return 3 + containedAt / 100;
  const editDistance = distance(query, candidate);
  const allowed = Math.max(1, Math.ceil(query.length * 0.4));
  return editDistance <= allowed ? 4 + editDistance / Math.max(query.length, candidate.length) : null;
}

export function rankSuggestions(query: string, candidates: string[], limit = 5) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  const unique = new Map<string, string>();
  for (const candidate of candidates) {
    const clean = candidate.trim();
    const key = normalize(clean);
    if (clean && key && !unique.has(key)) unique.set(key, clean);
  }
  return [...unique.entries()]
    .map(([key, label]) => ({ label, score: proximity(normalizedQuery, key) }))
    .filter((item): item is { label: string; score: number } => item.score !== null)
    .sort((left, right) => left.score - right.score || left.label.localeCompare(right.label, "es"))
    .slice(0, Math.max(0, limit))
    .map((item) => item.label);
}

function activeLine(text: string, cursor: number) {
  const start = text.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const nextBreak = text.indexOf("\n", cursor);
  const end = nextBreak < 0 ? text.length : nextBreak;
  return { start, end, value: text.slice(start, end) };
}

const INGREDIENT_PREFIX = /^(\s*(?:[-•]\s*)?(?:(?:\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?)\s*)?(?:(?:g|gr|gramos?|kg|kilos?|ml|mililitros?|l|litros?|tazas?|cucharadas?|cucharaditas?|cdas?|cdtas?|unidades?|pizcas?|paquetes?|latas?|dientes?|ramas?)\s+(?:de\s+)?)?)/i;

export function ingredientSuggestionQuery(text: string, cursor: number) {
  return activeLine(text, cursor).value.replace(INGREDIENT_PREFIX, "").trim();
}

export function rankIngredientSuggestions(text: string, cursor: number, candidates: string[], limit = 5) {
  const query = ingredientSuggestionQuery(text, cursor);
  if (!query) return [];
  const words = query.split(/\s+/).filter(Boolean);
  const queries = [query];
  if (words.length > 2) queries.push(words.slice(-2).join(" "));
  if (words.length > 1) queries.push(words.at(-1) ?? "");

  const suggestions: string[] = [];
  const seen = new Set<string>();
  for (const partial of queries) {
    for (const suggestion of rankSuggestions(partial, candidates, limit)) {
      const key = normalize(suggestion);
      if (!seen.has(key)) {
        seen.add(key);
        suggestions.push(suggestion);
      }
      if (suggestions.length >= limit) return suggestions;
    }
  }
  return suggestions;
}

export function replaceActiveIngredient(text: string, cursor: number, suggestion: string) {
  const line = activeLine(text, cursor);
  const prefix = line.value.match(INGREDIENT_PREFIX)?.[1] ?? "";
  const replacement = `${prefix}${suggestion}`;
  return {
    value: `${text.slice(0, line.start)}${replacement}${text.slice(line.end)}`,
    cursor: line.start + replacement.length,
  };
}
