import { spawnSync } from "node:child_process";
if (!process.env.GH_TOKEN) throw new Error("Missing GitHub App token");
// Authentication is inherited only by the trusted preparation process. It never executes candidate code.
const env = {
  ...process.env,
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
  GIT_CONFIG_VALUE_0:
    "AUTHORIZATION: basic " +
    Buffer.from("x-access-token:" + process.env.GH_TOKEN).toString("base64"),
};
const args = [
  "scripts/upstream/check.mjs",
  "--publish",
  ...(process.env.DISCOVER === "true" ? ["--discover"] : []),
];
const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
process.exitCode = result.status ?? 1;
