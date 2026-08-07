import { ensureSchema, getD1 } from "../../../../db";
import { authErrorResponse, requireActor } from "../../../../lib/firebase-auth-server";

type InviteRole = "editor" | "reader";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request, ["owner"]);
    await ensureSchema();
    const d1 = await getD1();
    const [members, invites] = await Promise.all([
      d1
        .prepare(`
          SELECT u.id, u.email, u.display_name, gm.role, gm.created_at
          FROM group_members gm
          JOIN users u ON u.id = gm.user_id
          WHERE gm.group_id = ?
          ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.email
        `)
        .bind(actor.groupId)
        .all(),
      d1
        .prepare(`
          SELECT email, role, created_at
          FROM group_invites
          WHERE group_id = ?
          ORDER BY created_at DESC
        `)
        .bind(actor.groupId)
        .all(),
    ]);
    return Response.json({ members: members.results ?? [], invites: invites.results ?? [] });
  } catch (error) {
    return authErrorResponse(error) ?? Response.json({ error: "No se pudieron cargar los accesos." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request, ["owner"]);
    const payload = (await request.json()) as { email?: string; role?: InviteRole };
    const email = String(payload.email ?? "").trim().toLowerCase();
    const role: InviteRole = payload.role === "reader" ? "reader" : "editor";
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return Response.json({ error: "Ingresá un correo válido." }, { status: 400 });
    }
    const d1 = await getD1();
    await d1
      .prepare(`
        INSERT INTO group_invites (group_id, email, role, invited_by)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(group_id, email) DO UPDATE SET
          role = excluded.role,
          invited_by = excluded.invited_by,
          created_at = CURRENT_TIMESTAMP
      `)
      .bind(actor.groupId, email, role, actor.id)
      .run();
    return Response.json({ invited: email, role }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error) ?? Response.json({ error: "No se pudo crear la invitación." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireActor(request, ["owner"]);
    const url = new URL(request.url);
    const email = String(url.searchParams.get("email") ?? "").trim().toLowerCase();
    if (!email) return Response.json({ error: "Falta el correo." }, { status: 400 });
    if (email === actor.email) {
      return Response.json({ error: "El propietario no puede quitarse a sí mismo." }, { status: 400 });
    }
    const d1 = await getD1();
    await d1.batch([
      d1
        .prepare(`
          DELETE FROM group_members
          WHERE group_id = ? AND user_id IN (SELECT id FROM users WHERE email = ?)
        `)
        .bind(actor.groupId, email),
      d1
        .prepare("DELETE FROM group_invites WHERE group_id = ? AND email = ?")
        .bind(actor.groupId, email),
    ]);
    return Response.json({ removed: email });
  } catch (error) {
    return authErrorResponse(error) ?? Response.json({ error: "No se pudo quitar el acceso." }, { status: 500 });
  }
}
