import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import type { Actor, AuthSession, GroupInvitation, Recipe, RecipeChange } from "./types";
import { applyChanges, readCursor, readRecipes, replaceRecipes, writeCursor } from "./storage";

export type GroupMember = {
  id: string;
  email: string;
  display_name: string;
  role: "owner" | "editor" | "reader";
  created_at: string;
};

export type GroupInvite = {
  email: string;
  role: "editor" | "reader";
  created_at: string;
};

export const API_BASE = "https://mi-recetario.bermalla.chatgpt.site";

export async function authorizedFetch(path: string, init: RequestInit = {}) {
  const { token } = await FirebaseAuthentication.getIdToken();
  if (!token) throw new Error("Iniciá sesión para continuar.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

export async function validateSession(): Promise<AuthSession> {
  const response = await authorizedFetch("/api/auth/session?includeInvites=1", { cache: "no-store" });
  const data = (await response.json()) as {
    user?: AuthSession["account"];
    actor?: Actor | null;
    invitations?: GroupInvitation[];
    error?: string;
  };
  if (!response.ok || !data.user) throw new Error(data.error || "No se pudo validar el acceso.");
  return { account: data.user, actor: data.actor ?? null, invitations: data.invitations ?? [] };
}

export async function synchronize(scope: string, full = false): Promise<Recipe[]> {
  let cursor = full ? 0 : await readCursor(scope);
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
    if (data.mode === "snapshot") await replaceRecipes(scope, data.recipes ?? []);
    else await applyChanges(scope, data.changes ?? []);
    cursor = Number(data.cursor ?? cursor);
    await writeCursor(scope, cursor);
    hasMore = Boolean(data.hasMore);
  }
  return readRecipes(scope);
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

export async function updateOnlineRecipe(recipe: Recipe) {
  const response = await authorizedFetch("/api/recipes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipe, baseVersion: recipe.version ?? 1 }),
  });
  const data = (await response.json()) as { recipe?: Recipe; error?: string };
  if (!response.ok || !data.recipe) throw new Error(data.error || "No se pudo actualizar la receta.");
  return data.recipe;
}

export async function deleteOnlineRecipe(recipe: Recipe) {
  const query = new URLSearchParams({ id: recipe.id, version: String(recipe.version ?? 1) });
  const response = await authorizedFetch(`/api/recipes?${query.toString()}`, {
    method: "DELETE",
  });
  const data = (await response.json()) as { deleted?: string; error?: string };
  if (!response.ok) throw new Error(data.error || "No se pudo borrar la receta.");
}

export async function readGroupAccess(): Promise<{ members: GroupMember[]; invites: GroupInvite[] }> {
  const response = await authorizedFetch("/api/group/members", { cache: "no-store" });
  const data = (await response.json()) as { members?: GroupMember[]; invites?: GroupInvite[]; error?: string };
  if (!response.ok) throw new Error(data.error || "No se pudieron cargar los accesos.");
  return { members: data.members ?? [], invites: data.invites ?? [] };
}

export async function inviteGroupMember(email: string, role: "editor" | "reader") {
  const response = await authorizedFetch("/api/group/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role }),
  });
  const data = (await response.json()) as { invited?: string; error?: string };
  if (!response.ok || !data.invited) throw new Error(data.error || "No se pudo crear la invitación.");
  return data.invited;
}

export async function removeGroupAccess(email: string) {
  const response = await authorizedFetch(`/api/group/members?email=${encodeURIComponent(email)}`, { method: "DELETE" });
  const data = (await response.json()) as { removed?: string; error?: string };
  if (!response.ok) throw new Error(data.error || "No se pudo quitar el acceso.");
}

export async function acceptGroupInvitation(groupId: string): Promise<AuthSession> {
  const response = await authorizedFetch("/api/group/invitations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupId }),
  });
  const data = (await response.json()) as { actor?: Actor | null; invitations?: GroupInvitation[]; error?: string };
  if (!response.ok || !data.actor) throw new Error(data.error || "No se pudo aceptar la invitación.");
  return {
    account: data.actor,
    actor: data.actor,
    invitations: data.invitations ?? [],
  };
}

export async function declineGroupInvitation(groupId: string) {
  const response = await authorizedFetch("/api/group/invitations", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupId }),
  });
  const data = (await response.json()) as { invitations?: GroupInvitation[]; error?: string };
  if (!response.ok) throw new Error(data.error || "No se pudo rechazar la invitación.");
  return data.invitations ?? [];
}

export async function leaveCurrentGroup() {
  const response = await authorizedFetch("/api/group/membership", { method: "DELETE" });
  const data = (await response.json()) as { left?: string; error?: string };
  if (!response.ok) throw new Error(data.error || "No se pudo salir de la colección.");
}
