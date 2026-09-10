import { writeFile } from "node:fs/promises";
// Public reads can reconcile visible content only. They cannot recover deleted/moderated records or authorship secrets.
const origin = new URL(process.argv[2] ?? "https://poidh.xyz");
if (!["https:", "http:"].includes(origin.protocol))
  throw new Error("Invalid origin");
const out = process.argv[3];
if (!out)
  throw new Error("Usage: reconcile.ts https://poidh.xyz private-report.json");
const seen = new Set<string>();
const items: unknown[] = [];
let cursor: string | undefined;
let pages = 0;
do {
  const url = new URL("/api/v1/changes", origin);
  url.searchParams.set("after", cursor ?? "0");
  url.searchParams.set("limit", "100");
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok)
    throw new Error(
      `Public API unavailable (${response.status}). Kenny must integrate the shared API before this feed is available.`
    );
  const result = await response.json();
  if (!Array.isArray(result.items))
    throw new Error("Unexpected public API format");
  items.push(...result.items);
  pages++;
  const next = result.nextCursor;
  if (!result.items.length || next === cursor) break;
  if (seen.has(next)) throw new Error("Cursor repeated");
  seen.add(next);
  cursor = next;
} while (pages < 10000);
if (pages === 10000)
  throw new Error(
    "Reconciliation exceeded page limit; no complete report was produced"
  );
await writeFile(
  out,
  JSON.stringify(
    {
      version: 1,
      origin: origin.origin,
      checkedAt: new Date().toISOString(),
      scope: "visible-public-change-feed-only",
      cursor,
      items,
    },
    null,
    2
  ),
  { mode: 0o600 }
);
console.log(`Reconciled ${items.length} public changes across ${pages} pages`);
