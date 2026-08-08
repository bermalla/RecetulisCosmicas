import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import type { Actor, Recipe, RecipeChange } from "./types";
import { applyChanges, GROUP_SCOPE, readCursor, readRecipes, replaceRecipes, writeCursor } from "./storage";

export const API_BASE = "https://mi-recetario.bermalla.chatgpt.site";

export async function authorizedFetch(path: string, init: RequestInit = {}) {
  const { token } = await FirebaseAuthentication.getIdToken();
  if (!token) throw new Error("Iniciá sesión para continuar.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

export async function validateSession(): Promise<Actor> {
  const response = await authorizedFetch("/api/auth/session", { cache: "no-store" });
  const data = (await response.json()) as { user?: Actor; error?: string };
  if (!response.ok || !data.user) throw new Error(data.error || "No se pudo validar el acceso.");
  return data.user;
}

export async function synchronize(): Promise<Recipe[]> {
  let cursor = await readCursor(GROUP_SCOPE);
  let hasMore = true;
  while (hasMore) {
    const response = await authorizedFetch(`/api/sync?after=${cursor}&limit=200`, { cache: "no-store" });
    const data = (await response.json()) as {
      mode?: "snapshot" | "changes";
      recipes?: Recipe[];
      changes?: RecipeChange[];
      cursor?: number;
      hasMore?: boolean;
      error?: string;
    };
    if (!response.ok) throw new Error(data.error || "No se pudo sincronizar la colección.");
    if (data.mode === "snapshot") await replaceRecipes(GROUP_SCOPE, data.recipes ?? []);
    else await applyChanges(GROUP_SCOPE, data.changes ?? []);
    cursor = Number(data.cursor ?? cursor);
    await writeCursor(GROUP_SCOPE, cursor);
    hasMore = Boolean(data.hasMore);
  }
  return readRecipes(GROUP_SCOPE);
}

export async function createOnlineRecipe(recipe: Omit<Recipe, "id">) {
  const response = await authorizedFetch("/api/recipes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipe }),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(data.error || "No se pudo guardar la receta.");
}
