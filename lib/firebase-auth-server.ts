import { ensureSchema, getD1 } from "../db";

export const DEFAULT_GROUP_ID = "recetulis-cosmicas";

type FirebaseRuntimeEnv = {
  FIREBASE_API_KEY?: string;
  FIREBASE_AUTH_DOMAIN?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_APP_ID?: string;
  RECETULIS_OWNER_EMAIL?: string;
};

export type FirebasePublicConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
};

export type GroupRole = "owner" | "editor" | "reader";

export type AuthorizedActor = AuthenticatedUser & {
  groupId: string;
  groupName: string;
  role: GroupRole;
};

export type PendingGroupInvitation = {
  groupId: string;
  groupName: string;
  ownerName: string;
  role: Exclude<GroupRole, "owner">;
  createdAt: string;
};

export type AuthSession = {
  account: AuthenticatedUser;
  actor: AuthorizedActor | null;
  invitations: PendingGroupInvitation[];
};

type FirebaseClaims = {
  aud?: string;
  email?: string;
  email_verified?: boolean;
  exp?: number;
  iat?: number;
  iss?: string;
  name?: string;
  sub?: string;
  user_id?: string;
};

type SigningJsonWebKey = JsonWebKey & { kid?: string };
type JsonWebKeySet = { keys?: SigningJsonWebKey[] };

let keyCache: { expiresAt: number; keys: Map<string, SigningJsonWebKey> } | null = null;

export class AuthError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

async function getRuntimeEnv(): Promise<FirebaseRuntimeEnv> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as FirebaseRuntimeEnv;
}

export async function getFirebasePublicConfig(): Promise<FirebasePublicConfig | null> {
  const env = await getRuntimeEnv();
  const apiKey = env.FIREBASE_API_KEY?.trim();
  const authDomain = env.FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  const appId = env.FIREBASE_APP_ID?.trim();
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return { apiKey, authDomain, projectId, appId };
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  return bytes;
}

function parseJsonPart<T>(part: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(part))) as T;
  } catch {
    throw new AuthError("La sesión no es válida.", 401, "AUTH_TOKEN");
  }
}

async function getGoogleSigningKey(kid: string): Promise<SigningJsonWebKey> {
  const now = Date.now();
  if (!keyCache || keyCache.expiresAt <= now || !keyCache.keys.has(kid)) {
    const response = await fetch(
      "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
    );
    if (!response.ok) throw new AuthError("No se pudo validar la identidad.", 503, "AUTH_KEYS");
    const data = (await response.json()) as JsonWebKeySet;
    const keys = new Map<string, SigningJsonWebKey>();
    for (const key of data.keys ?? []) {
      if (key.kid) keys.set(key.kid, key);
    }
    const cacheControl = response.headers.get("cache-control") ?? "";
    const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] ?? 3600);
    keyCache = { expiresAt: now + Math.max(300, maxAge) * 1000, keys };
  }
  const key = keyCache.keys.get(kid);
  if (!key) throw new AuthError("La credencial de acceso no es válida.", 401, "AUTH_KEY");
  return key;
}

export async function verifyFirebaseToken(token: string): Promise<AuthenticatedUser> {
  const config = await getFirebasePublicConfig();
  if (!config) {
    throw new AuthError(
      "La autenticación online todavía no está configurada.",
      503,
      "AUTH_NOT_CONFIGURED",
    );
  }
  if (token.length > 8192) {
    throw new AuthError("La sesión no es válida.", 401, "AUTH_TOKEN");
  }
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("La sesión no es válida.", 401, "AUTH_TOKEN");
  const header = parseJsonPart<{ alg?: string; kid?: string }>(parts[0]);
  const claims = parseJsonPart<FirebaseClaims>(parts[1]);
  if (header.alg !== "RS256" || !header.kid) {
    throw new AuthError("La sesión no es válida.", 401, "AUTH_HEADER");
  }

  const keyData = await getGoogleSigningKey(header.kid);
  const key = await crypto.subtle.importKey(
    "jwk",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  const now = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://securetoken.google.com/${config.projectId}`;
  if (
    !validSignature ||
    claims.aud !== config.projectId ||
    claims.iss !== expectedIssuer ||
    !claims.exp ||
    claims.exp <= now ||
    !claims.iat ||
    claims.iat > now + 60 ||
    !claims.sub ||
    claims.sub.length > 128 ||
    !claims.email ||
    claims.email.length > 254 ||
    claims.email_verified !== true
  ) {
    throw new AuthError("La sesión venció o no es válida.", 401, "AUTH_CLAIMS");
  }
  return {
    id: claims.sub,
    email: claims.email.trim().toLowerCase(),
    displayName: claims.name?.trim() || claims.email,
  };
}

function bearerToken(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new AuthError("Iniciá sesión para continuar.", 401, "AUTH_REQUIRED");
  return match[1];
}

export function ownerGroupName(user: AuthenticatedUser) {
  const displayName = user.displayName.trim();
  const ownerName = displayName && displayName !== user.email
    ? displayName
    : user.email.split("@")[0];
  return `Colección de ${ownerName.slice(0, 80)}`;
}

async function registerUser(user: AuthenticatedUser) {
  await ensureSchema();
  const d1 = await getD1();
  const now = new Date().toISOString();
  await d1
    .prepare(`
      INSERT INTO users (id, email, display_name, last_seen_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        display_name = excluded.display_name,
        last_seen_at = excluded.last_seen_at
    `)
    .bind(user.id, user.email, user.displayName, now)
    .run();

  const env = await getRuntimeEnv();
  const ownerEmail = env.RECETULIS_OWNER_EMAIL?.trim().toLowerCase();
  if (ownerEmail && user.email === ownerEmail) {
    const groupName = ownerGroupName(user);
    await d1.batch([
      d1
        .prepare(
          "INSERT INTO groups (id, name, created_by) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(DEFAULT_GROUP_ID, groupName, user.id),
      d1
        .prepare("UPDATE groups SET name = ?, created_by = COALESCE(created_by, ?) WHERE id = ?")
        .bind(groupName, user.id, DEFAULT_GROUP_ID),
      d1
        .prepare(`
          INSERT INTO group_members (group_id, user_id, role, added_by)
          VALUES (?, ?, 'owner', ?)
          ON CONFLICT(group_id, user_id) DO UPDATE SET role = 'owner'
        `)
        .bind(DEFAULT_GROUP_ID, user.id, user.id),
    ]);
  }
  return user;
}

async function membershipForUser(user: AuthenticatedUser): Promise<AuthorizedActor | null> {
  const d1 = await getD1();
  const membership = (await d1
    .prepare(`
      SELECT gm.group_id, gm.role AS role, g.name AS group_name
      FROM group_members gm
      JOIN groups g ON g.id = gm.group_id
      WHERE gm.user_id = ?
      LIMIT 1
    `)
    .bind(user.id)
    .first()) as { group_id: string; role: GroupRole; group_name: string } | null;
  if (!membership) return null;
  return {
    ...user,
    groupId: membership.group_id,
    groupName: membership.group_name,
    role: membership.role,
  };
}

async function invitationsForUser(user: AuthenticatedUser): Promise<PendingGroupInvitation[]> {
  const d1 = await getD1();
  const result = (await d1
    .prepare(`
      SELECT
        gi.group_id,
        g.name AS group_name,
        COALESCE(NULLIF(owner.display_name, ''), owner.email, g.name) AS owner_name,
        gi.role,
        gi.created_at
      FROM group_invites gi
      JOIN groups g ON g.id = gi.group_id
      LEFT JOIN users owner ON owner.id = g.created_by
      WHERE gi.email = ?
      ORDER BY gi.created_at DESC
    `)
    .bind(user.email)
    .all()) as {
    results?: Array<{
      group_id: string;
      group_name: string;
      owner_name: string;
      role: "editor" | "reader";
      created_at: string;
    }>;
  };
  return (result.results ?? []).map((invite) => ({
    groupId: invite.group_id,
    groupName: invite.group_name,
    ownerName: invite.owner_name,
    role: invite.role,
    createdAt: invite.created_at,
  }));
}

export async function requireUser(request: Request): Promise<AuthenticatedUser> {
  return registerUser(await verifyFirebaseToken(bearerToken(request)));
}

export async function readAuthSession(request: Request): Promise<AuthSession> {
  const account = await requireUser(request);
  const [actor, invitations] = await Promise.all([
    membershipForUser(account),
    invitationsForUser(account),
  ]);
  return { account, actor, invitations };
}

export async function requireActor(
  request: Request,
  allowedRoles: GroupRole[] = ["owner", "editor", "reader"],
): Promise<AuthorizedActor> {
  const user = await requireUser(request);
  const actor = await membershipForUser(user);
  if (!actor) {
    throw new AuthError(
      "No pertenecés a una colección. Revisá tus invitaciones en Ajustes.",
      403,
      "GROUP_MEMBERSHIP_REQUIRED",
    );
  }
  if (!allowedRoles.includes(actor.role)) {
    throw new AuthError("No tenés permisos para realizar esta acción.", 403, "ROLE_REQUIRED");
  }
  return actor;
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return null;
}
