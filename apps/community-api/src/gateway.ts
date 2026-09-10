interface Env {
  COMMUNITY: { fetch(request: Request): Promise<Response> };
}

// A conventional Node/Vercel frontend cannot use a Cloudflare service binding.
// This optional gateway exposes the versioned public reads and forwards writes
// to the same API, which still verifies each origin's proxy key and SIWE session.
export default {
  fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname;
    if (
      !(
        path === "/api/v1" ||
        path.startsWith("/api/v1/") ||
        /^\/media\/sha256\/[a-f0-9]{64}$/.test(path)
      )
    )
      return Promise.resolve(new Response("Not found", { status: 404 }));
    return env.COMMUNITY.fetch(request);
  },
};
