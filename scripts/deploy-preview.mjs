import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const app = resolve("apps/web");
const origin = "https://poidh.arca.computer";
const upstream = process.env.UPSTREAM_INDEXER_URL;
if (upstream) {
  const parsed = new URL(upstream);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(
      "UPSTREAM_INDEXER_URL must be an HTTPS origin without credentials."
    );
}
const build = spawnSync(
  "pnpm",
  ["--filter", "@poidh/web", "build:cloudflare"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_READ_ONLY_PREVIEW: "true",
      NEXT_PUBLIC_APP_URL: origin,
      NEXT_PUBLIC_UPSTREAM_READS: upstream ? "true" : "false",
    },
  }
);
if (build.status !== 0) process.exit(build.status ?? 1);
const config = JSON.parse(readFileSync(app + "/wrangler.jsonc", "utf8"));
config.name = "poidh-ultra-preview";
config.workers_dev = true;
config.routes = [{ pattern: new URL(origin).hostname, custom_domain: true }];
config.vars = {
  ...config.vars,
  NEXT_PUBLIC_APP_URL: origin,
  PREVIEW_MODE: "true",
  ...(upstream ? { UPSTREAM_INDEXER_URL: new URL(upstream).origin } : {}),
};
config.services = config.services.map((service) =>
  service.binding === "WORKER_SELF_REFERENCE"
    ? { ...service, service: config.name }
    : service
);
writeFileSync(app + "/.preview.wrangler.json", JSON.stringify(config, null, 2));
const deployment = spawnSync(
  "pnpm",
  ["exec", "wrangler", "deploy", "--config", ".preview.wrangler.json"],
  {
    cwd: app,
    stdio: "inherit",
  }
);
process.exitCode = deployment.status ?? 1;
