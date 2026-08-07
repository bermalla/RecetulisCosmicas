"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { recipeCategoryIcon } from "../../lib/recipe-intelligence";
import { AccessGate, useAuth } from "../auth-provider";
import {
  GROUP_SCOPE,
  LOCAL_SCOPE,
  applyRecipeChanges,
  readCursor,
  readRecipes,
  removeRecipe as removeCachedRecipe,
  replaceRecipes,
  writeCursor,
  type OfflineRecipe,
  type RecipeChange,
} from "../../lib/offline-store";

type Recipe = {
  id: string;
  name: string;
  description: string;
  category: string;
  durationMinutes?: number | null;
  servings?: number | null;
  nutrients: string[];
  ingredients: Array<{ id?: number; name: string }>;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export default function RecipesLibraryPage() {
  return <AccessGate><RecipesLibrary /></AccessGate>;
}

function RecipesLibrary() {
  const auth = useAuth();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteAllStep, setDeleteAllStep] = useState<0 | 1 | 2>(0);
  const [deleteAllText, setDeleteAllText] = useState("");
  const [deletingAll, setDeletingAll] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    async function loadInitialRecipes() {
      setLoading(true);
      const scope = auth.mode === "offline" ? LOCAL_SCOPE : GROUP_SCOPE;
      let cached: Recipe[] = [];
      try {
        cached = (await readRecipes(scope)) as Recipe[];
        setRecipes(cached);
        if (auth.mode === "offline") return;
        let cursor = await readCursor(scope);
        let hasMore = true;
        while (hasMore) {
          const response = await auth.authorizedFetch(`/api/sync?after=${cursor}&limit=200`, { cache: "no-store" });
          const data = (await response.json()) as {
            mode?: "snapshot" | "changes";
            recipes?: Recipe[];
            changes?: RecipeChange[];
            cursor?: number;
            hasMore?: boolean;
            error?: string;
          };
          if (!response.ok) throw new Error(data.error || "No se pudieron cargar las recetas.");
          if (data.mode === "snapshot") await replaceRecipes(scope, (data.recipes ?? []) as OfflineRecipe[]);
          else await applyRecipeChanges(scope, data.changes ?? []);
          cursor = Number(data.cursor ?? cursor);
          await writeCursor(scope, cursor);
          hasMore = Boolean(data.hasMore);
        }
        setRecipes((await readRecipes(scope)) as Recipe[]);
        setError("");
      } catch (requestError) {
        if (cached.length === 0) {
          setError(requestError instanceof Error ? requestError.message : "No se pudieron cargar las recetas.");
        }
      } finally {
        setLoading(false);
      }
    }
    void loadInitialRecipes();
  }, [auth]);

  const visibleRecipes = useMemo(() => {
    const cleanQuery = normalize(query);
    return recipes
      .filter((recipe) => !cleanQuery || normalize(recipe.name).includes(cleanQuery))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [query, recipes]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function removeRecipe(recipe: Recipe) {
    if (!window.confirm(`¿Eliminar “${recipe.name}” de la base? Esta acción no se puede deshacer.`)) return;
    setDeletingId(recipe.id);
    try {
      const scope = auth.mode === "offline" ? LOCAL_SCOPE : GROUP_SCOPE;
      if (auth.mode === "offline") {
        await removeCachedRecipe(scope, recipe.id);
      } else {
        const response = await auth.authorizedFetch(`/api/recipes?id=${encodeURIComponent(recipe.id)}`, {
          method: "DELETE",
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo eliminar la receta.");
        await removeCachedRecipe(scope, recipe.id);
      }
      setRecipes((current) => current.filter((item) => item.id !== recipe.id));
      notify("Receta eliminada.");
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "No se pudo eliminar la receta.");
    } finally {
      setDeletingId(null);
    }
  }

  function closeDeleteAll() {
    if (deletingAll) return;
    setDeleteAllStep(0);
    setDeleteAllText("");
  }

  async function removeAllRecipes() {
    if (deleteAllText.trim().toUpperCase() !== "BORRAR") return;
    setDeletingAll(true);
    try {
      let data = { deleted: recipes.length, error: "" };
      if (auth.mode === "offline") {
        await replaceRecipes(LOCAL_SCOPE, []);
      } else {
        const response = await auth.authorizedFetch("/api/recipes?all=true", {
          method: "DELETE",
          headers: { "X-Confirm-Delete-All": "BORRAR" },
        });
        data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo vaciar la base.");
        await replaceRecipes(GROUP_SCOPE, []);
      }
      setRecipes([]);
      setQuery("");
      setDeleteAllStep(0);
      setDeleteAllText("");
      notify(`${data.deleted} ${data.deleted === 1 ? "receta eliminada" : "recetas eliminadas"}. La base quedó vacía.`);
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "No se pudo vaciar la base.");
    } finally {
      setDeletingAll(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Volver al buscador">
          <span className="brand-mark" aria-hidden="true">♨</span>
          <span>Recetulis Cósmicas</span>
        </Link>
        <nav className="nav-actions" aria-label="Navegación">
          <Link className="nav-button nav-link" href="/">← Volver al buscador</Link>
        </nav>
      </header>

      <div className="library-page">
        <section className="library-hero">
          <div>
            <p className="eyebrow">Tu colección completa</p>
            <h1>Mis recetas</h1>
            <p className="intro">
              Buscá por nombre y administrá qué recetas querés conservar en tu base.
            </p>
          </div>
          <div className="library-count" aria-live="polite">
            <strong>{recipes.length}</strong>
            <span>{recipes.length === 1 ? "receta guardada" : "recetas guardadas"}</span>
          </div>
        </section>

        <section className="library-content" aria-labelledby="library-title">
          <h2 className="sr-only" id="library-title">Listado de recetas</h2>
          <label className="library-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filtrar recetas por nombre…"
              autoFocus
            />
            {query && <button onClick={() => setQuery("")} aria-label="Limpiar búsqueda">×</button>}
          </label>

          {recipes.length > 0 && (auth.mode === "offline" || auth.actor?.role === "owner") && (
            <div className="library-maintenance">
              <div>
                <strong>Herramientas de recuperación</strong>
                <span>Usalas sólo si necesitás reconstruir la colección desde un respaldo.</span>
              </div>
              <button
                className="danger-action"
                onClick={() => setDeleteAllStep(1)}
                disabled={deletingAll || Boolean(deletingId)}
              >
                Vaciar toda la base
              </button>
            </div>
          )}

          {error && <div className="error-card">{error}</div>}
          {loading && <p className="library-status">Cargando tu colección…</p>}
          {!loading && !error && visibleRecipes.length === 0 && (
            <div className="library-empty">
              <strong>
                {recipes.length === 0
                  ? "Tu colección todavía está vacía."
                  : "No encontramos recetas con ese nombre."}
              </strong>
              <p>
                {recipes.length === 0
                  ? "Volvé al recetario para cargar tu primera receta o importar un archivo JSON."
                  : "Probá con otra búsqueda o volvé al recetario para sumar una nueva."}
              </p>
            </div>
          )}
          {!loading && !error && visibleRecipes.length > 0 && (
            <div className="library-list">
              {visibleRecipes.map((recipe) => (
                <article className="library-item" key={recipe.id}>
                  <div className="library-category">
                    <span aria-hidden="true">{recipeCategoryIcon(recipe.category)}</span>
                    <small>{recipe.category}</small>
                  </div>
                  <div className="library-item-copy">
                    <h3>{recipe.name}</h3>
                    <p>{recipe.description || "Sin descripción."}</p>
                    <div className="recipe-meta">
                      <span>{recipe.ingredients.length} {recipe.ingredients.length === 1 ? "ingrediente" : "ingredientes"}</span>
                      {recipe.durationMinutes && <span>◷ {recipe.durationMinutes} min</span>}
                      {recipe.servings && <span>♙ {recipe.servings} {recipe.servings === 1 ? "porción" : "porciones"}</span>}
                    </div>
                    {recipe.nutrients.length > 0 && (
                      <div className="nutrient-tags compact">
                        {recipe.nutrients.slice(0, 5).map((nutrient) => <span key={nutrient}>{nutrient}</span>)}
                        {recipe.nutrients.length > 5 && <span>+{recipe.nutrients.length - 5}</span>}
                      </div>
                    )}
                  </div>
                  <button
                    className="library-delete"
                    onClick={() => void removeRecipe(recipe)}
                    disabled={deletingAll || deletingId === recipe.id}
                  >
                    {deletingId === recipe.id ? "Eliminando…" : "Quitar de la base"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
      {deleteAllStep > 0 && (
        <div className="modal-backdrop">
          <section
            className="modal delete-all-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-all-title"
            aria-describedby="delete-all-description"
          >
            <p className="eyebrow">Acción irreversible</p>
            <h2 id="delete-all-title">
              {deleteAllStep === 1 ? "¿Vaciar toda la base?" : "Confirmación final"}
            </h2>
            {deleteAllStep === 1 ? (
              <>
                <p className="modal-intro" id="delete-all-description">
                  Se eliminarán las {recipes.length} recetas y todos sus ingredientes. Esta acción no se puede deshacer; exportá un respaldo antes si querés conservarlos.
                </p>
                <div className="modal-actions">
                  <button className="secondary-action" onClick={closeDeleteAll}>Cancelar</button>
                  <button className="danger-action" onClick={() => setDeleteAllStep(2)}>
                    Entiendo, continuar
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="modal-intro" id="delete-all-description">
                  Para confirmar por segunda vez, escribí <strong>BORRAR</strong> en el campo.
                </p>
                <label className="delete-all-field">
                  Confirmación
                  <input
                    value={deleteAllText}
                    onChange={(event) => setDeleteAllText(event.target.value)}
                    placeholder="Escribí BORRAR"
                    autoComplete="off"
                    autoFocus
                  />
                </label>
                <div className="modal-actions">
                  <button className="secondary-action" onClick={closeDeleteAll} disabled={deletingAll}>
                    Cancelar
                  </button>
                  <button
                    className="danger-action"
                    onClick={() => void removeAllRecipes()}
                    disabled={deletingAll || deleteAllText.trim().toUpperCase() !== "BORRAR"}
                  >
                    {deletingAll ? "Vaciando…" : "Borrar todas las recetas"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
