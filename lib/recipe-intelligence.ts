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
