import { readAllRecipes } from "../route";

export async function GET() {
  try {
    const payload = {
      format: "mi-recetario",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      recipes: await readAllRecipes(),
    };
    const date = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="mi-recetario-${date}.json"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo exportar la base.";
    return Response.json({ error: message }, { status: 500 });
  }
}
