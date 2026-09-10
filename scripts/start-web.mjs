import { cpSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
const app = resolve(import.meta.dirname, "../apps/web");
const standalone = resolve(app, ".next/standalone/apps/web");
if (!existsSync(standalone + "/server.js"))
  throw new Error("Build the Next.js app first");
cpSync(app + "/public", standalone + "/public", { recursive: true });
cpSync(app + "/.next/static", standalone + "/.next/static", {
  recursive: true,
});
const child = spawn(process.execPath, [standalone + "/server.js"], {
  stdio: "inherit",
  env: { ...process.env, HOSTNAME: process.env.WEB_HOST ?? "127.0.0.1" },
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
