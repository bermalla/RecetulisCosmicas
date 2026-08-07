import { getFirebasePublicConfig } from "../../../../lib/firebase-auth-server";

export async function GET() {
  const config = await getFirebasePublicConfig();
  if (!config) {
    return Response.json(
      {
        configured: false,
        error: "La conexión con Google todavía no está configurada.",
      },
      { status: 503 },
    );
  }
  return Response.json({ configured: true, config });
}
