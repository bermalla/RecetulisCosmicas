import { getD1 } from "../../../../db";
import {
  authErrorResponse,
  readAuthSession,
  requireUser,
} from "../../../../lib/firebase-auth-server";

function requestTooLarge(request: Request) {
  return Number(request.headers.get("content-length") ?? 0) > 16_384;
}

async function groupIdFromRequest(request: Request) {
  if (requestTooLarge(request)) return "";
  const payload = (await request.json()) as { groupId?: string };
  return String(payload.groupId ?? "").trim();
}

export async function GET(request: Request) {
  try {
    const session = await readAuthSession(request);
    return Response.json({ invitations: session.invitations, actor: session.actor });
  } catch (error) {
    return authErrorResponse(error) ?? Response.json({ error: "No se pudieron cargar las invitaciones." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (requestTooLarge(request)) {
      return Response.json({ error: "La solicitud es demasiado grande." }, { status: 413 });
    }
    const user = await requireUser(request);
    const groupId = await groupIdFromRequest(request);
    if (!groupId) return Response.json({ error: "Falta identificar la colección." }, { status: 400 });

    const d1 = await getD1();
    const currentMembership = await d1
      .prepare("SELECT group_id FROM group_members WHERE user_id = ? LIMIT 1")
      .bind(user.id)
      .first();
    if (currentMembership) {
      return Response.json(
        { error: "Primero salí de tu colección actual para aceptar otra invitación." },
        { status: 409 },
      );
    }

    const invite = (await d1
      .prepare(`
        SELECT role, invited_by
        FROM group_invites
        WHERE group_id = ? AND email = ?
        LIMIT 1
      `)
      .bind(groupId, user.email)
      .first()) as { role: "editor" | "reader"; invited_by: string } | null;
    if (!invite) {
      return Response.json({ error: "La invitación ya no está disponible." }, { status: 404 });
    }

    await d1.batch([
      d1
        .prepare(`
          INSERT INTO group_members (group_id, user_id, role, added_by)
          VALUES (?, ?, ?, ?)
        `)
        .bind(groupId, user.id, invite.role, invite.invited_by),
      d1
        .prepare("DELETE FROM group_invites WHERE group_id = ? AND email = ?")
        .bind(groupId, user.email),
    ]);
    const session = await readAuthSession(request);
    return Response.json({ actor: session.actor, invitations: session.invitations });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("unique") || message.includes("constraint")) {
      return Response.json(
        { error: "Ya pertenecés a otra colección. Salí de ella antes de aceptar." },
        { status: 409 },
      );
    }
    return Response.json({ error: "No se pudo aceptar la invitación." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (requestTooLarge(request)) {
      return Response.json({ error: "La solicitud es demasiado grande." }, { status: 413 });
    }
    const user = await requireUser(request);
    const groupId = await groupIdFromRequest(request);
    if (!groupId) return Response.json({ error: "Falta identificar la colección." }, { status: 400 });
    const d1 = await getD1();
    await d1
      .prepare("DELETE FROM group_invites WHERE group_id = ? AND email = ?")
      .bind(groupId, user.email)
      .run();
    const session = await readAuthSession(request);
    return Response.json({ invitations: session.invitations });
  } catch (error) {
    return authErrorResponse(error) ?? Response.json({ error: "No se pudo rechazar la invitación." }, { status: 500 });
  }
}
