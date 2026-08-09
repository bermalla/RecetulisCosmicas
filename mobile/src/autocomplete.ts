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

type IngredientCandidate = {
  key: string;
  label: string;
  frequency: number;
  words: number;
};

function baseIngredient(value: string) {
  const clean = value
    .trim()
    .replace(/^[-•]\s*/, "")
    .split(/\s*(?:,|;|\s+y\s+|\s+o\s+)\s*/iu)[0]
    ?.trim() ?? "";
  return clean.split(/\s+/u)[0] ?? "";
}

function ingredientCatalog(candidates: string[]) {
  const catalog = new Map<string, IngredientCandidate>();
  const add = (label: string) => {
    const clean = label.trim();
    const key = normalize(clean);
    if (!clean || !key) return;
    const existing = catalog.get(key);
    if (existing) {
      existing.frequency += 1;
      return;
    }
    catalog.set(key, {
      key,
      label: clean,
      frequency: 1,
      words: key.split(" ").length,
    });
  };

  for (const candidate of candidates) {
    const clean = candidate.trim();
    if (!clean) continue;
    add(clean);
    const base = baseIngredient(clean);
    if (normalize(base) !== normalize(clean)) add(base);
  }
  return [...catalog.values()];
}

function ingredientProximity(query: string, candidate: string) {
  if (candidate === query) return { tier: 0, detail: 0 };
  if (candidate.startsWith(query)) return { tier: 1, detail: 0 };
  const words = candidate.split(" ");
  const wordIndex = words.findIndex((word) => word.startsWith(query));
  if (wordIndex >= 0) return { tier: 2, detail: wordIndex };
  const containedAt = candidate.indexOf(query);
  if (containedAt >= 0) return { tier: 3, detail: containedAt };

  const closest = [candidate, ...words]
    .map((word) => ({ distance: distance(query, word), length: word.length }))
    .sort((left, right) => left.distance - right.distance || left.length - right.length)[0];
  const allowed = Math.max(1, Math.ceil(query.length * 0.35));
  return closest.distance <= allowed
    ? { tier: 4, detail: closest.distance / Math.max(query.length, closest.length) }
    : null;
}

function rankIngredientQuery(query: string, candidates: IngredientCandidate[], limit: number) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  return candidates
    .map((candidate) => ({ candidate, match: ingredientProximity(normalizedQuery, candidate.key) }))
    .filter((item): item is { candidate: IngredientCandidate; match: { tier: number; detail: number } } => item.match !== null)
    .sort((left, right) =>
      left.match.tier - right.match.tier ||
      right.candidate.frequency - left.candidate.frequency ||
      left.candidate.words - right.candidate.words ||
      left.match.detail - right.match.detail ||
      left.candidate.key.length - right.candidate.key.length ||
      left.candidate.label.localeCompare(right.candidate.label, "es")
    )
    .slice(0, Math.max(0, limit))
    .map((item) => item.candidate.label);
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
  const catalog = ingredientCatalog(candidates);
  const words = query.split(/\s+/).filter(Boolean);
  const queries = [query];
  if (words.length > 2) queries.push(words.slice(-2).join(" "));
  if (words.length > 1) queries.push(words.at(-1) ?? "");

  const suggestions: string[] = [];
  const seen = new Set<string>();
  for (const partial of queries) {
    for (const suggestion of rankIngredientQuery(partial, catalog, limit)) {
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
