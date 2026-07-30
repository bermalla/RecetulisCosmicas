export type IngredientReference = {
  name: string;
  normalizedName?: string;
  quantity?: string | number | null;
  unit?: string | null;
  optional?: boolean;
};

export type RecipeIdentity = {
  id?: string;
  name: string;
  instructions?: string[] | string;
  ingredients: IngredientReference[];
};

export const RECIPE_CATEGORIES = [
  "Buñuelos",
  "Tortilla",
  "Ensalada",
  "Galletas",
  "Torta",
  "Tarta",
  "Pan",
  "Pizza",
  "Croquetas",
  "Medallones",
  "Milanesa",
  "Pasta",
  "Sopa",
  "Postre",
  "Untable",
  "Bebida",
  "Desayuno",
  "Panqueques",
  "Snack",
  "Conserva",
  "Preparación base",
  "Salteado",
  "Plato principal",
] as const;

export type RecipeCategory = (typeof RECIPE_CATEGORIES)[number];

const CATEGORY_RULES: Array<{
  category: RecipeCategory;
  terms: string[];
}> = [
  { category: "Buñuelos", terms: ["bunuelo", "bunuelos"] },
  { category: "Tortilla", terms: ["tortilla", "notortilla", "faina", "dosa"] },
  { category: "Ensalada", terms: ["ensalada"] },
  { category: "Galletas", terms: ["galleta", "galletita", "pepa", "coquito"] },
  {
    category: "Torta",
    terms: [
      "torta", "bizcochuelo", "brownie", "budin", "muffin", "muffins", "carrot cake",
      "white nie", "white-nie",
    ],
  },
  { category: "Tarta", terms: ["tarta", "pie", "pasta frola", "crumble"] },
  {
    category: "Pan",
    terms: [
      "pan ", "pan de", "pan integral", "pancito", "scone", "noscones", "roll",
      "rolls",
    ],
  },
  { category: "Pizza", terms: ["pizza", "calzone"] },
  { category: "Croquetas", terms: ["croqueta", "croquetas"] },
  { category: "Medallones", terms: ["medallon", "medallones", "hamburguesa"] },
  { category: "Milanesa", terms: ["milanesa", "milanesas"] },
  { category: "Pasta", terms: ["noqui", "noquis", "pasta", "fideo"] },
  { category: "Sopa", terms: ["sopa", "crema de"] },
  {
    category: "Postre",
    terms: [
      "postre", "helado", "trufa", "turron", "alfajor", "alfajorcito",
      "gomita", "flan", "mantecol", "trifle", "alfarogel", "gulita",
    ],
  },
  {
    category: "Untable",
    terms: [
      "untable", "queso", "yogur", "tofudelfia", "mandiocadelphia",
      "mantenocol", "picadillo",
    ],
  },
  { category: "Bebida", terms: ["licuado", "batido", "smoothie", "jugo"] },
  {
    category: "Desayuno",
    terms: ["granola", "barra de cereal", "barras de cereal", "mezcla horneada"],
  },
  { category: "Panqueques", terms: ["panqueque"] },
  { category: "Snack", terms: ["snack", "snacks", "bocadito", "bombita"] },
  { category: "Conserva", terms: ["encurtido", "conserva"] },
  {
    category: "Preparación base",
    terms: ["masa de", "mezcla para", "base de", "ralladito"],
  },
  {
    category: "Salteado",
    terms: ["salteado", "a la plancha", "tofu revuelto", "hongo"],
  },
];

export function inferRecipeCategory(name: string): RecipeCategory {
  const normalizedName = normalizeIngredientSearch(name);
  return (
    CATEGORY_RULES.find((rule) =>
      rule.terms.some((term) => {
        const normalizedTerm = normalizeIngredientSearch(term);
        return ` ${normalizedName} `.includes(` ${normalizedTerm} `);
      }),
    )?.category ?? "Plato principal"
  );
}

export function normalizeRecipeCategory(
  category: string | null | undefined,
  recipeName: string,
): RecipeCategory {
  const normalizedCategory = normalizeReference(String(category ?? ""));
  const existing = RECIPE_CATEGORIES.find(
    (item) => normalizeReference(item) === normalizedCategory,
  );
  return existing ?? inferRecipeCategory(recipeName);
}

export function recipeCategoryIcon(category: string) {
  const icons: Record<RecipeCategory, string> = {
    "Buñuelos": "🫓",
    "Tortilla": "🍳",
    "Ensalada": "🥗",
    "Galletas": "🍪",
    "Torta": "🍰",
    "Tarta": "🥧",
    "Pan": "🥖",
    "Pizza": "🍕",
    "Croquetas": "🟤",
    "Medallones": "🥙",
    "Milanesa": "🍽️",
    "Pasta": "🍝",
    "Sopa": "🍲",
    "Postre": "🍨",
    "Untable": "🥣",
    "Bebida": "🥤",
    "Desayuno": "🌾",
    "Panqueques": "🥞",
    "Snack": "🥜",
    "Conserva": "🫙",
    "Preparación base": "🧺",
    "Salteado": "🍳",
    "Plato principal": "🍽️",
  };
  return icons[normalizeRecipeCategory(category, "")];
}

export const REFERENCE_NUTRIENTS = [
  "Zinc",
  "Selenio",
  "Ácido fólico",
  "Vitamina C",
  "Vitamina E",
  "Coenzima Q10",
  "Yodo",
  "Vitamina D",
  "Hierro",
  "Omega 3",
] as const;

type ReferenceNutrient = (typeof REFERENCE_NUTRIENTS)[number];

// Reglas deliberadamente conservadoras. Indican presencia habitual, no cantidad,
// biodisponibilidad ni adecuación nutricional.
const NUTRIENT_RULES: Array<{
  nutrient: ReferenceNutrient;
  terms: string[];
  excludeTerms?: string[];
}> = [
  {
    nutrient: "Zinc",
    terms: [
      "lenteja", "lentejas", "garbanzo", "garbanzos", "poroto", "porotos",
      "alubia", "alubias", "frijol", "frijoles", "tofu", "soja", "soya",
      "avena", "quinoa", "mani", "cacahuate", "semillas de calabaza",
      "pepitas", "sesamo", "semillas de sesamo", "castanas de caju",
      "castana de caju", "anacardo", "anacardos", "queso", "huevo", "huevos",
    ],
  },
  {
    nutrient: "Selenio",
    terms: [
      "nuez de brasil", "nueces de brasil", "castana de para", "castanas de para",
      "huevo", "huevos", "leche", "yogur", "yogurt", "queso", "avena",
      "arroz integral", "harina integral", "pan integral", "cereal integral",
      "cereales integrales", "semillas de girasol",
    ],
    excludeTerms: [
      "leche vegetal", "leche de soja", "leche de soya", "leche de almendras",
      "leche de avena", "yogur vegetal", "yogurt vegetal", "queso vegetal",
      "queso vegano",
    ],
  },
  {
    nutrient: "Ácido fólico",
    terms: [
      "lenteja", "lentejas", "garbanzo", "garbanzos", "poroto", "porotos",
      "alubia", "alubias", "frijol", "frijoles", "arveja", "arvejas",
      "espinaca", "acelga", "esparrago", "esparragos", "brocoli",
      "repollitos de bruselas", "palta", "aguacate", "remolacha",
      "naranja", "mandarina", "mani", "cacahuate",
    ],
  },
  {
    nutrient: "Vitamina C",
    terms: [
      "naranja", "mandarina", "pomelo", "limon", "lima", "kiwi", "frutilla",
      "frutillas", "fresa", "fresas", "pimiento rojo", "pimiento verde",
      "morron", "brocoli", "tomate", "tomates", "repollo", "papa", "papas",
      "batata", "guayaba", "papaya",
    ],
  },
  {
    nutrient: "Vitamina E",
    terms: [
      "semillas de girasol", "aceite de girasol", "almendra", "almendras",
      "avellana", "avellanas", "mani", "cacahuate", "mantequilla de mani",
      "aceite de germen de trigo", "aceite de cartamo", "aceite de soja",
      "aceite de canola", "palta", "aguacate", "espinaca", "brocoli",
    ],
  },
  {
    nutrient: "Coenzima Q10",
    terms: [
      "mani", "cacahuate", "mantequilla de mani", "pistacho", "pistachos",
      "nueces", "avellana", "avellanas", "almendra", "almendras", "sesamo",
      "semillas de sesamo", "aceite de soja", "aceite de canola",
    ],
  },
  {
    nutrient: "Yodo",
    terms: [
      "sal yodada", "alga", "algas", "nori", "kombu", "wakame", "kelp",
      "huevo", "huevos", "leche", "yogur", "yogurt", "queso",
    ],
    excludeTerms: [
      "leche vegetal", "leche de soja", "leche de soya", "leche de almendras",
      "leche de avena", "yogur vegetal", "yogurt vegetal", "queso vegetal",
      "queso vegano",
    ],
  },
  {
    nutrient: "Vitamina D",
    terms: [
      "huevo", "huevos", "yema de huevo", "yemas de huevo",
      "leche fortificada", "bebida vegetal fortificada",
      "bebida de soja fortificada", "bebida de almendras fortificada",
      "bebida de avena fortificada", "cereal fortificado", "cereales fortificados",
      "hongos uv", "hongos expuestos a luz uv", "champinones uv",
    ],
  },
  {
    nutrient: "Hierro",
    terms: [
      "lenteja", "lentejas", "garbanzo", "garbanzos", "poroto", "porotos",
      "alubia", "alubias", "frijol", "frijoles", "arveja", "arvejas",
      "tofu", "soja", "soya", "espinaca", "acelga", "semillas de calabaza",
      "pepitas", "sesamo", "semillas de sesamo", "quinoa", "avena",
      "pasas de uva", "damascos secos", "ciruelas secas",
    ],
  },
  {
    nutrient: "Omega 3",
    terms: [
      "semillas de lino", "lino molido", "linaza", "aceite de lino",
      "semillas de chia", "chia", "nueces", "nuez de nogal", "semillas de canamo",
      "canamo", "aceite de canola", "aceite de soja", "soja", "soya",
    ],
  },
];

export function normalizeReference(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const INGREDIENT_TOKEN_ALIASES: Record<string, string> = {
  ajies: "aji",
  manies: "mani",
  patata: "papa",
  patatas: "papa",
};

const INVARIANT_SINGULAR_TOKENS = new Set([
  "anis",
  "couscous",
  "gris",
  "hummus",
  "seis",
  "tres",
]);

const LEADING_MEASUREMENT_TOKENS = new Set([
  "a",
  "aproximadamente",
  "cc",
  "cucharada",
  "cucharadita",
  "de",
  "del",
  "diente",
  "g",
  "gramo",
  "gr",
  "hoja",
  "kg",
  "kilo",
  "l",
  "lata",
  "litro",
  "medio",
  "media",
  "mg",
  "ml",
  "paquete",
  "punado",
  "rama",
  "rodaja",
  "taza",
  "un",
  "una",
  "uno",
  "unidad",
]);

function singularizeIngredientToken(token: string) {
  const alias = INGREDIENT_TOKEN_ALIASES[token];
  if (alias) return alias;
  if (INVARIANT_SINGULAR_TOKENS.has(token)) return token;
  if (token.length > 4 && token.endsWith("ces")) {
    return `${token.slice(0, -3)}z`;
  }
  if (token.length > 3 && /[aeiou]s$/.test(token)) {
    return token.slice(0, -1);
  }
  if (token.length > 4 && /[^aeiou]es$/.test(token)) {
    return token.slice(0, -2);
  }
  return token;
}

function ingredientTokens(value: string) {
  return normalizeReference(value)
    .split(" ")
    .filter(Boolean)
    .map(singularizeIngredientToken);
}

function stripLeadingMeasurements(tokens: string[]) {
  let index = 0;
  while (
    index < tokens.length &&
    (/^\d+$/.test(tokens[index]) || LEADING_MEASUREMENT_TOKENS.has(tokens[index]))
  ) {
    index += 1;
  }
  return tokens.slice(index);
}

export function normalizeIngredientSearch(value: string) {
  return ingredientTokens(value).join(" ");
}

function startsWithTokens(candidate: string[], query: string[]) {
  return (
    query.length > 0 &&
    query.length <= candidate.length &&
    query.every((token, index) => candidate[index] === token)
  );
}

/**
 * Deriva claves de búsqueda desde el nombre visible del ingrediente. Así,
 * "1/2 taza de coco rallado" responde a "coco" sin confundir palabras
 * parciales ni tratar "aceite de coco" como si fuera coco rallado.
 */
export function ingredientMatchesQuery(
  ingredient: IngredientReference,
  query: string,
) {
  const queryTokens = stripLeadingMeasurements(ingredientTokens(query));
  if (queryTokens.length === 0) return false;

  const candidates = [ingredient.normalizedName, ingredient.name]
    .filter((value): value is string => Boolean(value))
    .map((value) => stripLeadingMeasurements(ingredientTokens(value)));

  return candidates.some((candidate) => {
    if (startsWithTokens(candidate, queryTokens)) return true;

    const segments: string[][] = [[]];
    for (const token of candidate) {
      if (token === "y" || token === "o") {
        segments.push([]);
      } else {
        segments[segments.length - 1].push(token);
      }
    }
    return segments.some((segment) => startsWithTokens(segment, queryTokens));
  });
}

const BASE_INGREDIENT_LABELS: Record<string, string> = {
  aji: "ají",
  brocoli: "brócoli",
  limon: "limón",
  maiz: "maíz",
  mani: "maní",
  melon: "melón",
  platano: "plátano",
};

function baseIngredientFromPhrase(value: string) {
  const tokens = stripLeadingMeasurements(ingredientTokens(value));
  const base = tokens[0];
  return base ? BASE_INGREDIENT_LABELS[base] ?? base : "";
}

/**
 * Produce sugerencias breves y singulares desde textos libres. Por ejemplo,
 * "una banana chica", "bananas pisadas" y "banana madura" sugieren "banana".
 */
export function ingredientBaseSuggestions(ingredient: IngredientReference) {
  const sources = [ingredient.normalizedName, ingredient.name].filter(
    (value): value is string => Boolean(value),
  );
  const bases = sources.flatMap((source) =>
    source
      .split(/\s*(?:,|;|\s+y\s+|\s+o\s+)\s*/iu)
      .map(baseIngredientFromPhrase)
      .filter(Boolean),
  );
  return [...new Map(bases.map((base) => [normalizeReference(base), base])).values()];
}

export const ASSUMED_PANTRY_STAPLES = [
  "Agua",
  "Sal",
  "Azúcar",
  "Pimienta",
  "Aceite neutro",
] as const;

export function isAssumedPantryIngredient(ingredient: IngredientReference) {
  const candidates = [ingredient.normalizedName, ingredient.name]
    .filter((value): value is string => Boolean(value))
    .map((value) => stripLeadingMeasurements(ingredientTokens(value)));

  return candidates.some((tokens) => {
    const [base, modifier] = tokens;
    if (base === "agua" || base === "sal" || base === "azucar" || base === "pimienta") {
      return true;
    }
    return (
      base === "aceite" &&
      (!modifier || modifier === "neutro" || modifier === "vegetal")
    );
  });
}

export function filterRecipesByIngredientMatches<
  RecipeWithMatches extends { matched: unknown[] },
>(recipes: RecipeWithMatches[], hasActiveFilter: boolean) {
  return hasActiveFilter
    ? recipes.filter((recipe) => recipe.matched.length > 0)
    : recipes;
}

function containsTerm(value: string, term: string) {
  const normalizedValue = ` ${normalizeReference(value)} `;
  const normalizedTerm = ` ${normalizeReference(term)} `;
  return normalizedValue.includes(normalizedTerm);
}

export function inferNutrients(ingredients: IngredientReference[]) {
  const requiredIngredients = ingredients.filter((ingredient) => !ingredient.optional);
  return NUTRIENT_RULES
    .filter((rule) =>
      requiredIngredients.some((ingredient) => {
        if (
          rule.excludeTerms?.some((term) => containsTerm(ingredient.name, term))
        ) {
          return false;
        }
        return rule.terms.some((term) => containsTerm(ingredient.name, term));
      }),
    )
    .map((rule) => rule.nutrient);
}

function canonicalNutrient(value: string) {
  const key = normalizeReference(value).replace(/\s+/g, " ");
  const aliases: Record<string, ReferenceNutrient> = {
    zinc: "Zinc",
    selenio: "Selenio",
    folato: "Ácido fólico",
    "acido folico": "Ácido fólico",
    "vitamina c": "Vitamina C",
    "vitamina e": "Vitamina E",
    "coenzima q10": "Coenzima Q10",
    coq10: "Coenzima Q10",
    yodo: "Yodo",
    "vitamina d": "Vitamina D",
    hierro: "Hierro",
    "omega 3": "Omega 3",
    omega3: "Omega 3",
  };
  return aliases[key] ?? value.trim();
}

export function mergeNutrients(
  explicitNutrients: string[],
  ingredients: IngredientReference[],
) {
  const values = [
    ...inferNutrients(ingredients),
    ...explicitNutrients.map(canonicalNutrient),
  ].filter(Boolean);
  const unique = new Map(values.map((nutrient) => [normalizeReference(nutrient), nutrient]));
  return [...unique.values()].sort((a, b) => {
    const aIndex = REFERENCE_NUTRIENTS.indexOf(a as ReferenceNutrient);
    const bIndex = REFERENCE_NUTRIENTS.indexOf(b as ReferenceNutrient);
    if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
    if (aIndex >= 0) return -1;
    if (bIndex >= 0) return 1;
    return a.localeCompare(b, "es");
  });
}

export function recipeNameKey(name: string) {
  return normalizeReference(name);
}

export function recipeFingerprint(recipe: RecipeIdentity) {
  const instructions = Array.isArray(recipe.instructions)
    ? recipe.instructions.join(" ")
    : String(recipe.instructions ?? "");
  const instructionKey = normalizeReference(instructions);
  if (instructionKey.length < 20 || recipe.ingredients.length === 0) return "";

  const ingredientKey = recipe.ingredients
    .map((ingredient) =>
      [
        normalizeReference(ingredient.name),
        normalizeReference(String(ingredient.quantity ?? "")),
        normalizeReference(String(ingredient.unit ?? "")),
        ingredient.optional ? "opcional" : "requerido",
      ].join(":"),
    )
    .sort()
    .join("|");

  return `${ingredientKey}::${instructionKey}`;
}

export type DuplicateReview = {
  incomingName: string;
  existingName: string;
  source: "database" | "file";
  reason: "same-id" | "same-name" | "same-content";
};

export function reviewRecipeDuplicates(
  incoming: RecipeIdentity[],
  existing: RecipeIdentity[],
) {
  const duplicates: DuplicateReview[] = [];
  const existingIds = new Map(
    existing.filter((recipe) => recipe.id).map((recipe) => [recipe.id, recipe.name]),
  );
  const existingNames = new Map(
    existing.map((recipe) => [recipeNameKey(recipe.name), recipe.name]),
  );
  const existingFingerprints = new Map(
    existing
      .map((recipe) => [recipeFingerprint(recipe), recipe.name] as const)
      .filter(([fingerprint]) => Boolean(fingerprint)),
  );
  const batchIds = new Map<string, string>();
  const batchNames = new Map<string, string>();
  const batchFingerprints = new Map<string, string>();

  for (const recipe of incoming) {
    const nameKey = recipeNameKey(recipe.name);
    const fingerprint = recipeFingerprint(recipe);
    const sameId = recipe.id ? existingIds.get(recipe.id) : undefined;
    const sameName = existingNames.get(nameKey);
    const sameContent = fingerprint
      ? existingFingerprints.get(fingerprint)
      : undefined;

    if (sameId || sameName || sameContent) {
      duplicates.push({
        incomingName: recipe.name,
        existingName: sameId ?? sameName ?? sameContent ?? recipe.name,
        source: "database",
        reason: sameId ? "same-id" : sameName ? "same-name" : "same-content",
      });
      continue;
    }

    const sameBatchId = recipe.id ? batchIds.get(recipe.id) : undefined;
    const sameBatchName = batchNames.get(nameKey);
    const sameBatchContent = fingerprint
      ? batchFingerprints.get(fingerprint)
      : undefined;
    if (sameBatchId || sameBatchName || sameBatchContent) {
      duplicates.push({
        incomingName: recipe.name,
        existingName:
          sameBatchId ?? sameBatchName ?? sameBatchContent ?? recipe.name,
        source: "file",
        reason: sameBatchId
          ? "same-id"
          : sameBatchName
            ? "same-name"
            : "same-content",
      });
      continue;
    }

    if (recipe.id) batchIds.set(recipe.id, recipe.name);
    batchNames.set(nameKey, recipe.name);
    if (fingerprint) batchFingerprints.set(fingerprint, recipe.name);
  }

  return duplicates;
}
