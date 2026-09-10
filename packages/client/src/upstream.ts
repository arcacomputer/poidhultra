import {
  address,
  bountyKey,
  deployments,
  legacyDeployments,
  key,
  resolveLegacyURL,
  uint,
  type Bounty,
  type Claim,
  type Page,
  type LeaderboardEntry,
} from "@poidh/protocol";

type Row = Record<string, unknown>;
type Fetcher = typeof fetch;
type Options = {
  url: string;
  fetcher?: Fetcher;
  now?: () => number;
  cacheMs?: number;
};
class ReadError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const unavailable = (message: string): never => {
  throw new ReadError(503, message);
};
function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return unavailable("The upstream API returned an invalid record.");
  return value as Row;
}
function integer(value: unknown): string {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    return unavailable("The upstream API returned an unsafe integer.");
  if (typeof value !== "string" && typeof value !== "number")
    return unavailable("The upstream API omitted an integer field.");
  const result = uint.safeParse(String(value));
  if (!result.success) return unavailable("Invalid upstream integer.");
  return result.data;
}
function account(value: unknown): string {
  const result = address.safeParse(value);
  if (!result.success) return unavailable("Invalid upstream wallet address.");
  return result.data;
}
function text(value: unknown): string {
  if (typeof value !== "string") return unavailable("Invalid upstream text.");
  return value;
}
function flag(value: unknown): boolean {
  if (typeof value !== "boolean")
    return unavailable(
      "The upstream API has not supplied this bounty's state."
    );
  return value;
}
function network(value: unknown) {
  const id = integer(value);
  const deployment = deployments.find((d) => String(d.chainId) === id);
  if (!deployment) return unavailable("Unsupported upstream network.");
  if (deployment.archive)
    return unavailable(
      "A verified Degen archive is not available from this data source."
    );
  return deployment;
}
function bountyIdentity(chain: unknown, display: unknown) {
  const deployment = network(chain);
  const displayId = integer(display);
  const resolved = resolveLegacyURL(deployment.slug, displayId);
  return { ...resolved, chainId: deployment.chainId, displayId };
}
function requestedIdentity(value: string) {
  if (!bountyKey.safeParse(value).success)
    throw new ReadError(400, "Invalid bounty identifier.");
  const [chain, contract, onChainId] = value.split(":");
  const current = network(chain);
  const deployment = [...deployments, ...legacyDeployments].find(
    (d) => d.chainId === current.chainId && d.address.toLowerCase() === contract
  );
  if (!deployment) throw new ReadError(404, "Unknown contract deployment.");
  const displayId = (BigInt(onChainId) + BigInt(deployment.offset)).toString();
  const resolved = bountyIdentity(chain, displayId);
  if (resolved.deployment.address.toLowerCase() !== contract)
    throw new ReadError(404, "Bounty is outside this deployment's ID range.");
  return { ...resolved, onChainId, contract };
}
function normalizeBounty(value: unknown): Bounty {
  const row = object(value);
  const identity = bountyIdentity(row.chainId, row.id);
  if (integer(row.onChainId) !== identity.onChainId)
    return unavailable(
      "Upstream bounty IDs do not match the pinned deployments."
    );
  // Some completed and cancelled rows retain isVoting/inProgress flags.
  const cancelled = flag(row.isCanceled);
  const active = flag(row.inProgress);
  const voting = flag(row.isVoting);
  if (typeof row.amount !== "string")
    return unavailable("Bounty amounts must be exact decimal strings.");
  return {
    id: key(identity.chainId, identity.deployment.address, identity.onChainId),
    chainId: identity.chainId,
    contract: identity.deployment.address.toLowerCase(),
    onChainId: identity.onChainId,
    displayId: identity.displayId,
    issuer: account(row.issuer),
    title: text(row.title),
    description: text(row.description),
    amount: integer(row.amount),
    createdAt: integer(row.createdAt),
    status: cancelled
      ? "cancelled"
      : !active
      ? "completed"
      : voting
      ? "voting"
      : "open",
    multiplayer: flag(row.isMultiplayer),
    claimCount: null,
    archive: identity.deployment.archive,
  };
}
function normalizeClaim(value: unknown): Claim {
  const row = object(value);
  integer(row.id);
  const identity = bountyIdentity(row.chainId, row.bountyId);
  const onChainId = integer(row.onChainId);
  const uri = text(row.url);
  if (!/^(https:\/\/|ipfs:\/\/)/i.test(uri))
    return unavailable("The upstream proof URL uses an unsupported scheme.");
  return {
    id: key(identity.chainId, identity.deployment.address, onChainId),
    bountyId: key(
      identity.chainId,
      identity.deployment.address,
      identity.onChainId
    ),
    onChainId,
    issuer: account(row.issuer),
    owner: account(row.owner),
    title: text(row.title),
    description: text(row.description),
    uri,
    accepted: flag(row.isAccepted),
    // This API does not supply claim creation timestamps. Never invent one.
    createdAt: null,
  };
}
function compareInteger(a: string, b: string) {
  return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
}
function pageSize(params: URLSearchParams) {
  const input = params.get("limit") ?? "30";
  if (!/^\d{1,3}$/.test(input) || Number(input) < 1 || Number(input) > 100)
    throw new ReadError(400, "Limit must be between 1 and 100.");
  return Number(input);
}
function cursor(params: URLSearchParams, scope: string): string[] | null {
  const input = params.get("cursor");
  if (!input) return null;
  try {
    if (input.length > 4096) throw new Error();
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(atob(input), (c) => c.charCodeAt(0))
      )
    );
    if (
      !Array.isArray(value) ||
      value[0] !== scope ||
      !value.every((v) => typeof v === "string")
    )
      throw new Error();
    return value.slice(1);
  } catch {
    throw new ReadError(400, "Invalid cursor for these filters.");
  }
}
const encode = (scope: string, values: string[]) =>
  btoa(
    String.fromCharCode(
      ...new TextEncoder().encode(JSON.stringify([scope, ...values]))
    )
  );

/** Server-only, read-only adapter. It never receives or forwards site sessions,
 * proxy keys, wallet signatures, or database credentials. All requests are GETs.
 * Its small cache is application state, not a verified blockchain snapshot. */
export class UpstreamPublicAPI {
  readonly origin: string;
  private fetcher: Fetcher;
  private now: () => number;
  private cacheMs: number;
  private cache = new Map<
    string,
    { expires: number; promise: Promise<unknown> }
  >();

  constructor(options: Options) {
    const url = new URL(options.url);
    if (
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error(
        "Use an HTTPS upstream origin, or a local HTTP test server."
      );
    this.origin = url.origin;
    // Workers' native fetch requires its global receiver; a stored method would
    // otherwise be invoked with this adapter as `this` and throw in production.
    this.fetcher =
      options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? Date.now;
    this.cacheMs = options.cacheMs ?? 60_000;
  }
  private async memo<T>(
    name: string,
    loader: () => Promise<T>,
    ttl = this.cacheMs
  ): Promise<T> {
    const existing = this.cache.get(name);
    if (existing && existing.expires > this.now())
      return existing.promise as Promise<T>;
    if (existing) this.cache.delete(name);
    if (this.cache.size >= 64)
      this.cache.delete(this.cache.keys().next().value!);
    const entry = {
      expires: Infinity,
      promise: Promise.resolve().then(loader) as Promise<unknown>,
    };
    this.cache.set(name, entry);
    try {
      const value = (await entry.promise) as T;
      entry.expires = this.now() + ttl;
      return value;
    } catch (error) {
      if (this.cache.get(name) === entry) this.cache.delete(name);
      throw error;
    }
  }
  private async get(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, this.origin), {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "omit",
        cache: "no-store",
        // Workers supports manual redirects; non-2xx responses fail below.
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return unavailable(
        "poidh's public data service is temporarily unavailable. Please try again."
      );
    }
    if (response.status === 404) throw new ReadError(404, "Record not found.");
    if (!response.ok)
      return unavailable(
        "poidh's public data service is temporarily unavailable. Please try again."
      );
    const reader = response.body?.getReader();
    if (!reader)
      return unavailable("The upstream API returned an empty response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          return unavailable("The upstream response is too large to verify.");
        }
        chunks.push(value);
      }
      const buffer = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder().decode(buffer));
    } catch (error) {
      if (error instanceof ReadError) throw error;
      return unavailable(
        "The upstream API returned an incomplete or invalid response."
      );
    } finally {
      reader.releaseLock();
    }
  }
  private async batch(
    resource: string,
    params: URLSearchParams,
    offset: number,
    limit: number
  ) {
    const query = new URLSearchParams(params);
    query.set("limit", String(limit));
    query.set("offset", String(offset));
    const value = await this.get("/api/v1/" + resource + "?" + query);
    if (!Array.isArray(value) || value.length > limit)
      return unavailable("The upstream API returned an invalid page.");
    return value.map(object);
  }
  private async all(
    resource: "bounties" | "leaderboard",
    identity: (row: Row) => string
  ) {
    return this.memo(resource, async () => {
      const rows: Row[] = [];
      const seen = new Set<string>();
      const deadline = this.now() + 30_000;
      // Four pages at a time bounds concurrency and avoids one round-trip per page.
      for (let offset = 0; offset < 20_000; offset += 400) {
        if (this.now() > deadline)
          return unavailable("The upstream data scan timed out. Please retry.");
        const pages = await Promise.all(
          [0, 1, 2, 3].map((i) =>
            this.batch(resource, new URLSearchParams(), offset + i * 100, 100)
          )
        );
        let ended = false;
        for (const page of pages) {
          if (ended && page.length)
            return unavailable(
              "Upstream pagination changed during this read. Please retry."
            );
          for (const row of page) {
            const id = identity(row);
            if (seen.has(id))
              return unavailable(
                "Upstream pagination repeated records. Please retry."
              );
            seen.add(id);
            rows.push(row);
          }
          if (page.length < 100) ended = true;
        }
        if (ended)
          return { rows, fetchedAt: new Date(this.now()).toISOString() };
      }
      return unavailable(
        "The upstream dataset exceeds the preview's scan limit; no partial result was returned."
      );
    });
  }
  private source(fetchedAt = new Date(this.now()).toISOString()) {
    return { kind: "upstream-api" as const, url: this.origin, fetchedAt };
  }
  private async bountyList(params: URLSearchParams): Promise<Page<Bounty>> {
    const limit = pageSize(params);
    const status = params.get("status") ?? "open";
    if (!["open", "voting", "completed", "cancelled"].includes(status))
      throw new ReadError(400, "Invalid bounty status.");
    const chain = params.get("chain");
    if (chain) network(chain);
    const issuer = params.get("issuer");
    if (issuer && !address.safeParse(issuer).success)
      throw new ReadError(400, "Invalid issuer address.");
    const search = (params.get("q") ?? "").trim().toLowerCase();
    if (search.length > 200) throw new ReadError(400, "Search is too long.");
    const archive = params.get("archive") === "true";
    const scope = JSON.stringify([
      "bounties",
      status,
      chain,
      issuer?.toLowerCase() ?? null,
      search,
      archive,
    ]);
    const after = cursor(params, scope);
    if (
      after &&
      (after.length !== 2 ||
        !uint.safeParse(after[0]).success ||
        !bountyKey.safeParse(after[1]).success)
    )
      throw new ReadError(400, "Invalid bounty cursor.");
    const snapshot = await this.all(
      "bounties",
      (r) => integer(r.chainId) + ":" + integer(r.id)
    );
    const items = snapshot.rows
      .map(normalizeBounty)
      .filter(
        (b) =>
          b.status === status &&
          (!chain || String(b.chainId) === chain) &&
          (!issuer || b.issuer === issuer.toLowerCase()) &&
          (archive || !b.archive) &&
          (!search ||
            (b.title + " " + b.description).toLowerCase().includes(search)) &&
          (!after ||
            compareInteger(b.createdAt, after[0]) < 0 ||
            (b.createdAt === after[0] && b.id < after[1]))
      )
      .sort(
        (a, b) =>
          compareInteger(b.createdAt, a.createdAt) ||
          (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
      );
    const last = items[limit - 1];
    return {
      items: items.slice(0, limit),
      nextCursor:
        items.length > limit ? encode(scope, [last.createdAt, last.id]) : null,
      source: this.source(snapshot.fetchedAt),
    };
  }
  private async claimPage(
    params: URLSearchParams,
    filter: Record<string, string>,
    expectedBounty?: string
  ): Promise<Page<Claim>> {
    const limit = pageSize(params);
    const scope = JSON.stringify(["claims", filter, limit]);
    const after = cursor(params, scope);
    if (after && (after.length !== 1 || !/^\d{1,7}$/.test(after[0])))
      throw new ReadError(400, "Invalid proof cursor.");
    const offset = after ? Number(after[0]) : 0;
    const rows = await this.batch(
      "claims",
      new URLSearchParams(filter),
      offset,
      limit
    );
    const items = rows.map(normalizeClaim);
    if (
      new Set(items.map((c) => c.id)).size !== items.length ||
      items.some((c) => expectedBounty && c.bountyId !== expectedBounty)
    )
      return unavailable("Upstream proof relationships are inconsistent.");
    return {
      items,
      nextCursor:
        rows.length === limit ? encode(scope, [String(offset + limit)]) : null,
      source: this.source(),
    };
  }
  private async leaderboard(
    params: URLSearchParams
  ): Promise<Page<LeaderboardEntry>> {
    const limit = pageSize(params);
    const after = cursor(params, "leaderboard");
    if (
      after &&
      (after.length !== 3 ||
        !address.safeParse(after[0]).success ||
        !/^\d+$/.test(after[1]))
    )
      throw new ReadError(400, "Invalid leaderboard cursor.");
    const snapshot = await this.all(
      "leaderboard",
      (r) => integer(r.chainId) + ":" + account(r.address)
    );
    if (after && after[2] !== snapshot.fetchedAt)
      throw new ReadError(409, "The leaderboard changed. Refresh to continue.");
    const excluded = new Set([
      ...deployments.flatMap((d) => [
        d.address.toLowerCase(),
        d.nft.toLowerCase(),
      ]),
      ...legacyDeployments.map((d) => d.address.toLowerCase()),
      "0xddfb1a53e7b73dba09f79fca24765c593d447a80",
    ]);
    const rows = snapshot.rows
      .map((row) => {
        const chainId = network(row.chainId).chainId;
        const a = account(row.address);
        for (const field of ["earned", "paid"])
          if (
            row[field] !== null &&
            (typeof row[field] !== "number" ||
              !Number.isFinite(row[field]) ||
              (row[field] as number) < 0)
          )
            return unavailable("Invalid upstream leaderboard amount.");
        const earned = row.earned as number | null,
          paid = row.paid as number | null;
        const nfts = row.nfts === null ? null : integer(row.nfts);
        // These are upstream floating-point estimates, never raw wei or transaction values.
        const estimate =
          earned === null || paid === null || nfts === null
            ? null
            : (earned + paid) * 1000 + Number(nfts) * 10;
        if (estimate !== null && !Number.isFinite(estimate))
          return unavailable("Invalid upstream leaderboard score.");
        return {
          address: a,
          chainId,
          earned: null,
          paid: null,
          nfts,
          approximateAmounts: {
            earned: earned === null ? null : String(earned),
            paid: paid === null ? null : String(paid),
          },
          estimate,
        };
      })
      .filter((r) => !excluded.has(r.address));
    rows.sort(
      (a, b) =>
        (b.estimate ?? -1) - (a.estimate ?? -1) ||
        a.address.localeCompare(b.address) ||
        a.chainId - b.chainId
    );
    const previous = after
      ? rows.findIndex(
          (r) => r.address === after[0] && String(r.chainId) === after[1]
        )
      : -1;
    if (after && previous === -1)
      throw new ReadError(409, "The leaderboard changed. Refresh to continue.");
    const items = rows
      .slice(previous + 1, previous + 1 + limit)
      .map(({ estimate, ...row }) => row);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        last && rows.length > previous + 1 + limit
          ? encode("leaderboard", [
              last.address,
              String(last.chainId),
              snapshot.fetchedAt,
            ])
          : null,
      source: this.source(snapshot.fetchedAt),
    };
  }
  private async activity(params: URLSearchParams) {
    const limit = pageSize(params);
    const after = cursor(params, "activity");
    if (after && (after.length !== 1 || !/^\d{1,7}$/.test(after[0])))
      throw new ReadError(400, "Invalid activity cursor.");
    const offset = after ? Number(after[0]) : 0;
    const rows = await this.batch(
      "transactions",
      new URLSearchParams(),
      offset,
      limit
    );
    const items = rows.map((r) => {
      const identity = bountyIdentity(r.chainId, r.bountyId);
      const tx = text(r.tx);
      if (!/^0x[0-9a-fA-F]{64}$/.test(tx))
        return unavailable("Invalid upstream transaction hash.");
      return {
        id: `${identity.chainId}:${tx}:${integer(r.index)}`,
        name: text(r.action),
        chainId: identity.chainId,
        timestamp: integer(r.timestamp),
        transactionHash: tx,
        contract: identity.deployment.address.toLowerCase(),
        blockNumber: null,
        data: { bountyId: identity.onChainId },
      };
    });
    return {
      items,
      nextCursor:
        rows.length === limit
          ? encode("activity", [String(offset + limit)])
          : null,
      source: this.source(),
    };
  }
  async handle(
    request: Request,
    path = new URL(request.url).pathname
  ): Promise<Response | null> {
    if (request.method !== "GET") return null;
    const url = new URL(path, request.url);
    if (!url.search) url.search = new URL(request.url).search;
    const route = url.pathname;
    const bounty = route.match(/^\/api\/v1\/bounties\/([^/]+)(\/claims)?$/);
    const claim = route.match(/^\/api\/v1\/claims\/([^/]+)$/);
    const proofs = route.match(/^\/api\/v1\/profiles\/([^/]+)\/proofs$/);
    if (
      !["/api/v1/bounties", "/api/v1/leaderboard", "/api/v1/activity"].includes(
        route
      ) &&
      !bounty &&
      !claim &&
      !proofs
    )
      return null;
    try {
      const result = await this.memo(
        "response:" + url.pathname + url.search,
        async () => {
          if (route === "/api/v1/bounties")
            return this.bountyList(url.searchParams);
          if (route === "/api/v1/leaderboard")
            return this.leaderboard(url.searchParams);
          if (route === "/api/v1/activity")
            return this.activity(url.searchParams);
          if (bounty) {
            const id = decodeURIComponent(bounty[1]);
            const identity = requestedIdentity(id);
            if (bounty[2])
              return this.claimPage(
                url.searchParams,
                {
                  chainId: String(identity.chainId),
                  bountyId: identity.displayId,
                },
                id
              );
            const row = normalizeBounty(
              await this.get(
                `/api/v1/bounties/${identity.chainId}/${identity.displayId}?include=`
              )
            );
            if (row.id !== id)
              return unavailable(
                "The upstream API returned a different bounty."
              );
            return { ...row, source: this.source() };
          }
          if (proofs) {
            const a = address.safeParse(decodeURIComponent(proofs[1]));
            if (!a.success)
              throw new ReadError(400, "Invalid profile address.");
            const mode = url.searchParams.get("mode") ?? "created";
            if (!["created", "owned"].includes(mode))
              throw new ReadError(400, "Invalid proof filter.");
            return this.claimPage(url.searchParams, {
              [mode === "owned" ? "owner" : "issuer"]: a.data,
            });
          }
          const id = decodeURIComponent(claim![1]);
          if (!bountyKey.safeParse(id).success)
            throw new ReadError(400, "Invalid claim identifier.");
          const [chain, contract, onChainId] = id.split(":");
          const current = network(chain);
          if (
            ![...deployments, ...legacyDeployments].some(
              (d) =>
                d.chainId === current.chainId &&
                d.address.toLowerCase() === contract
            )
          )
            throw new ReadError(404, "Unknown claim deployment.");
          const rows = await this.batch(
            "claims",
            new URLSearchParams({ chainId: chain, onChainId }),
            0,
            100
          );
          if (rows.length === 100)
            return unavailable("The claim lookup is ambiguous.");
          const matching = rows.map(normalizeClaim).filter((c) => c.id === id);
          if (matching.length > 1)
            return unavailable("The claim lookup is ambiguous.");
          if (!matching[0]) throw new ReadError(404, "Claim not found.");
          return { ...matching[0], source: this.source() };
        },
        10_000
      );
      return Response.json(result, {
        headers: {
          "Cache-Control": "no-store",
          "X-Poidh-Data-Source": "upstream-api",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      const known = error instanceof ReadError;
      return Response.json(
        {
          error: known
            ? error.message
            : "The upstream data response could not be verified. Please retry.",
        },
        {
          status: known ? error.status : 503,
          headers: {
            "Cache-Control": "no-store",
            "X-Poidh-Data-Source": "upstream-api",
          },
        }
      );
    }
  }
}
