import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_API_URL = "https://mi-recetario.bermalla.chatgpt.site";
const MAX_RECIPES = 500;
const MAX_FILE_BYTES = 2_000_000;

function usage() {
  return `Uso:
  npm.cmd run recipes -- validate <archivo.json>
  npm.cmd run recipes -- check <archivo.json> [--skip-duplicates] [--preserve-ids]
  npm.cmd run recipes -- publish <archivo.json> --confirm [--skip-duplicates] [--preserve-ids]

Variables:
  RECETULIS_API_URL             URL del sitio (opcional)
  RECETULIS_AUTOMATION_TOKEN    Credencial privada para check/publish`;
}

function recipeListFromJson(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    if (Array.isArray(value.recipes)) return value.recipes;
    if (value.recipe && typeof value.recipe === "object") return [value.recipe];
    if (typeof value.name === "string" && Array.isArray(value.ingredients)) return [value];
  }
  throw new Error("El archivo debe contener una receta, una lista o un objeto { recipes: [...] }.");
}

export function validateRecipePayload(value) {
  const recipes = recipeListFromJson(value);
  if (recipes.length === 0) throw new Error("El archivo no contiene recetas.");
  if (recipes.length > MAX_RECIPES) {
    throw new Error(`El archivo contiene ${recipes.length} recetas; el máximo es ${MAX_RECIPES}.`);
  }

  for (const [index, recipe] of recipes.entries()) {
    if (!recipe || typeof recipe !== "object") {
      throw new Error(`La receta ${index + 1} no es un objeto válido.`);
    }
    if (!String(recipe.name ?? "").trim()) {
      throw new Error(`La receta ${index + 1} no tiene nombre.`);
    }
    if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
      throw new Error(`“${recipe.name}” necesita al menos un ingrediente.`);
    }
  }

  return recipes;
}

function requestPayload(recipes, flags, dryRun) {
  return {
    recipes,
    preserveIds: flags.has("--preserve-ids"),
    skipDuplicates: flags.has("--skip-duplicates"),
    dryRun,
  };
}

function apiEndpoint() {
  const base = (process.env.RECETULIS_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
  const url = new URL(`${base}/api/recipes`);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("RECETULIS_API_URL debe usar HTTPS, salvo en desarrollo local.");
  }
  return url;
}

async function callApi(recipes, flags, dryRun) {
  const token = process.env.RECETULIS_AUTOMATION_TOKEN?.trim();
  if (!token) {
    throw new Error("Falta RECETULIS_AUTOMATION_TOKEN en el entorno o en .env.local.");
  }

  const response = await fetch(apiEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Recetulis-Automation-Token": token,
    },
    body: JSON.stringify(requestPayload(recipes, flags, dryRun)),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => ({ error: `Respuesta HTTP ${response.status}.` }));
  if (!response.ok) {
    const error = new Error(data.error || `La API respondió HTTP ${response.status}.`);
    error.details = { status: response.status, code: data.code, duplicates: data.duplicates };
    throw error;
  }
  return data;
}

async function loadPayload(filePath) {
  const file = await readFile(filePath);
  if (file.byteLength > MAX_FILE_BYTES) {
    throw new Error(`El archivo supera el máximo de ${MAX_FILE_BYTES} bytes.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(file.toString("utf8"));
  } catch {
    throw new Error("El archivo no contiene JSON válido en UTF-8.");
  }
  return validateRecipePayload(parsed);
}

export async function run(argv) {
  const [command, filePath, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { help: usage() };
  }
  if (!filePath) throw new Error(usage());
  const flags = new Set(rest);
  const recipes = await loadPayload(filePath);

  if (command === "validate") {
    return { valid: true, recipes: recipes.length, names: recipes.map((recipe) => recipe.name) };
  }
  if (command === "check") {
    return callApi(recipes, flags, true);
  }
  if (command === "publish") {
    if (!flags.has("--confirm")) {
      throw new Error("Publicación cancelada: falta --confirm.");
    }
    const check = await callApi(recipes, flags, true);
    const published = await callApi(recipes, flags, false);
    return { check, published };
  }
  throw new Error(`Comando desconocido: ${command}\n\n${usage()}`);
}

async function main() {
  try {
    const result = await run(process.argv.slice(2));
    if (result.help) process.stdout.write(`${result.help}\n`);
    else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const details = error && typeof error === "object" ? error.details : undefined;
    process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error), ...details }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
