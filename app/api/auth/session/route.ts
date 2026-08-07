import { authErrorResponse, requireActor } from "../../../../lib/firebase-auth-server";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    return Response.json({ user: actor });
  } catch (error) {
    return authErrorResponse(error) ?? Response.json({ error: "No se pudo validar la sesión." }, { status: 500 });
  }
}
