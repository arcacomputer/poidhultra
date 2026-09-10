import type {
  Bounty,
  Claim,
  CommunityRecord,
  Page,
  Change,
} from "@poidh/protocol";
export class APIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export class CommunityClient {
  constructor(
    public base = "/api/v1",
    private fetcher: typeof fetch = (...args) => globalThis.fetch(...args)
  ) {}
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(this.base + path, {
      ...options,
      credentials: "same-origin",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const body = await response.json();
    if (!response.ok)
      throw new APIError(response.status, body.error ?? "Request failed");
    return body;
  }
  bounties(params: Record<string, string> = {}) {
    return this.request<Page<Bounty>>(
      "/bounties?" + new URLSearchParams(params)
    );
  }
  bounty(id: string) {
    return this.request<Bounty>("/bounties/" + encodeURIComponent(id));
  }
  claims(id: string, cursor = "") {
    return this.request<Page<Claim>>(
      "/bounties/" +
        encodeURIComponent(id) +
        "/claims?" +
        new URLSearchParams({ cursor })
    );
  }
  claim(id: string) {
    return this.request<Claim>("/claims/" + encodeURIComponent(id));
  }
  records(params: Record<string, string>) {
    return this.request<Page<CommunityRecord>>(
      "/records?" + new URLSearchParams(params)
    );
  }
  changes(after = "0") {
    return this.request<{ items: Change[]; nextCursor: string }>(
      "/changes?after=" + after
    );
  }
  session() {
    return this.request<{ address: string } | null>("/auth/session");
  }
  challenge(address: string, chainId: number) {
    return this.request<{ nonce: string; message: string }>("/auth/challenge", {
      method: "POST",
      body: JSON.stringify({ address, chainId }),
    });
  }
  verify(message: string, signature: string) {
    return this.request<{ address: string }>("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ message, signature }),
    });
  }
  write<T = CommunityRecord>(
    path: string,
    method: string,
    body: unknown,
    idempotencyKey = crypto.randomUUID()
  ) {
    return this.request<T>(path, {
      method,
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    });
  }
  async upload(file: File) {
    const response = await this.fetcher(this.base + "/uploads", {
      method: "POST",
      body: file,
      credentials: "same-origin",
      headers: { "Content-Type": file.type },
    });
    const result = await response.json();
    if (!response.ok) throw new APIError(response.status, result.error);
    return result as { url: string; sha256: string };
  }
  metadata(data: {
    name: string;
    description: string;
    image: string;
    external_url?: string;
    attributes?: unknown[];
  }) {
    return this.request<{ url: string; sha256: string }>("/metadata", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
}
