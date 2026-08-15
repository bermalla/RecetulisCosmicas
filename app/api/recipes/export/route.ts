import { readAllRecipes } from "../route";
import { authErrorResponse, requireActor } from "../../../../lib/firebase-auth-server";
import { createRecipeExportParts, recipeExportFilename } from "../../../../lib/recipe-export";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    const recipes = await readAllRecipes(actor.groupId);
    const payload = {
      format: "recetulis-cosmicas",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      group: { id: actor.groupId, name: actor.groupName },
      recipes,
    };
    const parts = createRecipeExportParts(payload);
    const requestedPart = Number(new URL(request.url).searchParams.get("part") ?? 1);
    if (!Number.isInteger(requestedPart) || requestedPart < 1 || requestedPart > parts.length) {
      return Response.json({ error: "La parte solicitada no existe." }, { status: 404 });
    }
    const exportPayload = parts[requestedPart - 1];
    const date = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(exportPayload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${recipeExportFilename("recetulis-cosmicas", date, requestedPart, parts.length)}"`,
      },
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "No se pudo exportar la base.";
    return Response.json({ error: message }, { status: 500 });
  }
}
