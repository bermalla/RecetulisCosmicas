"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AccessGate, useAuth } from "../auth-provider";
import {
  GROUP_SCOPE,
  LOCAL_SCOPE,
  readRecipes,
  replaceRecipes,
} from "../../lib/offline-store";
import {
  createRecipeExportParts,
  downloadRecipeExportParts,
  fetchRecipeExportParts,
  type RecipeExportPayload,
} from "../../lib/recipe-export";

type Member = {
  id: string;
  email: string;
  display_name: string;
  role: "owner" | "editor" | "reader";
  created_at: string;
};

type Invite = {
  email: string;
  role: "editor" | "reader";
  created_at: string;
};

export default function SettingsPage() {
  return <AccessGate><Settings /></AccessGate>;
}

function Settings() {
  const auth = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "reader">("editor");
  const [message, setMessage] = useState("");
  const [loadingMembers, setLoadingMembers] = useState(false);

  const loadMembers = useCallback(async () => {
    if (auth.mode !== "online" || auth.actor?.role !== "owner") return;
    setLoadingMembers(true);
    try {
      const response = await auth.authorizedFetch("/api/group/members", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar los accesos.");
      setMembers(data.members ?? []);
      setInvites(data.invites ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron cargar los accesos.");
    } finally {
      setLoadingMembers(false);
    }
  }, [auth]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadMembers(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadMembers]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await auth.authorizedFetch("/api/group/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo crear la invitación.");
      setEmail("");
      setMessage(`Invitación preparada para ${data.invited}.`);
      await loadMembers();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo crear la invitación.");
    }
  }

  async function removeAccess(memberEmail: string) {
    if (!window.confirm(`¿Quitar el acceso de ${memberEmail}?`)) return;
    try {
      const response = await auth.authorizedFetch(
        `/api/group/members?email=${encodeURIComponent(memberEmail)}`,
        { method: "DELETE" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo quitar el acceso.");
      setMessage(`Se quitó el acceso de ${memberEmail}.`);
      await loadMembers();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo quitar el acceso.");
    }
  }

  async function exportCopy(scope: string) {
    try {
      let parts: RecipeExportPayload<unknown>[];
      if (scope === GROUP_SCOPE && auth.mode === "online") {
        parts = await fetchRecipeExportParts((part) =>
          auth.authorizedFetch(`/api/recipes/export?part=${part}`),
        );
      } else {
        const payload = {
          format: "recetulis-cosmicas",
          formatVersion: 1,
          mode: scope === LOCAL_SCOPE ? "local" : "cached-group",
          exportedAt: new Date().toISOString(),
          recipes: await readRecipes(scope),
        };
        parts = createRecipeExportParts(payload);
      }
      const count = downloadRecipeExportParts(parts, `recetulis-${scope}`);
      setMessage(count === 1 ? "Respaldo descargado." : `${count} partes del respaldo descargadas.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo exportar.");
    }
  }

  async function clearLocalData() {
    if (!window.confirm("¿Borrar todas las recetas de la colección local de este dispositivo?")) return;
    await replaceRecipes(LOCAL_SCOPE, []);
    setMessage("La colección local quedó vacía.");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/"><span className="brand-mark">♨</span><span>Recetulis Cósmicas</span></Link>
        <nav className="nav-actions"><Link className="nav-button nav-link" href="/">← Volver</Link></nav>
      </header>
      <div className="settings-page">
        <section className="settings-hero">
          <p className="eyebrow">Configuración</p>
          <h1>Acceso, sincronización y respaldos</h1>
          <p className="intro">Administrá quién puede entrar y conservá una copia independiente de tus recetas.</p>
        </section>

        <section className="settings-card">
          <div>
            <p className="eyebrow">Modo actual</p>
            <h2>{auth.mode === "offline" ? "Colección local" : auth.actor?.groupName}</h2>
            <p>{auth.mode === "offline" ? "Estos datos viven solamente en este dispositivo." : `${auth.actor?.email} · ${auth.actor?.role}`}</p>
          </div>
          <div className="settings-actions">
            {auth.mode === "offline" ? (
              <button className="primary-action" onClick={auth.useOnlineMode}>Volver al modo online</button>
            ) : (
              <>
                <button className="secondary-action" onClick={auth.useOfflineMode}>Usar colección local</button>
                <button className="secondary-action" onClick={() => void auth.signOut()}>Cerrar sesión</button>
              </>
            )}
          </div>
        </section>

        {auth.mode === "online" && auth.actor?.role === "owner" && (
          <section className="settings-card settings-stack">
            <div>
              <p className="eyebrow">Grupo privado</p>
              <h2>Personas con acceso</h2>
              <p>La persona verá la invitación al iniciar sesión y decidirá si quiere aceptarla.</p>
            </div>
            <form className="invite-form" onSubmit={invite}>
              <label>Correo<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="persona@gmail.com" /></label>
              <label>Permiso<select value={role} onChange={(event) => setRole(event.target.value as "editor" | "reader")}><option value="editor">Puede editar</option><option value="reader">Sólo lectura</option></select></label>
              <button className="primary-action" type="submit">Invitar</button>
            </form>
            {loadingMembers ? <p>Cargando accesos…</p> : (
              <div className="member-list">
                {members.map((member) => (
                  <div className="member-row" key={member.email}>
                    <div><strong>{member.display_name || member.email}</strong><span>{member.email} · {member.role}</span></div>
                    {member.role !== "owner" && <button className="text-danger" onClick={() => void removeAccess(member.email)}>Quitar</button>}
                  </div>
                ))}
                {invites.map((pending) => (
                  <div className="member-row pending" key={pending.email}>
                    <div><strong>{pending.email}</strong><span>Invitación pendiente · {pending.role}</span></div>
                    <button className="text-danger" onClick={() => void removeAccess(pending.email)}>Cancelar</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="settings-card settings-stack">
          <div><p className="eyebrow">Datos y respaldo</p><h2>Copias de emergencia</h2><p>Los archivos JSON pueden volver a importarse desde la pantalla principal.</p></div>
          <div className="backup-grid">
            {auth.mode === "online" && <button className="primary-action" onClick={() => void exportCopy(GROUP_SCOPE)}>Exportar base online</button>}
            <button className="secondary-action" onClick={() => void exportCopy(LOCAL_SCOPE)}>Exportar colección local</button>
            <button className="danger-action" onClick={() => void clearLocalData()}>Borrar colección local</button>
          </div>
        </section>
        {message && <div className="toast" role="status">{message}</div>}
      </div>
    </main>
  );
}
