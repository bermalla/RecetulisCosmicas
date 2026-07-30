"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Recipe = {
  id: string;
  name: string;
  description: string;
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

export default function RecipesLibrary() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    async function loadInitialRecipes() {
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
    void loadInitialRecipes();
  }, []);

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
      const response = await fetch(`/api/recipes?id=${encodeURIComponent(recipe.id)}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo eliminar la receta.");
      setRecipes((current) => current.filter((item) => item.id !== recipe.id));
      notify("Receta eliminada.");
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "No se pudo eliminar la receta.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Volver al buscador">
          <span className="brand-mark" aria-hidden="true">♨</span>
          <span>Mi Recetario</span>
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
                  <div className="library-letter" aria-hidden="true">{recipe.name.slice(0, 1)}</div>
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
                    disabled={deletingId === recipe.id}
                  >
                    {deletingId === recipe.id ? "Eliminando…" : "Quitar de la base"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
