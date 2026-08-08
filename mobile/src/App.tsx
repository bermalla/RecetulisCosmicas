import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share as NativeShare } from "@capacitor/share";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import {
  createOnlineRecipe,
  inviteGroupMember,
  readGroupAccess,
  removeGroupAccess,
  synchronize,
  validateSession,
  type GroupInvite,
  type GroupMember,
} from "./api";
import { GROUP_SCOPE, LOCAL_SCOPE, putRecipe, readRecipes, replaceRecipes } from "./storage";
import type { Actor, Ingredient, Mode, Recipe } from "./types";
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
  const match = clean.match(/^(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|\d+\/\d+)?\s*([a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]+)?\s+(.+)$/);
  if (!match) return { name: clean };
  const [, quantity, possibleUnit, rest] = match;
  const units = new Set(["g", "kg", "ml", "l", "taza", "tazas", "cda", "cdas", "cdta", "cdtas", "unidad", "unidades"]);
  if (possibleUnit && units.has(normalize(possibleUnit))) {
    return { name: rest.trim(), quantity: quantity?.replace(",", ".") || null, unit: possibleUnit };
  }
  return { name: [possibleUnit, rest].filter(Boolean).join(" ").trim(), quantity: quantity?.replace(",", ".") || null };
}

export default function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [actor, setActor] = useState<Actor | null>(null);
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem("recetulis-mobile-mode") === "offline" ? "offline" : "online"));
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState("");
  const [pantry, setPantry] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("recetulis-mobile-pantry") ?? "[]") as string[]; }
    catch { return []; }
  });
  const [pantryInput, setPantryInput] = useState("");
  const [message, setMessage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<MobileRelease | null>(null);

  const overlayRef = useRef({ selected: false, add: false, screen: "home" as Screen });
  useEffect(() => {
    overlayRef.current = { selected: Boolean(selectedRecipe), add: showAdd, screen };
  }, [screen, selectedRecipe, showAdd]);

  async function loadLocal(scope = mode === "offline" ? LOCAL_SCOPE : GROUP_SCOPE) {
    const cached = await readRecipes(scope);
    setRecipes(cached);
    return cached;
  }

  async function refreshOnline() {
    setSyncing(true);
    const cached = await loadLocal(GROUP_SCOPE);
    try {
      const synchronized = await synchronize();
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
        setActor(session);
        setStatus("ready");
        await refreshOnline();
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
    let handle: { remove: () => Promise<void> } | undefined;
    void NativeApp.addListener("backButton", async () => {
      const overlay = overlayRef.current;
      if (overlay.selected) { setSelectedRecipe(null); return; }
      if (overlay.add) { setShowAdd(false); return; }
      if (overlay.screen !== "home") { setScreen("home"); return; }
      await NativeApp.minimizeApp();
    }).then((listener) => { handle = listener; });
    return () => { void handle?.remove(); };
  }, []);

  useEffect(() => {
    localStorage.setItem("recetulis-mobile-pantry", JSON.stringify(pantry));
  }, [pantry]);

  useEffect(() => {
    void checkForUpdate().then(setAvailableUpdate).catch(() => null);
  }, []);

  async function signIn() {
    setStatus("loading");
    setMessage("");
    try {
      await FirebaseAuthentication.signInWithGoogle({ useCredentialManager: false });
      const session = await validateSession();
      setActor(session);
      setStatus("ready");
      await refreshOnline();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo iniciar sesión.");
      setStatus("signed-out");
    }
  }

  async function signOut() {
    await FirebaseAuthentication.signOut();
    setActor(null);
    setRecipes([]);
    setStatus("signed-out");
    setScreen("home");
  }

  async function changeMode(next: Mode) {
    localStorage.setItem("recetulis-mobile-mode", next);
    setMode(next);
    setSelectedRecipe(null);
    setScreen("home");
    setStatus("loading");
  }

  function addPantry() {
    const value = pantryInput.trim();
    if (!value || pantry.some((item) => normalize(item) === normalize(value))) return;
    setPantry((current) => [...current, value]);
    setPantryInput("");
  }

  const visibleRecipes = useMemo(() => {
    const cleanQuery = normalize(query);
    return recipes
      .filter((recipe) => !cleanQuery || normalize(recipe.name).includes(cleanQuery))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [query, recipes]);

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

  if (screen === "settings") {
    return (
      <Settings
        actor={actor}
        mode={mode}
        recipes={recipes}
        message={message}
        availableUpdate={availableUpdate}
        onBack={() => setScreen("home")}
        onMode={changeMode}
        onSignOut={signOut}
        onInstallUpdate={async () => {
          if (!availableUpdate) return;
          try { await installUpdate(availableUpdate); }
          catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo iniciar la actualización."); }
        }}
        onImport={async (incoming) => {
          const scope = mode === "offline" ? LOCAL_SCOPE : GROUP_SCOPE;
          if (mode === "online") throw new Error("Importá a la base grupal desde la web para conservar la revisión de duplicados.");
          await replaceRecipes(scope, incoming.map((recipe) => ({ ...recipe, id: recipe.id || crypto.randomUUID(), localOnly: true })));
          await loadLocal(scope);
          setMessage("Respaldo importado en la colección local.");
        }}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span>♨</span><strong>Recetulis Cósmicas</strong></div>
        <button className="icon-button" aria-label="Ajustes" onClick={() => setScreen("settings")}>⚙</button>
      </header>

      <section className="hero">
        <p className="eyebrow">{mode === "offline" ? "Colección local" : actor?.groupName}</p>
        <h1>¿Qué cocinamos?</h1>
        <div className="pantry-input">
          <input value={pantryInput} onChange={(event) => setPantryInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addPantry(); }} placeholder="Sumá un ingrediente" />
          <button className="primary" onClick={addPantry}>Agregar</button>
        </div>
        {pantry.length > 0 && <div className="chips">{pantry.map((item) => <button key={item} onClick={() => setPantry((current) => current.filter((value) => value !== item))}>{item} ×</button>)}</div>}
      </section>

      <section className="library">
        <div className="section-heading">
          <div><p className="eyebrow">Tu base</p><h2>{recipes.length} recetas</h2></div>
          <button className="primary compact" disabled={mode === "online" && actor?.role === "reader"} onClick={() => setShowAdd(true)}>+ Receta</button>
        </div>
        <input className="search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar receta" />
        {syncing && <p className="notice">Sincronizando…</p>}
        {message && <p className="notice">{message}</p>}
        <div className="recipe-list">
          {visibleRecipes.map((recipe) => (
            <button className="recipe-card" key={recipe.id} onClick={() => setSelectedRecipe(recipe)}>
              <div><span>{recipe.category || "Receta"}</span><h3>{recipe.name}</h3><p>{recipe.description || `${recipe.ingredients.length} ingredientes`}</p></div>
              <b>›</b>
            </button>
          ))}
          {!visibleRecipes.length && <div className="empty">Todavía no hay recetas en esta colección.</div>}
        </div>
      </section>

      {selectedRecipe && <RecipeDetail recipe={selectedRecipe} pantry={pantry} onClose={() => setSelectedRecipe(null)} />}
      {showAdd && <RecipeForm mode={mode} onClose={() => setShowAdd(false)} onSave={async (recipe) => {
        if (mode === "online") {
          await createOnlineRecipe(recipe);
          await refreshOnline();
        } else {
          const local: Recipe = { ...recipe, id: crypto.randomUUID(), localOnly: true, version: 1, updatedAt: new Date().toISOString() };
          await putRecipe(LOCAL_SCOPE, local);
          await loadLocal(LOCAL_SCOPE);
        }
        setShowAdd(false);
        setMessage("Receta guardada.");
      }} />}
    </main>
  );
}

function AccessShell({ title }: { title: string }) {
  return <main className="access-shell"><section className="access-card"><p className="eyebrow">Recetulis Cósmicas</p><h1>{title}</h1></section></main>;
}

function RecipeDetail({ recipe, pantry, onClose }: { recipe: Recipe; pantry: string[]; onClose: () => void }) {
  const hasIngredient = (ingredient: Ingredient) => pantry.some((item) => normalize(ingredient.name).includes(normalize(item)) || normalize(item).includes(normalize(ingredient.name)));
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <article className="modal detail" role="dialog" aria-modal="true" aria-labelledby="recipe-title">
        <button className="modal-close" onClick={onClose} aria-label="Cerrar receta">×</button>
        <p className="eyebrow">{recipe.category || "Receta"}</p>
        <h2 id="recipe-title">{recipe.name}</h2>
        <p className="description">{recipe.description}</p>
        {recipe.nutrients?.length > 0 && <div className="chips static">{recipe.nutrients.map((item) => <span key={item}>{item}</span>)}</div>}
        <section><h3>Ingredientes</h3><ul>{recipe.ingredients.map((ingredient, index) => <li className={hasIngredient(ingredient) ? "available" : ""} key={`${ingredient.name}-${index}`}><span>{hasIngredient(ingredient) ? "✓" : "○"}</span>{ingredientLabel(ingredient)}</li>)}</ul></section>
        <section><h3>Preparación</h3><ol>{recipe.instructions.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol></section>
      </article>
    </div>
  );
}

function RecipeForm({ mode, onClose, onSave }: { mode: Mode; onClose: () => void; onSave: (recipe: Omit<Recipe, "id">) => Promise<void> }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsedIngredients = ingredients.split(/\r?\n/).map(parseIngredient).filter((item): item is Ingredient => Boolean(item));
    if (!name.trim() || parsedIngredients.length === 0) { setError("Ingresá un nombre y al menos un ingrediente."); return; }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), description: description.trim(), category: category.trim(), ingredients: parsedIngredients, instructions: instructions.split(/\r?\n/).map((item) => item.trim()).filter(Boolean), nutrients: [] });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar.");
      setSaving(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section className="modal form" role="dialog" aria-modal="true" aria-labelledby="new-title">
        <button className="modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        <p className="eyebrow">{mode === "offline" ? "Colección local" : "Base grupal"}</p><h2 id="new-title">Nueva receta</h2>
        <form onSubmit={submit}>
          <label>Nombre<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Descripción<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <label>Categoría<input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Cena, desayuno…" /></label>
          <label>Ingredientes, uno por línea<textarea required rows={7} value={ingredients} onChange={(event) => setIngredients(event.target.value)} placeholder="2 tazas harina" /></label>
          <label>Preparación, un paso por línea<textarea rows={7} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={saving}>{saving ? "Guardando…" : "Guardar receta"}</button>
        </form>
      </section>
    </div>
  );
}

function Settings({ actor, mode, recipes, message, availableUpdate, onBack, onMode, onSignOut, onInstallUpdate, onImport }: {
  actor: Actor | null; mode: Mode; recipes: Recipe[]; message: string; availableUpdate: MobileRelease | null; onBack: () => void; onMode: (mode: Mode) => Promise<void>; onSignOut: () => Promise<void>; onInstallUpdate: () => Promise<void>; onImport: (recipes: Recipe[]) => Promise<void>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "reader">("editor");
  const [accessMessage, setAccessMessage] = useState("");
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);

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
    const payload = JSON.parse(await file.text()) as { recipes?: Recipe[] } | Recipe[];
    const incoming = Array.isArray(payload) ? payload : payload.recipes;
    if (!Array.isArray(incoming)) throw new Error("El archivo no contiene recetas.");
    if (incoming.length > 500) throw new Error("El respaldo supera las 500 recetas.");
    if (incoming.some((recipe) => !recipe || typeof recipe.name !== "string" || !Array.isArray(recipe.ingredients))) {
      throw new Error("El respaldo contiene recetas con un formato inválido.");
    }
    await onImport(incoming);
  }
  return (
    <main className="app-shell settings">
      <header className="topbar"><button className="secondary compact" onClick={onBack}>← Volver</button><strong>Ajustes</strong></header>
      <section className="settings-card"><p className="eyebrow">Modo actual</p><h2>{mode === "offline" ? "Colección local" : actor?.groupName}</h2><p>{mode === "offline" ? "Funciona solamente en este dispositivo." : `${actor?.email} · ${actor?.role}`}</p>{mode === "offline" ? <button className="primary" onClick={() => void onMode("online")}>Volver al modo online</button> : <button className="secondary" onClick={() => void onMode("offline")}>Usar colección local</button>}</section>
      {mode === "online" && actor?.role === "owner" && (
        <section className="settings-card access-management">
          <p className="eyebrow">Colección privada</p>
          <h2>Personas con acceso</h2>
          <p>La invitación se activa cuando ese correo inicia sesión con Google.</p>
          <form className="invite-form" onSubmit={(event) => void invite(event)}>
            <label>Correo<input type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="persona@gmail.com" /></label>
            <label>Permiso<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "editor" | "reader")}><option value="editor">Puede editar</option><option value="reader">Sólo lectura</option></select></label>
            <button className="primary" type="submit" disabled={savingAccess}>Invitar</button>
          </form>
          {accessMessage && <p className="notice" role="status">{accessMessage}</p>}
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
      <section className="settings-card"><p className="eyebrow">Respaldo</p><h2>Copias de emergencia</h2><button className="primary" onClick={() => void exportData().catch((error) => alert(error.message))}>Exportar JSON</button>{mode === "offline" && <><button className="secondary" onClick={() => fileInput.current?.click()}>Importar JSON local</button><input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={(event) => void importFile(event.target.files?.[0]).catch((error) => alert(error.message))} /></>}</section>
      {availableUpdate && <section className="settings-card"><p className="eyebrow">Actualización disponible</p><h2>Versión {availableUpdate.versionName}</h2><p>{availableUpdate.notes || "Incluye mejoras y correcciones."}</p><button className="primary" onClick={() => void onInstallUpdate()}>Descargar e instalar</button></section>}
      {mode === "online" && <section className="settings-card"><button className="danger" onClick={() => void onSignOut()}>Cerrar sesión</button></section>}
      {message && <p className="notice">{message}</p>}
    </main>
  );
}
