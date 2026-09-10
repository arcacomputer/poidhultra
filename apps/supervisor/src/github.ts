import { createSign } from "node:crypto";
export type GitHubCredentials = {
  GITHUB_APP_ID: string;
  GITHUB_INSTALLATION_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_REPOSITORY: string;
};
export async function github(
  env: GitHubCredentials,
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET"
) {
  const b64 = (s: string) => Buffer.from(s).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    b64(JSON.stringify({ alg: "RS256", typ: "JWT" })) +
    "." +
    b64(
      JSON.stringify({ iat: now - 60, exp: now + 300, iss: env.GITHUB_APP_ID })
    );
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(env.GITHUB_APP_PRIVATE_KEY, "base64url");
  const installed = await fetch(
    `https://api.github.com/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${unsigned}.${signature}`,
        "User-Agent": "poidh-ultra-watchdog",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        repositories: [env.GITHUB_REPOSITORY.split("/")[1]],
      }),
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!installed.ok)
    throw new Error(
      `GitHub installation authentication failed (${installed.status})`
    );
  const { token } = (await installed.json()) as { token: string };
  const response = await fetch(
    "https://api.github.com/repos/" + env.GITHUB_REPOSITORY + path,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "poidh-ultra-watchdog",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!response.ok)
    throw new Error(`GitHub request failed (${response.status})`);
  return response.status === 204 ? null : response.json();
}
export function overdue(
  status: { lastSuccessfulCheck?: string | null },
  now = Date.now(),
  threshold = 3 * 3600_000
) {
  const last = Date.parse(status.lastSuccessfulCheck ?? "");
  return (
    !Number.isFinite(last) || last > now + 60_000 || now - last > threshold
  );
}
export async function validSignature(
  body: ArrayBuffer,
  header: string | null,
  secret: string
) {
  if (!header || !/^sha256=[a-f0-9]{64}$/.test(header)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const bytes = new Uint8Array(
    header
      .slice(7)
      .match(/../g)!
      .map((x) => parseInt(x, 16))
  );
  return crypto.subtle.verify("HMAC", key, bytes, body);
}
