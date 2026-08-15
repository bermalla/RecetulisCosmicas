import { type FormEvent, type TouchEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share as NativeShare } from "@capacitor/share";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import {
  acceptGroupInvitation,
  createOwnCollection,
  createOnlineRecipe,
  deleteOnlineRecipe,
  declineGroupInvitation,
  inviteGroupMember,
  importOnlineRecipes,
  leaveCurrentGroup,
  readGroupAccess,
  removeGroupAccess,
  synchronize,
  updateOnlineRecipe,
  validateSession,
  type GroupInvite,
  type GroupMember,
} from "./api";
import { groupScope, LOCAL_SCOPE, putRecipe, readRecipes, removeRecipe, replaceRecipes } from "./storage";
import { filterRecipesByPantry, ingredientMatchesPantry } from "./recipe-filter";
import { filterRecipesByCategory, recipeCategoryOptions } from "./recipe-category";
import { mergeLocalRecipeImport, parseRecipeImport } from "./recipe-import";
import { ingredientSuggestionQuery, rankIngredientSuggestions, rankSuggestions, replaceActiveIngredient } from "./autocomplete";
import type { Account, Actor, AuthSession, GroupInvitation, Ingredient, Mode, Recipe } from "./types";
import { checkForUpdate, installUpdate, type MobileRelease } from "./updater";

type Status = "loading" | "signed-out" | "ready" | "error";
type Screen = "home" | "settings";

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function ingredientLabel(ingredient: Ingredient) {
  return [ingredient.quantity, ingredient.unit, ingredient.name].filter(Boolean).join(" ");
}

function parseIngredient(line: string): Ingredient | null {
  const clean = line.replace(/^[-•]\s*/, "").trim();
  if (!clean) return null;
  const match = clean.match(/^(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?)\s+(.+)$/);
  if (!match) return { name: clean };
  const [, quantity, remainder] = match;
  const unitMatch = remainder.match(/^([a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]+)\s+(.+)$/);
  const possibleUnit = unitMatch?.[1];
  const units = new Set(["g", "kg", "ml", "l", "taza", "tazas", "cda", "cdas", "cdta", "cdtas", "unidad", "unidades"]);
  if (possibleUnit && units.has(normalize(possibleUnit))) {
    return { name: unitMatch[2].trim(), quantity: quantity.replace(",", "."), unit: possibleUnit };
  }
  return { name: remainder.trim(), quantity: quantity.replace(",", ".") };
}

export default function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [account, setAccount] = useState<Account | null>(null);
  const [actor, setActor] = useState<Actor | null>(null);
  const [invitations, setInvitations] = useState<GroupInvitation[]>([]);
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem("recetulis-mobile-mode") === "offline" ? "offline" : "online"));
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState("");
  const [pantry, setPantry] = useState<string[]>([]);
  const [pantryInput, setPantryInput] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [message, setMessage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<MobileRelease | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateCheckError, setUpdateCheckError] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);

  const overlayRef = useRef({ selected: false, editing: false, add: false, screen: "home" as Screen });
  const pullRef = useRef({ active: false, startY: 0, distance: 0 });
  const refreshRef = useRef<(full?: boolean) => Promise<void>>(async () => undefined);
  useEffect(() => {
    overlayRef.current = { selected: Boolean(selectedRecipe), editing: Boolean(editingRecipe), add: showAdd, screen };
  }, [editingRecipe, screen, selectedRecipe, showAdd]);

  function openRecipe(recipe: Recipe) {
    overlayRef.current.selected = true;
    setSelectedRecipe(recipe);
  }

  function closeRecipe() {
    overlayRef.current.selected = false;
    overlayRef.current.editing = false;
    setEditingRecipe(null);
    setSelectedRecipe(null);
  }

  function closeEditor() {
    overlayRef.current.editing = false;
    setEditingRecipe(null);
  }

  function closeAddForm() {
    overlayRef.current.add = false;
    setShowAdd(false);
  }

  async function loadLocal(scope: string) {
    const cached = await readRecipes(scope);
    setRecipes(cached);
    return cached;
  }

  async function refreshOnline(groupId = actor?.groupId, full = false) {
    if (!groupId) return;
    const scope = groupScope(groupId);
    setSyncing(true);
    const cached = await loadLocal(scope);
    try {
      const synchronized = await synchronize(scope, full);
      setRecipes(synchronized);
      setMessage("");
    } catch (error) {
      if (cached.length === 0) throw error;
      setMessage("Sin conexión: estás viendo la última copia guardada.");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    refreshRef.current = (full = false) => refreshOnline(actor?.groupId, full);
  });

  function applySession(session: AuthSession) {
    setAccount(session.account);
    setActor(session.actor);
    setInvitations(session.invitations);
    setStatus("ready");
    if (!session.actor) {
      setRecipes([]);
      setScreen("settings");
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (mode === "offline") {
          await loadLocal(LOCAL_SCOPE);
          if (active) setStatus("ready");
          return;
        }
        const { user } = await FirebaseAuthentication.getCurrentUser();
        if (!user) {
          if (active) setStatus("signed-out");
          return;
        }
        const session = await validateSession();
        if (!active) return;
        applySession(session);
        if (session.actor) await refreshOnline(session.actor.groupId, true);
      } catch (error) {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "No se pudo iniciar la aplicación.");
        setStatus("error");
      }
    })();
    return () => { active = false; };
    // The selected mode is the only boot-time dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    let handle: { remove: () => Promise<void> } | undefined;
    let resumeHandle: { remove: () => Promise<void> } | undefined;
    void (async () => {
      await NativeApp.toggleBackButtonHandler({ enabled: true });
      const backListener = await NativeApp.addListener("backButton", async () => {
        const overlay = overlayRef.current;
        if (overlay.editing) { overlayRef.current.editing = false; setEditingRecipe(null); return; }
        if (overlay.selected) { overlayRef.current.selected = false; setSelectedRecipe(null); return; }
        if (overlay.add) { overlayRef.current.add = false; setShowAdd(false); return; }
        if (overlay.screen !== "home") { overlayRef.current.screen = "home"; setScreen("home"); return; }
        if (window.confirm("¿Querés salir de Recetulis Cósmicas?")) await NativeApp.exitApp();
      });
      if (cancelled) await backListener.remove();
      else handle = backListener;

      const foregroundListener = await NativeApp.addListener("resume", () => { void refreshRef.current(false); });
      if (cancelled) await foregroundListener.remove();
      else resumeHandle = foregroundListener;
    })();
    return () => { cancelled = true; void handle?.remove(); void resumeHandle?.remove(); };
  }, []);

  useEffect(() => {
    localStorage.removeItem("recetulis-mobile-pantry");
  }, []);

  useEffect(() => {
    if (status !== "ready" || (screen !== "settings" && !(mode === "online" && !actor))) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      setCheckingUpdate(true);
      setUpdateCheckError(false);
      void checkForUpdate()
        .then((release) => { if (active) setAvailableUpdate(release); })
        .catch(() => { if (active) setUpdateCheckError(true); })
        .finally(() => { if (active) setCheckingUpdate(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [actor, mode, screen, status]);

  async function signIn() {
    setStatus("loading");
    setMessage("");
    try {
      await FirebaseAuthentication.signInWithGoogle({ useCredentialManager: false });
      const session = await validateSession();
      applySession(session);
      if (session.actor) await refreshOnline(session.actor.groupId, true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo iniciar sesión.");
      setStatus("signed-out");
    }
  }

  async function signOut() {
    await FirebaseAuthentication.signOut();
    setAccount(null);
    setActor(null);
    setInvitations([]);
    setRecipes([]);
    setQuery("");
    setPantry([]);
    setPantryInput("");
    setFavoritesOnly(false);
    setSelectedCategory("");
    setStatus("signed-out");
    setScreen("home");
  }

  async function changeMode(next: Mode) {
    localStorage.setItem("recetulis-mobile-mode", next);
    setMode(next);
    closeRecipe();
    setQuery("");
    setPantry([]);
    setPantryInput("");
    setFavoritesOnly(false);
    setSelectedCategory("");
    setScreen("home");
    setStatus("loading");
  }

  function addPantry(suggestion = pantryInput) {
    const value = suggestion.trim();
    if (!value || pantry.some((item) => normalize(item) === normalize(value))) return;
    setPantry((current) => [...current, value]);
    setPantryInput("");
  }

  function startPull(event: TouchEvent<HTMLElement>) {
    if (mode !== "online" || !actor || syncing || window.scrollY > 0) return;
    pullRef.current = { active: true, startY: event.touches[0].clientY, distance: 0 };
  }

  function movePull(event: TouchEvent<HTMLElement>) {
    if (!pullRef.current.active || window.scrollY > 0) return;
    const distance = Math.min(110, Math.max(0, (event.touches[0].clientY - pullRef.current.startY) * 0.52));
    pullRef.current.distance = distance;
    setPullDistance(distance);
    if (distance > 0) event.preventDefault();
  }

  function finishPull() {
    if (!pullRef.current.active) return;
    const shouldRefresh = pullRef.current.distance >= 64;
    pullRef.current = { active: false, startY: 0, distance: 0 };
    setPullDistance(0);
    if (shouldRefresh) void refreshOnline(actor?.groupId, true);
  }

  const visibleRecipes = useMemo(() => {
    const cleanQuery = normalize(query);
    return filterRecipesByCategory(filterRecipesByPantry(recipes, pantry), selectedCategory)
      .filter((recipe) => !favoritesOnly || Boolean(recipe.favorite))
      .filter((recipe) => !cleanQuery || normalize(recipe.name).includes(cleanQuery))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [favoritesOnly, pantry, query, recipes, selectedCategory]);

  const recipeNameCandidates = useMemo(() => recipes.map((recipe) => recipe.name), [recipes]);
  const ingredientCandidates = useMemo(
    () => recipes.flatMap((recipe) => recipe.ingredients.map((ingredient) => ingredient.name)),
    [recipes],
  );
  const categoryOptions = useMemo(() => recipeCategoryOptions(recipes), [recipes]);
  const pantrySuggestions = useMemo(
    () => rankIngredientSuggestions(pantryInput, pantryInput.length, ingredientCandidates)
      .filter((suggestion) => !pantry.some((item) => normalize(item) === normalize(suggestion))),
    [ingredientCandidates, pantry, pantryInput],
  );
  const canModifyRecipes = mode === "offline" || actor?.role === "owner" || actor?.role === "editor";

  async function saveRecipe(draft: Omit<Recipe, "id">) {
    if (editingRecipe) {
      const candidate: Recipe = { ...editingRecipe, ...draft, id: editingRecipe.id };
      let saved: Recipe;
      if (mode === "online") {
        saved = await updateOnlineRecipe(candidate);
        await refreshOnline(actor?.groupId);
      } else {
        saved = {
          ...candidate,
          localOnly: true,
          version: Number(editingRecipe.version ?? 1) + 1,
          updatedAt: new Date().toISOString(),
        };
        await putRecipe(LOCAL_SCOPE, saved);
        await loadLocal(LOCAL_SCOPE);
      }
      setSelectedRecipe(saved);
      closeEditor();
      setMessage("Receta actualizada.");
      return;
    }

    if (mode === "online") {
      await createOnlineRecipe(draft);
      await refreshOnline(actor?.groupId);
    } else {
      const local: Recipe = {
        ...draft,
        id: crypto.randomUUID(),
        localOnly: true,
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      await putRecipe(LOCAL_SCOPE, local);
      await loadLocal(LOCAL_SCOPE);
    }
    closeAddForm();
    setMessage("Receta guardada.");
  }

  async function toggleFavorite(recipe: Recipe) {
    const candidate = { ...recipe, favorite: !recipe.favorite };
    let saved: Recipe;
    if (mode === "online") {
      saved = await updateOnlineRecipe(candidate);
      await refreshOnline(actor?.groupId);
    } else {
      saved = {
        ...candidate,
        localOnly: true,
        version: Number(recipe.version ?? 1) + 1,
        updatedAt: new Date().toISOString(),
      };
      await putRecipe(LOCAL_SCOPE, saved);
      await loadLocal(LOCAL_SCOPE);
    }
    setSelectedRecipe(saved);
  }

  async function deleteRecipe(recipe: Recipe) {
    if (!window.confirm(`¿Borrar definitivamente “${recipe.name}”?`)) return;
    if (mode === "online") {
      await deleteOnlineRecipe(recipe);
      await refreshOnline(actor?.groupId);
    } else {
      await removeRecipe(LOCAL_SCOPE, recipe.id);
      await loadLocal(LOCAL_SCOPE);
    }
    closeRecipe();
    setMessage("Receta borrada.");
  }

  if (status === "loading") return <AccessShell title="Preparando tu colección…" />;
  if ((status === "signed-out" || status === "error") && mode === "online") {
    return (
      <main className="access-shell">
        <section className="access-card">
          <p className="eyebrow">Colección privada</p>
          <h1>Recetulis Cósmicas</h1>
          <p>Entrá con una cuenta invitada al grupo.</p>
          {message && <p className="error">{message}</p>}
          <button className="primary" onClick={() => void signIn()}>Continuar con Google</button>
          <button className="secondary" onClick={() => void changeMode("offline")}>Usar colección local</button>
        </section>
      </main>
    );
  }

  if (screen === "settings" || (mode === "online" && !actor)) {
    return (
      <Settings
        account={account}
        actor={actor}
        invitations={invitations}
        mode={mode}
        recipes={recipes}
        message={message}
        availableUpdate={availableUpdate}
        checkingUpdate={checkingUpdate}
        updateCheckError={updateCheckError}
        onBack={() => { overlayRef.current.screen = "home"; setScreen("home"); }}
        onMode={changeMode}
        onSignOut={signOut}
        onAcceptInvitation={async (groupId) => {
          const session = await acceptGroupInvitation(groupId);
          applySession(session);
          if (session.actor) await refreshOnline(session.actor.groupId, true);
          setScreen("home");
          setMessage("Invitación aceptada.");
        }}
        onDeclineInvitation={async (groupId) => {
          setInvitations(await declineGroupInvitation(groupId));
          setMessage("Invitación rechazada.");
        }}
        onCreateCollection={async () => {
          const session = await createOwnCollection();
          applySession(session);
          if (session.actor) await refreshOnline(session.actor.groupId, true);
          setScreen("home");
          setMessage("Tu colección privada ya está lista.");
        }}
        onLeaveGroup={async () => {
          await leaveCurrentGroup();
          const session = await validateSession();
          applySession(session);
          setMessage("Saliste de la colección.");
        }}
        onInstallUpdate={async () => {
          if (!availableUpdate) return;
          try { await installUpdate(availableUpdate); }
          catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo iniciar la actualización."); }
        }}
        onImport={async (incoming) => {
          if (mode === "online") {
            if (!actor) throw new Error("Necesitás pertenecer a una colección para importar.");
            const result = await importOnlineRecipes(incoming);
            await refreshOnline(actor.groupId, true);
            setMessage(`${result.imported} recetas importadas${result.skipped ? `; ${result.skipped} duplicadas omitidas` : ""}.`);
            return;
          }
          const result = mergeLocalRecipeImport(recipes, incoming, () => crypto.randomUUID());
          await replaceRecipes(LOCAL_SCOPE, result.recipes);
          await loadLocal(LOCAL_SCOPE);
          setMessage(`${result.imported} recetas importadas${result.skipped ? `; ${result.skipped} duplicadas omitidas` : ""}.`);
        }}
      />
    );
  }

  return (
    <main className="app-shell" onTouchStart={startPull} onTouchMove={movePull} onTouchEnd={finishPull} onTouchCancel={finishPull}>
      <div className="pull-refresh" style={{ height: pullDistance }} aria-live="polite">
        <span>{pullDistance >= 64 ? "Soltá para actualizar" : "Deslizá para actualizar"}</span>
      </div>
      <header className="topbar">
        <div className="brand"><span>♨</span><strong>Recetulis Cósmicas</strong></div>
        <button className="icon-button" aria-label="Ajustes" onClick={() => { overlayRef.current.screen = "settings"; setScreen("settings"); }}>⚙</button>
      </header>

      <section className="hero">
        <p className="eyebrow">{mode === "offline" ? "Colección local" : actor?.groupName}</p>
        <h1>¿Qué cocinamos?</h1>
        <div className="pantry-autocomplete">
          <div className="pantry-input">
            <input value={pantryInput} onChange={(event) => setPantryInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addPantry(); }} placeholder="Sumá un ingrediente" />
            <button className="primary" onClick={() => addPantry()}>Agregar</button>
          </div>
          {pantrySuggestions.length > 0 && <SuggestionList suggestions={pantrySuggestions} onChoose={addPantry} />}
        </div>
        {pantry.length > 0 && <div className="chips">{pantry.map((item) => <button key={item} onClick={() => setPantry((current) => current.filter((value) => value !== item))}>{item} ×</button>)}</div>}
      </section>

      <section className="library">
        <div className="section-heading">
          <div><p className="eyebrow">Tu base</p><h2>{recipes.length} recetas</h2></div>
          <button className="primary compact" disabled={!canModifyRecipes} onClick={() => { overlayRef.current.add = true; setShowAdd(true); }}>+ Receta</button>
        </div>
        <input className="search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar receta" />
        <label className="category-filter">
          <span>Tipo de receta</span>
          <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
            <option value="">Todas las categorías</option>
            {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label} ({option.count})</option>)}
          </select>
        </label>
        <label className="favorite-filter"><input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} /><span>Mostrar sólo favoritas</span></label>
        {syncing && <p className="notice">Sincronizando…</p>}
        {message && <p className="notice">{message}</p>}
        <div className="recipe-list">
          {visibleRecipes.map((recipe) => (
            <button className="recipe-card" key={recipe.id} onClick={() => openRecipe(recipe)}>
              <div><span>{recipe.favorite ? "★ " : ""}{recipe.category || "Receta"}</span><h3>{recipe.name}</h3><p>{recipe.description || `${recipe.ingredients.length} ingredientes`}</p></div>
              <b>›</b>
            </button>
          ))}
          {!visibleRecipes.length && <div className="empty">{favoritesOnly ? "No hay recetas favoritas que coincidan con los filtros." : pantry.length > 0 ? "No hay recetas con esos ingredientes." : "Todavía no hay recetas en esta colección."}</div>}
        </div>
      </section>

      {selectedRecipe && <RecipeDetail recipe={selectedRecipe} pantry={pantry} canModify={canModifyRecipes} onClose={closeRecipe} onFavorite={toggleFavorite} onEdit={() => { overlayRef.current.editing = true; setEditingRecipe(selectedRecipe); }} onDelete={deleteRecipe} />}
      {(showAdd || editingRecipe) && <RecipeForm mode={mode} recipe={editingRecipe} recipeNames={recipeNameCandidates} ingredientNames={ingredientCandidates} onClose={editingRecipe ? closeEditor : closeAddForm} onSave={saveRecipe} />}
    </main>
  );
}

function AccessShell({ title }: { title: string }) {
  return <main className="access-shell"><section className="access-card"><p className="eyebrow">Recetulis Cósmicas</p><h1>{title}</h1></section></main>;
}

function RecipeDetail({ recipe, pantry, canModify, onClose, onFavorite, onEdit, onDelete }: {
  recipe: Recipe;
  pantry: string[];
  canModify: boolean;
  onClose: () => void;
  onFavorite: (recipe: Recipe) => Promise<void>;
  onEdit: () => void;
  onDelete: (recipe: Recipe) => Promise<void>;
}) {
  const hasIngredient = (ingredient: Ingredient) => pantry.some((item) => ingredientMatchesPantry(ingredient, item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>) {
    setSaving(true);
    setError("");
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "No se pudo modificar la receta.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <article className="modal detail" role="dialog" aria-modal="true" aria-labelledby="recipe-title">
        <button className="modal-close" onClick={onClose} aria-label="Cerrar receta">×</button>
        <button className={`favorite-star ${recipe.favorite ? "selected" : ""}`} disabled={!canModify || saving} aria-pressed={Boolean(recipe.favorite)} aria-label={recipe.favorite ? "Quitar de favoritas" : "Marcar como favorita"} onClick={() => void run(() => onFavorite(recipe))}>{recipe.favorite ? "★" : "☆"}</button>
        <p className="eyebrow">{recipe.category || "Receta"}</p>
        <h2 id="recipe-title">{recipe.name}</h2>
        <p className="description">{recipe.description}</p>
        {recipe.nutrients?.length > 0 && <div className="chips static">{recipe.nutrients.map((item) => <span key={item}>{item}</span>)}</div>}
        <section><h3>Ingredientes</h3><ul>{recipe.ingredients.map((ingredient, index) => <li className={hasIngredient(ingredient) ? "available" : ""} key={`${ingredient.name}-${index}`}><span>{hasIngredient(ingredient) ? "✓" : "○"}</span>{ingredientLabel(ingredient)}</li>)}</ul></section>
        <section><h3>Preparación</h3><ol>{recipe.instructions.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol></section>
        {error && <p className="error" role="alert">{error}</p>}
        {canModify && <section className="detail-actions"><button className="primary" disabled={saving} onClick={onEdit}>Editar receta</button><button className="danger" disabled={saving} onClick={() => void run(() => onDelete(recipe))}>Borrar receta</button></section>}
      </article>
    </div>
  );
}

function RecipeForm({ mode, recipe, recipeNames, ingredientNames, onClose, onSave }: {
  mode: Mode;
  recipe: Recipe | null;
  recipeNames: string[];
  ingredientNames: string[];
  onClose: () => void;
  onSave: (recipe: Omit<Recipe, "id">) => Promise<void>;
}) {
  const [name, setName] = useState(recipe?.name ?? "");
  const [description, setDescription] = useState(recipe?.description ?? "");
  const [category, setCategory] = useState(recipe?.category ?? "");
  const [ingredients, setIngredients] = useState(() => recipe?.ingredients.map(ingredientLabel).join("\n") ?? "");
  const [instructions, setInstructions] = useState(() => recipe?.instructions.join("\n") ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeField, setActiveField] = useState<"name" | "ingredients" | null>(null);
  const [ingredientCursor, setIngredientCursor] = useState(0);
  const ingredientRef = useRef<HTMLTextAreaElement>(null);
  const nameSuggestions = useMemo(
    () => rankSuggestions(name, recipeNames).filter((suggestion) => normalize(suggestion) !== normalize(name)),
    [name, recipeNames],
  );
  const ingredientQuery = ingredientSuggestionQuery(ingredients, ingredientCursor);
  const ingredientSuggestions = useMemo(
    () => rankIngredientSuggestions(ingredients, ingredientCursor, ingredientNames)
      .filter((suggestion) => normalize(suggestion) !== normalize(ingredientQuery)),
    [ingredientCursor, ingredientNames, ingredientQuery, ingredients],
  );

  function chooseIngredient(suggestion: string) {
    const replacement = replaceActiveIngredient(ingredients, ingredientCursor, suggestion);
    setIngredients(replacement.value);
    setIngredientCursor(replacement.cursor);
    setActiveField(null);
    window.requestAnimationFrame(() => {
      ingredientRef.current?.focus();
      ingredientRef.current?.setSelectionRange(replacement.cursor, replacement.cursor);
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsedIngredients = ingredients.split(/\r?\n/).map(parseIngredient).filter((item): item is Ingredient => Boolean(item));
    if (!name.trim() || parsedIngredients.length === 0) { setError("Ingresá un nombre y al menos un ingrediente."); return; }
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        category: category.trim(),
        ingredients: parsedIngredients,
        instructions: instructions.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        nutrients: recipe?.nutrients ?? [],
        durationMinutes: recipe?.durationMinutes,
        servings: recipe?.servings,
        image: recipe?.image,
        sourceUrl: recipe?.sourceUrl,
        favorite: recipe?.favorite ?? false,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar.");
      setSaving(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section className="modal form" role="dialog" aria-modal="true" aria-labelledby="recipe-form-title">
        <button className="modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        <p className="eyebrow">{mode === "offline" ? "Colección local" : "Base grupal"}</p><h2 id="recipe-form-title">{recipe ? "Editar receta" : "Nueva receta"}</h2>
        <form onSubmit={submit}>
          <label className="autocomplete-field">Nombre<input required value={name} onFocus={() => setActiveField("name")} onChange={(event) => { setName(event.target.value); setActiveField("name"); }} />{activeField === "name" && nameSuggestions.length > 0 && <SuggestionList suggestions={nameSuggestions} onChoose={(suggestion) => { setName(suggestion); setActiveField(null); }} />}</label>
          <label>Descripción<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <label>Categoría<input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Cena, desayuno…" /></label>
          <label className="autocomplete-field">Ingredientes: cada renglón se guarda por separado<textarea ref={ingredientRef} required rows={7} value={ingredients} onFocus={(event) => { setIngredientCursor(event.currentTarget.selectionStart); setActiveField("ingredients"); }} onClick={(event) => setIngredientCursor(event.currentTarget.selectionStart)} onKeyUp={(event) => setIngredientCursor(event.currentTarget.selectionStart)} onChange={(event) => { setIngredients(event.target.value); setIngredientCursor(event.target.selectionStart); setActiveField("ingredients"); }} placeholder={"2 tazas harina\n1 huevo\nSal"} />{activeField === "ingredients" && ingredientSuggestions.length > 0 && <SuggestionList suggestions={ingredientSuggestions} onChoose={chooseIngredient} />}</label>
          <label>Preparación, un paso por línea<textarea rows={7} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
          {error && <p className="error">{error}</p>}
          <div className="form-actions"><button type="submit" className="primary" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button><button type="button" className="secondary" disabled={saving} onClick={onClose}>Cancelar</button></div>
        </form>
      </section>
    </div>
  );
}

function SuggestionList({ suggestions, onChoose }: { suggestions: string[]; onChoose: (suggestion: string) => void }) {
  return <div className="suggestions" role="listbox">{suggestions.slice(0, 5).map((suggestion) => <button type="button" role="option" aria-selected="false" key={suggestion} onMouseDown={(event) => event.preventDefault()} onClick={() => onChoose(suggestion)}>{suggestion}</button>)}</div>;
}

function Settings({ account, actor, invitations, mode, recipes, message, availableUpdate, checkingUpdate, updateCheckError, onBack, onMode, onSignOut, onAcceptInvitation, onDeclineInvitation, onCreateCollection, onLeaveGroup, onInstallUpdate, onImport }: {
  account: Account | null; actor: Actor | null; invitations: GroupInvitation[]; mode: Mode; recipes: Recipe[]; message: string; availableUpdate: MobileRelease | null; checkingUpdate: boolean; updateCheckError: boolean; onBack: () => void; onMode: (mode: Mode) => Promise<void>; onSignOut: () => Promise<void>; onAcceptInvitation: (groupId: string) => Promise<void>; onDeclineInvitation: (groupId: string) => Promise<void>; onCreateCollection: () => Promise<void>; onLeaveGroup: () => Promise<void>; onInstallUpdate: () => Promise<void>; onImport: (recipes: Recipe[]) => Promise<void>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "reader">("editor");
  const [accessMessage, setAccessMessage] = useState("");
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);
  const [importing, setImporting] = useState(false);
  const canImport = mode === "offline" || actor?.role === "owner" || actor?.role === "editor";

  const loadAccess = useCallback(async () => {
    if (mode !== "online" || actor?.role !== "owner") return;
    setLoadingAccess(true);
    try {
      const access = await readGroupAccess();
      setMembers(access.members);
      setInvites(access.invites);
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : "No se pudieron cargar los accesos.");
    } finally {
      setLoadingAccess(false);
    }
  }, [actor?.role, mode]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadAccess(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadAccess]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    setSavingAccess(true);
    setAccessMessage("");
    try {
      const invited = await inviteGroupMember(inviteEmail, inviteRole);
      setInviteEmail("");
      setAccessMessage(`Invitación preparada para ${invited}.`);
      await loadAccess();
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : "No se pudo crear la invitación.");
    } finally {
      setSavingAccess(false);
    }
  }

  async function removeAccess(email: string) {
    if (!window.confirm(`¿Quitar el acceso de ${email}?`)) return;
    setSavingAccess(true);
    setAccessMessage("");
    try {
      await removeGroupAccess(email);
      setAccessMessage(`Se quitó el acceso de ${email}.`);
      await loadAccess();
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : "No se pudo quitar el acceso.");
    } finally {
      setSavingAccess(false);
    }
  }

  async function runMembershipAction(action: () => Promise<void>) {
    setSavingAccess(true);
    setAccessMessage("");
    try {
      await action();
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : "No se pudo actualizar la pertenencia.");
    } finally {
      setSavingAccess(false);
    }
  }

  async function exportData() {
    const payload = { format: "recetulis-cosmicas", formatVersion: 1, mode, exportedAt: new Date().toISOString(), recipes };
    const contents = JSON.stringify(payload, null, 2);
    const fileName = `recetulis-${mode}-${new Date().toISOString().slice(0, 10)}.json`;
    if (Capacitor.isNativePlatform()) {
      const saved = await Filesystem.writeFile({ path: fileName, data: contents, directory: Directory.Cache, encoding: Encoding.UTF8 });
      await NativeShare.share({ title: "Respaldo de Recetulis", files: [saved.uri], dialogTitle: "Guardar o compartir respaldo" });
      return;
    }
    const href = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
    const link = document.createElement("a"); link.href = href; link.download = `recetulis-${mode}-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(href);
  }
  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > 2_000_000) throw new Error("El respaldo supera el máximo de 2 MB.");
    const incoming = parseRecipeImport(await file.text());
    if (!window.confirm(`¿Sumar ${incoming.length} recetas a la colección actual? Las duplicadas se omitirán.`)) return;
    setImporting(true);
    try { await onImport(incoming); }
    finally { setImporting(false); }
  }
  return (
    <main className="app-shell settings">
      <header className="topbar">{(mode === "offline" || actor) ? <button className="secondary compact" onClick={onBack}>← Volver</button> : <span />}<strong>Ajustes</strong></header>
      <section className="settings-card"><p className="eyebrow">Modo actual</p><h2>{mode === "offline" ? "Colección local" : actor?.groupName || "Sin colección"}</h2><p>{mode === "offline" ? "Funciona solamente en este dispositivo." : `${account?.email || "Cuenta conectada"}${actor ? ` · ${actor.role}` : " · sin pertenencia activa"}`}</p>{mode === "offline" ? <button className="primary" onClick={() => void onMode("online")}>Volver al modo online</button> : <button className="secondary" onClick={() => void onMode("offline")}>Usar colección local</button>}</section>
      {mode === "online" && invitations.length > 0 && (
        <section className="settings-card access-management">
          <p className="eyebrow">Invitaciones</p>
          <h2>Colecciones disponibles</h2>
          {actor && <p>Para aceptar otra invitación, primero tenés que salir de tu colección actual.</p>}
          <div className="member-list">
            {invitations.map((invitation) => (
              <div className="invitation-card" key={invitation.groupId}>
                <div><strong>{invitation.groupName}</strong><span>De {invitation.ownerName} · {invitation.role === "editor" ? "puede editar" : "sólo lectura"}</span></div>
                <div className="invitation-actions">
                  <button className="primary compact" disabled={savingAccess || Boolean(actor)} onClick={() => void runMembershipAction(() => onAcceptInvitation(invitation.groupId))}>Aceptar</button>
                  <button className="secondary compact" disabled={savingAccess} onClick={() => void runMembershipAction(() => onDeclineInvitation(invitation.groupId))}>Rechazar</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {mode === "online" && !actor && invitations.length === 0 && (
        <section className="settings-card"><p className="eyebrow">Colección privada</p><h2>Creá tu propia colección</h2><p>No hay invitaciones para {account?.email}. Podés iniciar una colección vacía y separada de todas las demás.</p><button className="primary" disabled={savingAccess} onClick={() => void runMembershipAction(onCreateCollection)}>Crear mi colección</button></section>
      )}
      {mode === "online" && actor?.role === "owner" && (
        <section className="settings-card access-management">
          <p className="eyebrow">Colección privada</p>
          <h2>Personas con acceso</h2>
          <p>La persona verá esta invitación en Ajustes y decidirá si quiere aceptarla.</p>
          <form className="invite-form" onSubmit={(event) => void invite(event)}>
            <label>Correo<input type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="persona@gmail.com" /></label>
            <label>Permiso<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "editor" | "reader")}><option value="editor">Puede editar</option><option value="reader">Sólo lectura</option></select></label>
            <button className="primary" type="submit" disabled={savingAccess}>Invitar</button>
          </form>
          {loadingAccess ? <p>Cargando accesos…</p> : (
            <div className="member-list">
              {members.map((member) => (
                <div className="member-row" key={member.email}>
                  <div><strong>{member.display_name || member.email}</strong><span>{member.email} · {member.role === "owner" ? "propietario" : member.role === "editor" ? "puede editar" : "sólo lectura"}</span></div>
                  {member.role !== "owner" && <button className="danger compact" disabled={savingAccess} onClick={() => void removeAccess(member.email)}>Quitar</button>}
                </div>
              ))}
              {invites.map((pending) => (
                <div className="member-row pending" key={pending.email}>
                  <div><strong>{pending.email}</strong><span>Invitación pendiente · {pending.role === "editor" ? "puede editar" : "sólo lectura"}</span></div>
                  <button className="danger compact" disabled={savingAccess} onClick={() => void removeAccess(pending.email)}>Cancelar</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {mode === "online" && actor && actor.role !== "owner" && (
        <section className="settings-card"><p className="eyebrow">Pertenencia</p><h2>Salir de esta colección</h2><p>La copia local queda guardada, pero dejarás de recibir cambios y podrás aceptar otra invitación.</p><button className="danger" disabled={savingAccess} onClick={() => { if (window.confirm(`¿Salir de ${actor.groupName}?`)) void runMembershipAction(onLeaveGroup); }}>Salir del grupo</button></section>
      )}
      <section className="settings-card"><p className="eyebrow">Respaldo</p><h2>Copias de emergencia</h2><button className="primary" onClick={() => void exportData().catch((error) => alert(error.message))}>Exportar JSON</button><button className="secondary" disabled={!canImport || importing} onClick={() => fileInput.current?.click()}>{importing ? "Importando…" : "Importar JSON"}</button><input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; void importFile(file).catch((error) => alert(error.message)); }} />{!canImport && <small>Necesitás permiso de edición para importar en esta colección.</small>}</section>
      <section className="settings-card"><p className="eyebrow">Actualizaciones</p>{checkingUpdate ? <><h2>Buscando una nueva versión…</h2><p>Esta revisión se realiza cada vez que entrás a Ajustes.</p></> : availableUpdate ? <><h2>Versión {availableUpdate.versionName} disponible</h2><p>{availableUpdate.notes || "Incluye mejoras y correcciones."}</p><button className="primary" onClick={() => void onInstallUpdate()}>Descargar e instalar</button></> : updateCheckError ? <><h2>No se pudo revisar ahora</h2><p>Comprobá la conexión y volvé a entrar a Ajustes.</p></> : <><h2>La app está actualizada</h2><p>No hay una versión más reciente disponible.</p></>}</section>
      {mode === "online" && <section className="settings-card"><button className="danger" onClick={() => void onSignOut()}>Cerrar sesión</button></section>}
      {accessMessage && <p className="notice" role="status">{accessMessage}</p>}
      {message && <p className="notice">{message}</p>}
    </main>
  );
}
