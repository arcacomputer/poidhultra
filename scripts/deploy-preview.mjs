import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const app = resolve("apps/web");
const origin = "https://poidh-ultra-preview.lf-e32.workers.dev";
const build = spawnSync(
  "pnpm",
  ["--filter", "@poidh/web", "build:cloudflare"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_READ_ONLY_PREVIEW: "true",
      NEXT_PUBLIC_APP_URL: origin,
    },
  }
);
if (build.status !== 0) process.exit(build.status ?? 1);
const config = JSON.parse(readFileSync(app + "/wrangler.jsonc", "utf8"));
config.name = "poidh-ultra-preview";
config.workers_dev = true;
delete config.routes;
config.vars = {
  ...config.vars,
  NEXT_PUBLIC_APP_URL: origin,
  PREVIEW_MODE: "true",
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
