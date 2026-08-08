import { getD1 } from "../../../../db";
import { authErrorResponse, requireActor } from "../../../../lib/firebase-auth-server";

export async function DELETE(request: Request) {
  try {
    const actor = await requireActor(request);
    if (actor.role === "owner") {
      return Response.json(
        { error: "La persona propietaria no puede salir sin transferir antes la colección." },
        { status: 400 },
      );
    }
    const d1 = await getD1();
    await d1
      .prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?")
      .bind(actor.groupId, actor.id)
      .run();
    return Response.json({ left: actor.groupId });
  } catch (error) {
    return authErrorResponse(error) ?? Response.json({ error: "No se pudo salir de la colección." }, { status: 500 });
  }
}
