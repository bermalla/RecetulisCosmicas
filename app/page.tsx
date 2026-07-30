"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  inferNutrients,
  ingredientMatchesQuery,
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
  instructions: string[];
  durationMinutes?: number | null;
  servings?: number | null;
  image?: string | null;
  sourceUrl?: string | null;
  nutrients: string[];
  ingredients: Ingredient[];
};

type ScoredRecipe = Recipe & {
  matched: Ingredient[];
  missing: Ingredient[];
  score: number;
};

const aliases: Record<string, string> = {
  papas: "papa",
  patata: "papa",
  patatas: "papa",
  huevos: "huevo",
  tomates: "tomate",
  cebollas: "cebolla",
  ajos: "ajo",
  quesos: "queso",
};

function normalize(value: string) {
  const cleaned = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return aliases[cleaned] ?? cleaned;
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

export default function Home() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pantry, setPantry] = useState<string[]>(["huevo", "queso", "tomate"]);
  const [ingredientInput, setIngredientInput] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [toast, setToast] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadRecipes();
  }, []);

  useEffect(() => {
    if (pantry.length) {
      window.localStorage.setItem("mi-recetario-pantry", JSON.stringify(pantry));
    }
  }, [pantry]);

  async function loadRecipes() {
    setLoading(true);
    try {
      const response = await fetch("/api/recipes", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar las recetas.");
      setRecipes(data.recipes);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudieron cargar las recetas.");
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
    setPantry((current) => [...current, value.trim().toLowerCase()]);
    setIngredientInput("");
  }

  const suggestions = useMemo(() => {
    const unique = new Map<string, string>();
    recipes.flatMap((recipe) => recipe.ingredients).forEach((ingredient) => {
      unique.set(normalize(ingredient.name), ingredient.name);
    });
    return [...unique.values()]
      .filter(
        (item) =>
          normalize(item).includes(normalize(ingredientInput)) &&
          !pantry.some((pantryItem) => normalize(pantryItem) === normalize(item)),
      )
      .slice(0, 6);
  }, [recipes, ingredientInput, pantry]);

  const scoredRecipes = useMemo<ScoredRecipe[]>(() => {
    const hasIngredient = (ingredient: Ingredient) =>
      pantry.some((pantryItem) => ingredientMatchesQuery(ingredient, pantryItem));
    return recipes
      .map((recipe) => {
        const required = recipe.ingredients.filter((ingredient) => !ingredient.optional);
        const matched = required.filter(hasIngredient);
        const missing = required.filter((ingredient) => !hasIngredient(ingredient));
        return {
          ...recipe,
          matched,
          missing,
          score: required.length ? matched.length / required.length : 0,
        };
      })
      .sort((a, b) => {
        if (pantry.length === 0) return a.name.localeCompare(b.name, "es");
        const aComplete = a.missing.length === 0 ? 1 : 0;
        const bComplete = b.missing.length === 0 ? 1 : 0;
        return (
          bComplete - aComplete ||
          b.score - a.score ||
          a.missing.length - b.missing.length ||
          a.name.localeCompare(b.name, "es")
        );
      });
  }, [recipes, pantry]);

  async function exportDatabase() {
    try {
      const response = await fetch("/api/recipes/export");
      if (!response.ok) throw new Error("No se pudo generar el respaldo.");
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `mi-recetario-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(href);
      notify("Respaldo completo descargado.");
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "No se pudo exportar.");
    }
  }

  async function importFile(file: File) {
    try {
      const raw = JSON.parse(await file.text());
      const importedRecipes = Array.isArray(raw) ? raw : raw.recipes ? raw.recipes : [raw];
      const isBackup = raw?.format === "mi-recetario";
      const response = await fetch("/api/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipes: importedRecipes, preserveIds: isBackup }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo importar el archivo.");
      await loadRecipes();
      notify(
        `${data.imported} ${data.imported === 1 ? "receta importada" : "recetas importadas"}. Sin duplicados y con nutrientes revisados.`,
      );
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "El JSON no es válido.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="Ir al inicio">
          <span className="brand-mark" aria-hidden="true">♨</span>
          <span>Mi Recetario</span>
        </a>
        <nav className="nav-actions" aria-label="Acciones principales">
          <Link className="nav-button nav-link" href="/recetas">
            Mis recetas
          </Link>
          <button className="nav-button" onClick={exportDatabase}>↓ Exportar base</button>
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
                  window.localStorage.removeItem("mi-recetario-pantry");
                }}>
                  Limpiar
                </button>
              )}
            </div>
          </div>

          <aside className="action-panel" aria-label="Gestionar recetas">
            <div className="action-panel-copy">
              <span className="tiny-label">Tu colección</span>
              <strong>{recipes.length} recetas guardadas</strong>
            </div>
            <button className="primary-action" onClick={() => setShowAdd(true)}>
              <span aria-hidden="true">＋</span> Agregar receta
            </button>
            <button className="secondary-action" onClick={() => fileInput.current?.click()}>
              <span aria-hidden="true">↑</span> Importar JSON
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
              <p className="eyebrow">{recipes.length === 0 ? "Colección inicial" : "Ordenadas por coincidencia"}</p>
              <h2>
                {loading
                  ? "Buscando recetas…"
                  : recipes.length === 0
                    ? "Tu recetario está listo"
                    : `${recipes.length} recetas encontradas`}
              </h2>
            </div>
            {recipes.length > 0 && pantry.length > 0 && !loading && (
              <p>
                <strong>{scoredRecipes.filter((recipe) => recipe.missing.length === 0).length}</strong> completas con tu selección
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
                <button className="primary-action" onClick={() => setShowAdd(true)}>
                  Agregar receta
                </button>
                <button className="secondary-action" onClick={() => fileInput.current?.click()}>
                  Importar JSON
                </button>
              </div>
            </div>
          )}
          {!loading && !error && recipes.length > 0 && (
            <div className="recipe-grid">
              {scoredRecipes.map((recipe, index) => {
                const complete = pantry.length > 0 && recipe.missing.length === 0;
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
                        <span aria-hidden="true">{recipe.name.slice(0, 1)}</span>
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
          onClose={() => setSelectedRecipe(null)}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function RecipeForm({
  existingRecipes,
  onClose,
  onSaved,
}: {
  existingRecipes: Array<{ id: string; name: string }>;
  onClose: () => void;
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
      const response = await fetch("/api/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipe: {
            name,
            description,
            ingredients: parsedIngredients,
            instructions,
            durationMinutes: duration ? Number(duration) : null,
            servings: servings ? Number(servings) : null,
            nutrients: nutrients.split(",").map((item) => item.trim()).filter(Boolean),
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar.");
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
    pantry.some((pantryItem) => ingredientMatchesQuery(ingredient, pantryItem));
  const missing = recipe.ingredients.filter(
    (ingredient) => !ingredient.optional && !hasIngredient(ingredient),
  );

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
          <p className="eyebrow">{missing.length === 0 && pantry.length > 0 ? "Podés hacerla ahora" : "Receta guardada"}</p>
          <h2 id="detail-title">{recipe.name}</h2>
          <p>{recipe.description}</p>
          {recipe.nutrients.length > 0 && (
            <div className="nutrient-block">
              <span className="tiny-label">Nutrientes destacados</span>
              <div className="nutrient-tags">
                {recipe.nutrients.map((nutrient) => <span key={nutrient}>{nutrient}</span>)}
              </div>
              <small>Estimados por los ingredientes de la receta; no representan una dosis ni reemplazan asesoramiento profesional.</small>
            </div>
          )}
        </div>
        <div className="detail-columns">
          <section>
            <h3>Ingredientes</h3>
            <ul className="ingredient-list">
              {recipe.ingredients.map((ingredient) => {
                const available = hasIngredient(ingredient);
                return (
                  <li key={`${ingredient.id}-${ingredient.name}`} className={available ? "available" : ""}>
                    <span>{available ? "✓" : "○"}</span>
                    {ingredientLabel(ingredient)}
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
