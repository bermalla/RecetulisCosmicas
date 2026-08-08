import { authErrorResponse, readAuthSession, requireActor } from "../../../../lib/firebase-auth-server";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("includeInvites") === "1") {
      const session = await readAuthSession(request);
      return Response.json({
        user: session.actor ?? session.account,
        actor: session.actor,
        invitations: session.invitations,
      });
    }
    const actor = await requireActor(request);
    return Response.json({ user: actor, actor, invitations: [] });
  } catch (error) {
    return authErrorResponse(error) ?? Response.json({ error: "No se pudo validar la sesión." }, { status: 500 });
  }
}
