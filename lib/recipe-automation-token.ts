const AUTOMATION_HEADER = "x-recetulis-automation-token";
const MAX_TOKEN_LENGTH = 512;

async function digest(value: string) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

export async function secureTokenEquals(provided: string, expected: string) {
  const [providedDigest, expectedDigest] = await Promise.all([
    digest(provided),
    digest(expected),
  ]);
  let difference = 0;
  for (let index = 0; index < providedDigest.length; index += 1) {
    difference |= providedDigest[index] ^ expectedDigest[index];
  }
  return difference === 0;
}

export function readAutomationToken(request: Request) {
  const token = request.headers.get(AUTOMATION_HEADER)?.trim() ?? "";
  return token && token.length <= MAX_TOKEN_LENGTH ? token : null;
}
