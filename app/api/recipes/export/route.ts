import { readAllRecipes } from "../route";
import { authErrorResponse, requireActor } from "../../../../lib/firebase-auth-server";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    const payload = {
      format: "recetulis-cosmicas",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      group: { id: actor.groupId, name: actor.groupName },
      recipes: await readAllRecipes(actor.groupId),
    };
    const date = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="recetulis-cosmicas-${date}.json"`,
      },
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "No se pudo exportar la base.";
    return Response.json({ error: message }, { status: 500 });
  }
}
