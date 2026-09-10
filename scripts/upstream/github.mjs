const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class GitHub {
  constructor({ token, fetcher = fetch, wait = sleep } = {}) {
    this.token = token;
    this.fetcher = fetcher;
    this.wait = wait;
  }
  async request(path, { method = "GET", body } = {}) {
    const url = new URL(path, "https://api.github.com");
    if (url.origin !== "https://api.github.com")
      throw new Error("Unexpected API origin");
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await this.fetcher(url, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "poidh-ultra-maintenance",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(45_000),
        redirect: "error",
      }).catch((error) => ({
        ok: false,
        status: 599,
        headers: new Headers(),
        text: async () => error.message,
      }));
      if (response.ok)
        return {
          data: response.status === 204 ? null : await response.json(),
          headers: response.headers,
        };
      const retryable = [403, 429, 500, 502, 503, 504, 599].includes(
        response.status
      );
      if (!retryable || attempt === 4) {
        const error = new Error(
          `GitHub ${method} ${url.pathname}: ${response.status} ${(
            await response.text()
          ).slice(0, 500)}`
        );
        error.status = response.status;
        throw error;
      }
      const retryAfter =
        Number(response.headers.get("retry-after") || 0) * 1000;
      // A long outage/rate limit is a failed check, never an invented successful heartbeat.
      await this.wait(
        Math.min(30_000, Math.max(retryAfter, 1000 * 2 ** attempt))
      );
    }
  }
  async all(path) {
    let next = new URL(path, "https://api.github.com");
    next.searchParams.set("per_page", "100");
    const result = [];
    const seen = new Set();
    while (next) {
      if (seen.has(next.href)) throw new Error("Pagination loop");
      seen.add(next.href);
      const { data, headers } = await this.request(next.href);
      if (!Array.isArray(data)) throw new Error("Expected a paginated array");
      result.push(...data);
      const link = headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/);
      next = link ? new URL(link[1]) : null;
    }
    return result;
  }
}
