import { ensureSchema, getD1 } from "../../../db";
import { authErrorResponse, requireActor } from "../../../lib/firebase-auth-server";
import { readAllRecipes } from "../recipes/route";

type RevisionRow = {
  sequence: number;
  recipe_id: string;
  version: number;
  operation: "create" | "update" | "delete";
  payload: string | null;
  author_id: string;
  created_at: string;
};

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    await ensureSchema();
    const d1 = await getD1();
    const url = new URL(request.url);
    const after = Math.max(0, Number(url.searchParams.get("after") ?? 0) || 0);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 200) || 200));

    if (after === 0) {
      const cursorRow = (await d1
        .prepare(
          "SELECT COALESCE(MAX(sequence), 0) AS cursor FROM recipe_revisions WHERE group_id = ?",
        )
        .bind(actor.groupId)
        .first()) as { cursor: number } | null;
      return Response.json({
        mode: "snapshot",
        recipes: await readAllRecipes(actor.groupId),
        cursor: Number(cursorRow?.cursor ?? 0),
        hasMore: false,
        syncedAt: new Date().toISOString(),
      });
    }

    const result = (await d1
      .prepare(`
        SELECT sequence, recipe_id, version, operation, payload, author_id, created_at
        FROM recipe_revisions
        WHERE group_id = ? AND sequence > ?
        ORDER BY sequence ASC
        LIMIT ?
      `)
      .bind(actor.groupId, after, limit + 1)
      .all()) as { results?: RevisionRow[] };
    const rows: RevisionRow[] = result.results ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return Response.json({
      mode: "changes",
      changes: page.map((row) => ({
        sequence: row.sequence,
        recipeId: row.recipe_id,
        version: row.version,
        operation: row.operation,
        recipe: row.payload ? JSON.parse(row.payload) : null,
        authorId: row.author_id,
        changedAt: row.created_at,
      })),
      cursor: page.at(-1)?.sequence ?? after,
      hasMore,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      Response.json(
        { error: error instanceof Error ? error.message : "No se pudo sincronizar la colección." },
        { status: 500 },
      )
    );
  }
}
