import { ensureSchema, getD1 } from "../db";
import {
  AuthError,
  DEFAULT_GROUP_ID,
  type AuthorizedActor,
  requireActor,
} from "./firebase-auth-server";
import { readAutomationToken, secureTokenEquals } from "./recipe-automation-token";

type AutomationRuntimeEnv = {
  RECETULIS_AUTOMATION_TOKEN?: string;
};

type OwnerRow = {
  id: string;
  email: string;
  display_name: string;
  group_name: string;
};

async function runtimeEnv(): Promise<AutomationRuntimeEnv> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as AutomationRuntimeEnv;
}

async function requireAutomationOwner(token: string): Promise<AuthorizedActor> {
  const env = await runtimeEnv();
  const expectedToken = env.RECETULIS_AUTOMATION_TOKEN?.trim() ?? "";
  if (!expectedToken || !(await secureTokenEquals(token, expectedToken))) {
    throw new AuthError("La credencial de automatización no es válida.", 401, "AUTOMATION_TOKEN");
  }

  await ensureSchema();
  const d1 = await getD1();
  const owner = (await d1
    .prepare(`
      SELECT u.id, u.email, u.display_name, g.name AS group_name
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      JOIN groups g ON g.id = gm.group_id
      WHERE gm.group_id = ? AND gm.role = 'owner'
      ORDER BY gm.created_at ASC
      LIMIT 1
    `)
    .bind(DEFAULT_GROUP_ID)
    .first()) as OwnerRow | null;

  if (!owner) {
    throw new AuthError(
      "La colección principal todavía no tiene un propietario configurado.",
      503,
      "AUTOMATION_OWNER_REQUIRED",
    );
  }

  return {
    id: owner.id,
    email: owner.email,
    displayName: owner.display_name || owner.email,
    groupId: DEFAULT_GROUP_ID,
    groupName: owner.group_name,
    role: "owner",
  };
}

export async function requireRecipePostActor(request: Request) {
  const token = readAutomationToken(request);
  if (token) return requireAutomationOwner(token);
  return requireActor(request, ["owner", "editor"]);
}
