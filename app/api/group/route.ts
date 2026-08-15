import { getD1 } from "../../../db";
import {
  authErrorResponse,
  ownerGroupName,
  readAuthSession,
  requireUser,
} from "../../../lib/firebase-auth-server";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const d1 = await getD1();

    const [membership, invitation] = await Promise.all([
      d1
        .prepare("SELECT group_id FROM group_members WHERE user_id = ? LIMIT 1")
        .bind(user.id)
        .first(),
      d1
        .prepare("SELECT group_id FROM group_invites WHERE email = ? LIMIT 1")
        .bind(user.email)
        .first(),
    ]);

    if (membership) {
      return Response.json(
        { error: "Ya pertenecés a una colección." },
        { status: 409 },
      );
    }
    if (invitation) {
      return Response.json(
        { error: "Tenés una invitación pendiente. Primero aceptala o rechazala." },
        { status: 409 },
      );
    }

    const groupId = crypto.randomUUID();
    await d1.batch([
      d1
        .prepare("INSERT INTO groups (id, name, created_by) VALUES (?, ?, ?)")
        .bind(groupId, ownerGroupName(user), user.id),
      d1
        .prepare(`
          INSERT INTO group_members (group_id, user_id, role, added_by)
          VALUES (?, ?, 'owner', ?)
        `)
        .bind(groupId, user.id, user.id),
    ]);

    const session = await readAuthSession(request);
    return Response.json(
      {
        user: session.actor ?? session.account,
        actor: session.actor,
        invitations: session.invitations,
      },
      { status: 201 },
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("unique") || message.includes("constraint")) {
      return Response.json(
        { error: "La cuenta ya quedó vinculada a una colección. Volvé a cargar para continuar." },
        { status: 409 },
      );
    }
    return Response.json({ error: "No se pudo crear la colección." }, { status: 500 });
  }
}
