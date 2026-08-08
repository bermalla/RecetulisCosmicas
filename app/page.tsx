"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AccessGate, useAuth } from "./auth-provider";
import {
  GROUP_SCOPE,
  LOCAL_SCOPE,
  applyRecipeChanges,
  putRecipe,
  readCursor,
  readRecipes,
  replaceRecipes,
  writeCursor,
  type OfflineRecipe,
  type RecipeChange,
} from "../lib/offline-store";
import {
  RECIPE_CATEGORIES,
  filterRecipesByCategory,
  filterRecipesByIngredientMatches,
  inferNutrients,
  ingredientBaseSuggestions,
  ingredientMatchesQuery,
  isAssumedPantryIngredient,
  normalizeIngredientSearch,
  normalizeRecipeCategory,
  recipeCategoryIcon,
  recipeNameKey,
} from "../lib/recipe-intelligence";

type Ingredient = {
  id?: number;
  name: string;
  normalizedName: string;
  quantity?: string | null;
  unit?: string | null;
  optional?: boolean;
};

type Recipe = {
  id: string;
  name: string;
  description: string;
  category: string;
  instructions: string[];
  durationMinutes?: number | null;
  servings?: number | null;
  image?: string | null;
  sourceUrl?: string | null;
  nutrients: string[];
  ingredients: Ingredient[];
  version?: number;
  localOnly?: boolean;
  updatedAt?: string;
};

type ScoredRecipe = Recipe & {
  matched: Ingredient[];
  missing: Ingredient[];
  hasRequiredIngredients: boolean;
  score: number;
};

type ImportProgress = {
  fileName: string;
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  status: "importing" | "refreshing" | "complete" | "error";
  error?: string;
};

const BACKUP_FORMAT = "recetulis-cosmicas";
const LEGACY_BACKUP_FORMAT = ["mi", "recetario"].join("-");
const PANTRY_STORAGE_KEY = "recetulis-cosmicas-pantry";
const IMPORT_BATCH_SIZE = 25;

function normalize(value: string) {
  return normalizeIngredientSearch(value);
}

function parseIngredientLine(line: string) {
  const cleaned = line.replace(/^\s*[-•]\s*/, "").trim();
  if (!cleaned) return null;
  const match = cleaned.match(
    /^((?:\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+|[¼½¾⅓⅔])(?:\s*(?:a gusto))?)?\s*(kg|g|gr|mg|l|ml|cc|tazas?|cucharadas?|cucharaditas?|unidades?|dientes?|puñados?)?\s*(?:de\s+)?(.+)$/i,
  );
  if (!match) return { name: cleaned, quantity: null, unit: null };
  const [, quantity, unit, name] = match;
  return {
    name: name.trim(),
    quantity: quantity?.trim() || null,
    unit: unit?.trim() || null,
  };
}

function ingredientLabel(ingredient: Ingredient) {
  return [ingredient.quantity, ingredient.unit, ingredient.name].filter(Boolean).join(" ");
}

function toOfflineRecipe(value: Record<string, unknown>, preserveId: boolean): Recipe {
  const name = String(value.name ?? "").trim();
  const rawIngredients = Array.isArray(value.ingredients) ? value.ingredients : [];
  const ingredients = rawIngredients
    .map((item) => item as Record<string, unknown>)
    .filter((item) => String(item.name ?? "").trim())
    .map((item, index) => ({
      name: String(item.name).trim(),
      normalizedName: String(item.normalizedName ?? "").trim() || normalizeIngredientSearch(String(item.name)),
      quantity: item.quantity == null ? null : String(item.quantity),
      unit: item.unit == null ? null : String(item.unit),
      optional: Boolean(item.optional),
      sortOrder: index,
    }));
  if (!name || ingredients.length === 0) {
    throw new Error("Cada receta necesita nombre y al menos un ingrediente.");
  }
  const rawInstructions = value.instructions;
  const instructions = Array.isArray(rawInstructions)
    ? rawInstructions.map(String).map((item) => item.trim()).filter(Boolean)
    : String(rawInstructions ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return {
    id: preserveId && value.id ? String(value.id) : crypto.randomUUID(),
    name,
    description: String(value.description ?? "").trim(),
    category: normalizeRecipeCategory(typeof value.category === "string" ? value.category : null, name),
    instructions,
    durationMinutes: typeof value.durationMinutes === "number" ? value.durationMinutes : null,
    servings: typeof value.servings === "number" ? value.servings : null,
    image: value.image ? String(value.image) : null,
    sourceUrl: value.sourceUrl ? String(value.sourceUrl) : null,
    nutrients: Array.isArray(value.nutrients) ? value.nutrients.map(String) : inferNutrients(ingredients),
    ingredients,
    version: Number(value.version ?? 1),
    localOnly: true,
    updatedAt: new Date().toISOString(),
  };
}

export default function HomePage() {
  return <AccessGate><Home /></AccessGate>;
}

function Home() {
  const auth = useAuth();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pantry, setPantry] = useState<string[]>([]);
  const [ingredientInput, setIngredientInput] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [toast, setToast] = useState("");
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const isImporting = importProgress?.status === "importing" || importProgress?.status === "refreshing";

  useEffect(() => {
    if (!selectedRecipe) return;
    const marker = `recipe:${selectedRecipe.id}`;
    window.history.pushState(
      { ...window.history.state, recetulisOverlay: marker },
      "",
      window.location.href,
    );
    const closeOnBack = () => setSelectedRecipe(null);
    window.addEventListener("popstate", closeOnBack);
    return () => window.removeEventListener("popstate", closeOnBack);
  }, [selectedRecipe]);

  function closeRecipeDetail() {
    const marker = selectedRecipe ? `recipe:${selectedRecipe.id}` : "";
    if (window.history.state?.recetulisOverlay === marker) {
      window.history.back();
      return;
    }
    setSelectedRecipe(null);
  }

  useEffect(() => {
    void loadRecipes();
    // The access gate mounts this screen only after the selected mode is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pantry.length) {
      window.localStorage.setItem(PANTRY_STORAGE_KEY, JSON.stringify(pantry));
    }
  }, [pantry]);

  useEffect(() => {
    if (!isImporting) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [isImporting]);

  async function loadRecipes() {
    setLoading(true);
    const scope = auth.mode === "offline" ? LOCAL_SCOPE : GROUP_SCOPE;
    let cached: Recipe[] = [];
    try {
      cached = (await readRecipes(scope)) as Recipe[];
      if (cached.length > 0) setRecipes(cached);
      if (auth.mode === "offline") {
        setRecipes(cached);
        setError("");
        return;
      }

      let cursor = await readCursor(scope);
      let hasMore = true;
      while (hasMore) {
        const response = await auth.authorizedFetch(`/api/sync?after=${cursor}&limit=200`, {
          cache: "no-store",
        });
        const data = (await response.json()) as {
          mode?: "snapshot" | "changes";
          recipes?: Recipe[];
          changes?: RecipeChange[];
          cursor?: number;
          hasMore?: boolean;
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || "No se pudieron sincronizar las recetas.");
        if (data.mode === "snapshot") {
          await replaceRecipes(scope, (data.recipes ?? []) as OfflineRecipe[]);
        } else {
          await applyRecipeChanges(scope, data.changes ?? []);
        }
        cursor = Number(data.cursor ?? cursor);
        await writeCursor(scope, cursor);
        hasMore = Boolean(data.hasMore);
      }
      const synchronized = (await readRecipes(scope)) as Recipe[];
      setRecipes(synchronized);
      setError("");
    } catch (requestError) {
      if (cached.length === 0) {
        setError(requestError instanceof Error ? requestError.message : "No se pudieron cargar las recetas.");
      } else {
        setError("");
        notify("Sin conexión: estás viendo la última copia guardada.");
      }
    } finally {
      setLoading(false);
    }
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  function addPantryIngredient(value = ingredientInput) {
    const clean = normalize(value);
    if (!clean || pantry.some((item) => normalize(item) === clean)) return;
    if (isAssumedPantryIngredient({ name: value })) {
      setIngredientInput("");
      notify("Ese ingrediente ya se considera disponible como básico.");
      return;
    }
    setPantry((current) => [...current, value.trim().toLowerCase()]);
    setIngredientInput("");
  }

  const suggestions = useMemo(() => {
    const unique = new Map<string, string>();
    recipes.flatMap((recipe) => recipe.ingredients).forEach((ingredient) => {
      ingredientBaseSuggestions(ingredient).forEach((base) => {
        if (!isAssumedPantryIngredient({ name: base })) {
          unique.set(normalize(base), base);
        }
      });
    });
    return [...unique.values()]
      .filter(
        (item) =>
          normalize(item).includes(normalize(ingredientInput)) &&
          !pantry.some((pantryItem) => normalize(pantryItem) === normalize(item)),
      )
      .slice(0, 6);
  }, [recipes, ingredientInput, pantry]);

  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const recipe of recipes) {
      counts.set(recipe.category, (counts.get(recipe.category) ?? 0) + 1);
    }
    return RECIPE_CATEGORIES
      .map((category) => ({ category, count: counts.get(category) ?? 0 }))
      .filter((option) => option.count > 0);
  }, [recipes]);

  const scoredRecipes = useMemo<ScoredRecipe[]>(() => {
    const hasIngredient = (ingredient: Ingredient) =>
      isAssumedPantryIngredient(ingredient) ||
      pantry.some((pantryItem) => ingredientMatchesQuery(ingredient, pantryItem));
    return recipes
      .map((recipe) => {
        const requiredIngredients = recipe.ingredients.filter(
          (ingredient) => !ingredient.optional,
        );
        const required = requiredIngredients.filter(
          (ingredient) =>
            !isAssumedPantryIngredient(ingredient),
        );
        const matched = required.filter(hasIngredient);
        const missing = required.filter((ingredient) => !hasIngredient(ingredient));
        return {
          ...recipe,
          matched,
          missing,
          hasRequiredIngredients: requiredIngredients.length > 0,
          score: required.length ? matched.length / required.length : 0,
        };
      })
      .sort((a, b) => {
        if (pantry.length === 0) return a.name.localeCompare(b.name, "es");
        const aComplete = a.hasRequiredIngredients && a.missing.length === 0 ? 1 : 0;
        const bComplete = b.hasRequiredIngredients && b.missing.length === 0 ? 1 : 0;
        return (
          bComplete - aComplete ||
          b.score - a.score ||
          a.missing.length - b.missing.length ||
          a.name.localeCompare(b.name, "es")
        );
      });
  }, [recipes, pantry]);

  const visibleScoredRecipes = useMemo(() => {
    const ingredientMatches = filterRecipesByIngredientMatches(
      scoredRecipes,
      pantry.length > 0,
    );
    return filterRecipesByCategory(ingredientMatches, selectedCategory);
  }, [pantry.length, scoredRecipes, selectedCategory]);
  const hasActiveFilters = pantry.length > 0 || Boolean(selectedCategory);

  async function exportDatabase() {
    try {
      let blob: Blob;
      if (auth.mode === "offline") {
        const payload = {
          format: BACKUP_FORMAT,
          formatVersion: 1,
          mode: "local",
          exportedAt: new Date().toISOString(),
          recipes,
        };
        blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      } else {
        const response = await auth.authorizedFetch("/api/recipes/export");
        if (!response.ok) throw new Error("No se pudo generar el respaldo.");
        blob = await response.blob();
      }
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `recetulis-cosmicas-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(href);
      notify("Respaldo completo descargado.");
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "No se pudo exportar.");
    }
  }

  async function importFile(file: File) {
    let processed = 0;
    let imported = 0;
    let skipped = 0;
    try {
      const raw = JSON.parse(await file.text());
      const importedRecipes = Array.isArray(raw) ? raw : raw.recipes ? raw.recipes : [raw];
      if (!Array.isArray(importedRecipes) || importedRecipes.length === 0) {
        throw new Error("El archivo no contiene recetas para importar.");
      }
      if (importedRecipes.length > 500) {
        throw new Error("El archivo supera el máximo de 500 recetas.");
      }
      const isBackup = raw?.format === BACKUP_FORMAT || raw?.format === LEGACY_BACKUP_FORMAT;
      setImportProgress({
        fileName: file.name,
        total: importedRecipes.length,
        processed: 0,
        imported: 0,
        skipped: 0,
        status: "importing",
      });

      if (auth.mode === "offline") {
        const existingNames = new Set(recipes.map((recipe) => recipeNameKey(recipe.name)));
        for (const rawRecipe of importedRecipes) {
          const recipe = toOfflineRecipe(rawRecipe as Record<string, unknown>, isBackup);
          if (existingNames.has(recipeNameKey(recipe.name))) {
            skipped += 1;
          } else {
            await putRecipe(LOCAL_SCOPE, recipe as OfflineRecipe);
            existingNames.add(recipeNameKey(recipe.name));
            imported += 1;
          }
          processed += 1;
        }
        await loadRecipes();
        setImportProgress({
          fileName: file.name,
          total: importedRecipes.length,
          processed,
          imported,
          skipped,
          status: "complete",
        });
        return;
      }

      for (let index = 0; index < importedRecipes.length; index += IMPORT_BATCH_SIZE) {
        const batch = importedRecipes.slice(index, index + IMPORT_BATCH_SIZE);
        const response = await auth.authorizedFetch("/api/recipes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipes: batch,
            preserveIds: isBackup,
            skipDuplicates: true,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo importar el archivo.");
        processed += batch.length;
        imported += Number(data.imported ?? 0);
        skipped += Number(data.skipped ?? 0);
        setImportProgress({
          fileName: file.name,
          total: importedRecipes.length,
          processed,
          imported,
          skipped,
          status: "importing",
        });
      }

      setImportProgress({
        fileName: file.name,
        total: importedRecipes.length,
        processed,
        imported,
        skipped,
        status: "refreshing",
      });
      await loadRecipes();
      setImportProgress({
        fileName: file.name,
        total: importedRecipes.length,
        processed,
        imported,
        skipped,
        status: "complete",
      });
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "El JSON no es válido.";
      setImportProgress((current) => current
        ? { ...current, processed, imported, skipped, status: "error", error: message }
        : {
            fileName: file.name,
            total: 0,
            processed,
            imported,
            skipped,
            status: "error",
            error: message,
          });
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function saveNewRecipe(input: Record<string, unknown>) {
    if (auth.mode === "offline") {
      const recipe = toOfflineRecipe(input, false);
      await putRecipe(LOCAL_SCOPE, recipe as OfflineRecipe);
      return;
    }
    const response = await auth.authorizedFetch("/api/recipes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipe: input }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo guardar.");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="Ir al inicio">
          <span className="brand-mark" aria-hidden="true">♨</span>
          <span>Recetulis Cósmicas</span>
        </a>
        <nav className="nav-actions" aria-label="Acciones principales">
          <span className={`mode-badge ${auth.mode === "offline" ? "offline" : "online"}`}>
            {auth.mode === "offline" ? "Modo local" : "Sincronizada"}
          </span>
          <Link className="nav-button nav-link" href="/recetas">
            Mis recetas
          </Link>
          <Link className="nav-button nav-link" href="/ajustes">
            Ajustes
          </Link>
          <button className="nav-button" onClick={exportDatabase} disabled={isImporting}>↓ Exportar base</button>
        </nav>
      </header>

      <div className="page-wrap" id="inicio">
        <section className="finder">
          <div className="finder-main">
            <p className="eyebrow">Cociná con lo que ya tenés</p>
            <h1>¿Qué tenés en la heladera?</h1>
            <p className="intro">
              Agregá uno o varios ingredientes. Primero vas a ver las recetas que podés hacer completas y después las más cercanas.
            </p>

            <div className="ingredient-composer">
              <label className="sr-only" htmlFor="ingredient">Agregar ingrediente</label>
              <span className="search-symbol" aria-hidden="true">⌕</span>
              <input
                id="ingredient"
                value={ingredientInput}
                onChange={(event) => setIngredientInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addPantryIngredient();
                }}
                placeholder="Buscá o agregá un ingrediente (ej. cebolla, arroz, pollo)"
                autoComplete="off"
              />
              <button onClick={() => addPantryIngredient()} disabled={!ingredientInput.trim()}>
                <span aria-hidden="true">＋</span> Agregar
              </button>
              {ingredientInput.trim() && suggestions.length > 0 && (
                <div className="suggestions" role="listbox" aria-label="Ingredientes sugeridos">
                  {suggestions.map((suggestion) => (
                    <button key={suggestion} onClick={() => addPantryIngredient(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="pantry-chips" aria-live="polite">
              {pantry.map((ingredient) => (
                <span className="pantry-chip" key={ingredient}>
                  <span aria-hidden="true">●</span>
                  {ingredient}
                  <button
                    aria-label={`Quitar ${ingredient}`}
                    onClick={() => setPantry((current) => current.filter((item) => item !== ingredient))}
                  >
                    ×
                  </button>
                </span>
              ))}
              {pantry.length > 0 && (
                <button className="clear-button" onClick={() => {
                  setPantry([]);
                  window.localStorage.removeItem(PANTRY_STORAGE_KEY);
                }}>
                  Limpiar
                </button>
              )}
            </div>
            <p className="pantry-help">
              Agua, sal, azúcar, pimienta y aceite neutro ya se consideran disponibles.
            </p>
            <div className="category-filter">
              <label htmlFor="recipe-category">Tipo de plato</label>
              <div className="category-select-wrap">
                <select
                  id="recipe-category"
                  value={selectedCategory}
                  onChange={(event) => setSelectedCategory(event.target.value)}
                  disabled={isImporting}
                >
                  <option value="">Todos los tipos de plato</option>
                  {categoryOptions.map(({ category, count }) => (
                    <option key={category} value={category}>
                      {category} ({count})
                    </option>
                  ))}
                </select>
                <span aria-hidden="true">⌄</span>
              </div>
              {selectedCategory && (
                <button className="clear-button" onClick={() => setSelectedCategory("")}>
                  Quitar filtro
                </button>
              )}
            </div>
          </div>

          <aside className="action-panel" aria-label="Gestionar recetas">
            <div className="action-panel-copy">
              <span className="tiny-label">Tu colección</span>
              <strong>{recipes.length} recetas guardadas</strong>
            </div>
            <button className="primary-action" onClick={() => setShowAdd(true)} disabled={isImporting}>
              <span aria-hidden="true">＋</span> Agregar receta
            </button>
            <button className="secondary-action" onClick={() => fileInput.current?.click()} disabled={isImporting}>
              <span aria-hidden="true">↑</span> {isImporting ? "Importando…" : "Importar JSON"}
            </button>
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
              }}
            />
            <div className="pantry-doodle" aria-hidden="true">
              <span>◫</span><span>▱</span><span>♧</span>
            </div>
          </aside>
        </section>

        <section className="results" id="resultados">
          <div className="results-heading">
            <div>
              <p className="eyebrow">
                {recipes.length === 0
                  ? "Colección inicial"
                  : selectedCategory
                    ? selectedCategory
                    : "Ordenadas por coincidencia"}
              </p>
              <h2>
                {loading
                  ? "Buscando recetas…"
                  : recipes.length === 0
                    ? "Tu recetario está listo"
                    : hasActiveFilters && visibleScoredRecipes.length === 0
                      ? "No encontramos coincidencias"
                      : `${visibleScoredRecipes.length} recetas encontradas`}
              </h2>
            </div>
            {recipes.length > 0 && pantry.length > 0 && !loading && (
              <p>
                <strong>{visibleScoredRecipes.filter(
                  (recipe) =>
                    recipe.hasRequiredIngredients && recipe.missing.length === 0,
                ).length}</strong> completas con tu selección
              </p>
            )}
          </div>

          {error && <div className="error-card">{error}</div>}
          {!loading && !error && recipes.length === 0 && (
            <div className="empty-recipes">
              <span className="empty-recipes-icon" aria-hidden="true">＋</span>
              <div>
                <p className="eyebrow">Base vacía</p>
                <h3>Agregá tu primera receta</h3>
                <p>
                  Podés cargarla desde el formulario o importar un archivo JSON.
                  A partir de ahí, tus ingredientes empezarán a filtrar la colección.
                </p>
              </div>
              <div className="empty-recipes-actions">
                <button className="primary-action" onClick={() => setShowAdd(true)} disabled={isImporting}>
                  Agregar receta
                </button>
                <button className="secondary-action" onClick={() => fileInput.current?.click()} disabled={isImporting}>
                  {isImporting ? "Importando…" : "Importar JSON"}
                </button>
              </div>
            </div>
          )}
          {!loading &&
            !error &&
            recipes.length > 0 &&
            hasActiveFilters &&
            visibleScoredRecipes.length === 0 && (
              <div className="filter-empty">
                <strong>No hay recetas para esta combinación de filtros.</strong>
                <p>Probá con otra categoría o cambiá los ingredientes disponibles.</p>
              </div>
            )}
          {!loading && !error && visibleScoredRecipes.length > 0 && (
            <div className="recipe-grid">
              {visibleScoredRecipes.map((recipe, index) => {
                const complete =
                  pantry.length > 0 &&
                  recipe.hasRequiredIngredients &&
                  recipe.missing.length === 0;
                const hasMatches = recipe.matched.length > 0;
                const percent = pantry.length > 0 ? Math.round(recipe.score * 100) : 0;
                return (
                  <article
                    className={`recipe-card ${complete ? "is-complete" : hasMatches ? "is-partial" : "is-neutral"}`}
                    key={recipe.id}
                    style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
                    onClick={() => setSelectedRecipe(recipe)}
                  >
                    <div className={`recipe-image ${recipe.image ? "" : "recipe-placeholder"}`}>
                      {recipe.image ? (
                        <Image
                          src={recipe.image}
                          alt=""
                          fill
                          sizes="(max-width: 680px) 100vw, (max-width: 1050px) 42vw, 21vw"
                        />
                      ) : (
                        <div className="category-preview">
                          <span aria-hidden="true">{recipeCategoryIcon(recipe.category)}</span>
                          <small>{recipe.category}</small>
                        </div>
                      )}
                    </div>
                    <div className="recipe-content">
                      <div>
                        <h3>{recipe.name}</h3>
                        {pantry.length > 0 ? (
                          <span className={`match-badge ${complete ? "complete" : hasMatches ? "partial" : "neutral"}`}>
                            {complete ? "✓ Tenés todo" : hasMatches ? `Te ${recipe.missing.length === 1 ? "falta" : "faltan"} ${recipe.missing.length}` : "Sin coincidencias"}
                          </span>
                        ) : (
                          <span className="match-badge neutral">Ver receta</span>
                        )}
                        <p>{recipe.description}</p>
                      </div>
                      <div className="card-footer">
                        <div className="recipe-meta">
                          {recipe.durationMinutes && <span>◷ {recipe.durationMinutes} min</span>}
                          {recipe.servings && <span>♙ {recipe.servings} {recipe.servings === 1 ? "porción" : "porciones"}</span>}
                        </div>
                        {pantry.length > 0 && (
                          <span className="score-ring" style={{ "--score": `${percent * 3.6}deg` } as React.CSSProperties}>
                            {percent}%
                          </span>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {showAdd && (
        <RecipeForm
          existingRecipes={recipes}
          onClose={() => setShowAdd(false)}
          onSave={saveNewRecipe}
          onSaved={async () => {
            setShowAdd(false);
            await loadRecipes();
            notify("Receta guardada. Sin duplicados y con nutrientes revisados.");
          }}
        />
      )}

      {selectedRecipe && (
        <RecipeDetail
          recipe={selectedRecipe}
          pantry={pantry}
          onClose={closeRecipeDetail}
        />
      )}
      {importProgress && (
        <div className="modal-backdrop import-backdrop">
          <section
            className="modal import-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-title"
            aria-describedby="import-description"
          >
            <p className="eyebrow">Importación de recetas</p>
            <h2 id="import-title">
              {importProgress.status === "complete"
                ? "Importación terminada"
                : importProgress.status === "error"
                  ? "La importación se detuvo"
                  : "Estamos sumando tus recetas"}
            </h2>
            <p className="modal-intro" id="import-description">
              {importProgress.status === "complete"
                ? `${importProgress.imported} recetas nuevas fueron incorporadas correctamente.`
                : importProgress.status === "error"
                  ? "Lo que ya se guardó permanece seguro. Podés volver a elegir el mismo archivo para continuar."
                  : importProgress.status === "refreshing"
                    ? "La carga terminó. Estamos actualizando tu colección."
                    : "No cierres ni recargues esta pestaña hasta que termine el proceso."}
            </p>
            <div className="import-file-name">{importProgress.fileName}</div>
            <div className="import-progress-copy" aria-live="polite">
              <strong>{importProgress.processed} de {importProgress.total}</strong>
              <span>{importProgress.total > 0 ? Math.round((importProgress.processed / importProgress.total) * 100) : 0}%</span>
            </div>
            <progress
              className="import-progress"
              max={Math.max(importProgress.total, 1)}
              value={importProgress.processed}
            />
            {importProgress.skipped > 0 && (
              <p className="import-note">
                {importProgress.skipped} {importProgress.skipped === 1 ? "receta ya existía" : "recetas ya existían"} y se omitieron sin interrumpir la carga.
              </p>
            )}
            {importProgress.status === "error" && (
              <p className="form-error" role="alert">{importProgress.error}</p>
            )}
            {(importProgress.status === "complete" || importProgress.status === "error") && (
              <div className="modal-actions">
                <button className="primary-action" onClick={() => setImportProgress(null)}>
                  {importProgress.status === "complete" ? "Listo" : "Cerrar y reintentar"}
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function RecipeForm({
  existingRecipes,
  onClose,
  onSave,
  onSaved,
}: {
  existingRecipes: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (recipe: Record<string, unknown>) => Promise<void>;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ingredientsText, setIngredientsText] = useState("");
  const [instructions, setInstructions] = useState("");
  const [duration, setDuration] = useState("");
  const [servings, setServings] = useState("");
  const [nutrients, setNutrients] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const parsedIngredients = useMemo(
    () => ingredientsText.split(/\r?\n/).map(parseIngredientLine).filter(Boolean),
    [ingredientsText],
  );
  const inferredNutrients = useMemo(
    () =>
      inferNutrients(
        parsedIngredients.flatMap((ingredient) => (ingredient ? [ingredient] : [])),
      ),
    [parsedIngredients],
  );
  const duplicateRecipe = useMemo(() => {
    const key = recipeNameKey(name);
    if (!key) return null;
    return existingRecipes.find((recipe) => recipeNameKey(recipe.name) === key) ?? null;
  }, [existingRecipes, name]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        name,
        description,
        ingredients: parsedIngredients,
        instructions,
        durationMinutes: duration ? Number(duration) : null,
        servings: servings ? Number(servings) : null,
        nutrients: nutrients.split(",").map((item) => item.trim()).filter(Boolean),
      });
      await onSaved();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="modal form-modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <button className="modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        <p className="eyebrow">Nueva receta</p>
        <h2 id="add-title">Sumala a tu colección</h2>
        <p className="modal-intro">Pegá un ingrediente y un paso por línea. Nosotros separamos los ítems.</p>
        <form onSubmit={submit}>
          <label>
            Nombre
            <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Guiso de lentejas" />
            {duplicateRecipe && (
              <small className="duplicate-warning">
                Ya existe una receta llamada “{duplicateRecipe.name}”. Cambiá el nombre solo si realmente es otra preparación.
              </small>
            )}
          </label>
          <label>
            Descripción breve
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Una frase para reconocerla" />
          </label>
          <div className="form-row">
            <label>
              Duración (min)
              <input type="number" min="1" value={duration} onChange={(event) => setDuration(event.target.value)} />
            </label>
            <label>
              Porciones
              <input type="number" min="1" value={servings} onChange={(event) => setServings(event.target.value)} />
            </label>
          </div>
          <label>
            Nutrientes adicionales (opcional)
            <input
              value={nutrients}
              onChange={(event) => setNutrients(event.target.value)}
              placeholder="Ej. Hierro, Vitamina C, Omega 3"
            />
            <small className="field-help">
              Detectamos los nutrientes de referencia automáticamente. Usá este campo solo para sumar alguno que conozcas.
            </small>
          </label>
          <label>
            Ingredientes
            <textarea
              required
              rows={7}
              value={ingredientsText}
              onChange={(event) => setIngredientsText(event.target.value)}
              placeholder={"2 huevos\n200 g de harina\n1 taza de leche\nsal a gusto"}
            />
          </label>
          {parsedIngredients.length > 0 && (
            <div className="parsed-preview">
              <span>Detectamos:</span>
              {parsedIngredients.slice(0, 8).map((ingredient, index) => (
                <small key={`${ingredient?.name}-${index}`}>{ingredient?.name}</small>
              ))}
            </div>
          )}
          {inferredNutrients.length > 0 && (
            <div className="nutrient-reference" aria-live="polite">
              <div>
                <span className="tiny-label">Referencia automática</span>
                <small>Según los ingredientes obligatorios cargados</small>
              </div>
              <div className="nutrient-tags">
                {inferredNutrients.map((nutrient) => (
                  <span key={nutrient}>{nutrient}</span>
                ))}
              </div>
              <small>
                Indica presencia habitual, no cantidad ni biodisponibilidad. No reemplaza asesoramiento profesional.
              </small>
            </div>
          )}
          <label>
            Instrucciones
            <textarea
              required
              rows={7}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder={"Mezclá los ingredientes secos.\nAgregá los huevos y la leche.\nCociná a fuego medio."}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="secondary-action" onClick={onClose}>Cancelar</button>
            <button
              className="primary-action"
              disabled={saving || parsedIngredients.length === 0 || Boolean(duplicateRecipe)}
            >
              {saving ? "Revisando y guardando…" : "Revisar y guardar"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function RecipeDetail({
  recipe,
  pantry,
  onClose,
}: {
  recipe: Recipe;
  pantry: string[];
  onClose: () => void;
}) {
  const hasIngredient = (ingredient: Ingredient) =>
    isAssumedPantryIngredient(ingredient) ||
    pantry.some((pantryItem) => ingredientMatchesQuery(ingredient, pantryItem));
  const missing = recipe.ingredients.filter(
    (ingredient) =>
      !ingredient.optional &&
      !isAssumedPantryIngredient(ingredient) &&
      !hasIngredient(ingredient),
  );
  const canMake =
    pantry.length > 0 &&
    recipe.ingredients.some((ingredient) => !ingredient.optional) &&
    missing.length === 0;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <article className="modal detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <button className="modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        {recipe.image && (
          <Image
            className="detail-image"
            src={recipe.image}
            alt=""
            width={1200}
            height={800}
            sizes="(max-width: 1000px) 100vw, 1000px"
          />
        )}
        <div className="detail-heading">
          <p className="eyebrow">
            {recipe.category} · {canMake ? "Podés hacerla ahora" : "Receta guardada"}
          </p>
          <h2 id="detail-title">{recipe.name}</h2>
          <p>{recipe.description}</p>
          {recipe.nutrients.length > 0 && (
            <div className="nutrient-block">
              <span className="tiny-label">Nutrientes destacados</span>
              <div className="nutrient-tags">
                {recipe.nutrients.map((nutrient) => <span key={nutrient}>{nutrient}</span>)}
              </div>
            </div>
          )}
        </div>
        <div className="detail-columns">
          <section>
            <h3>Ingredientes</h3>
            <ul className="ingredient-list">
              {recipe.ingredients.map((ingredient) => {
                const available = hasIngredient(ingredient);
                const assumed = isAssumedPantryIngredient(ingredient);
                return (
                  <li key={`${ingredient.id}-${ingredient.name}`} className={available ? "available" : ""}>
                    <span>{available ? "✓" : "○"}</span>
                    {ingredientLabel(ingredient)}
                    {assumed && <small className="staple-note">básico</small>}
                  </li>
                );
              })}
            </ul>
          </section>
          <section>
            <h3>Preparación</h3>
            <ol className="instruction-list">
              {recipe.instructions.map((step, index) => <li key={index}>{step}</li>)}
            </ol>
          </section>
        </div>
        <div className="detail-footer">
          <div className="recipe-meta">
            {recipe.durationMinutes && <span>◷ {recipe.durationMinutes} min</span>}
            {recipe.servings && <span>♙ {recipe.servings} {recipe.servings === 1 ? "porción" : "porciones"}</span>}
          </div>
          {recipe.sourceUrl && (
            <a className="source-link" href={recipe.sourceUrl} target="_blank" rel="noreferrer">
              Ver fuente original ↗
            </a>
          )}
        </div>
      </article>
    </div>
  );
}
