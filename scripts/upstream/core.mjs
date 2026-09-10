import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const readJSON = (path) => JSON.parse(readFileSync(path, "utf8"));
export const shaPattern = /^[a-f0-9]{40}$/;
export function validateRegistry(registry) {
  if (registry.version !== 1) throw new Error("Unknown registry version");
  const ids = new Set();
  for (const source of registry.sources) {
    if (!/^[a-z][a-z0-9-]+$/.test(source.id) || ids.has(source.id))
      throw new Error("Invalid/duplicate source");
    if (
      !/^[\w.-]+\/[\w.-]+$/.test(source.repository) ||
      !Number.isSafeInteger(source.repositoryId)
    )
      throw new Error("Invalid repository");
    if (!shaPattern.test(source.baseline))
      throw new Error("Missing exact baseline");
    if (
      source.path &&
      (!source.license ||
        source.path.includes("..") ||
        source.path.startsWith("/"))
    )
      throw new Error("Unlicensed/unsafe import");
    ids.add(source.id);
  }
  return registry;
}
export function git(args, cwd = process.cwd()) {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
export function compareHistory(base, head, cwd) {
  if (!shaPattern.test(base) || !shaPattern.test(head))
    throw new Error("Invalid revision");
  const ancestor = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", base, head],
    { cwd }
  );
  if (ancestor.status !== 0 && ancestor.status !== 1)
    throw new Error("Cannot inspect complete history");
  const rewritten = ancestor.status === 1;
  // Git enumerates the complete range, without the REST compare endpoint's file/commit limits.
  const commits = git(["rev-list", "--reverse", `${base}..${head}`], cwd)
    .split("\n")
    .filter(Boolean);
  const raw = execFileSync(
    "git",
    ["diff", "--name-status", "-z", "--find-renames", base, head],
    { cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }
  );
  const tokens = raw.split("\0");
  const files = [];
  for (let i = 0; i < tokens.length - 1; ) {
    const status = tokens[i++];
    const path = tokens[i++];
    files.push(
      status[0] === "R" || status[0] === "C"
        ? { status, previousPath: path, path: tokens[i++] }
        : { status, path }
    );
  }
  return {
    base,
    head,
    rewritten,
    commits,
    files,
    removedCommits: rewritten
      ? git(["rev-list", `${head}..${base}`], cwd)
          .split("\n")
          .filter(Boolean)
      : [],
  };
}
export function selectActive(pulls, sourceId) {
  const branch = `codex/upstream/${sourceId}`;
  const active = pulls.filter(
    (p) => p.state === "open" && p.head.ref === branch
  );
  if (active.length > 1)
    throw new Error(`Duplicate active updates for ${sourceId}`);
  return active[0] ?? null;
}
export function classify({
  incorporated,
  observed,
  rewritten,
  active,
  licensed,
}) {
  if (rewritten) return "blocked-history-rewrite";
  if (!licensed) return "blocked-license";
  if (incorporated === observed) return "current";
  if (active) return active.draft ? "blocked-integration" : "pending-review";
  return "pending";
}
export function prBody(source, report, task) {
  const affected = [
    ...new Set(
      report.range.files.map((f) => f.path.split("/").slice(0, 2).join("/"))
    ),
  ];
  return (
    `<!-- poidh-upstream:${source.id}:${report.observedRevision} -->\n` +
    `Integrate [${report.repository}](https://github.com/${report.repository}) branch \`${source.branch}\`.\n\n` +
    `From \`${report.range.base}\` to \`${report.observedRevision}\` (${report.range.commits.length} commits, ${report.range.files.length} files).\n\n` +
    `Complete commit/file accounting: \`upstream/tasks/${source.id}.json\`. ` +
    `[Source comparison](https://github.com/${report.repository}/compare/${report.range.base}...${report.observedRevision}).\n\n` +
    `Affected areas: ${
      affected
        .slice(0, 30)
        .map((p) => "`" + p + "`")
        .join(", ") || "history only"
    }.\n\n` +
    `Preparation: ${task.status}. ${task.reason || ""}\n\n` +
    `Validation: candidate CI must run upstream tests, Ultra regression/API checks, and Cloudflare builds. No tests run in the credentialed preparation job. Check results are attached to this PR by CI.\n\n` +
    `Remaining review: confirm behavior, licenses, intentional differences, and test results. Deployment destinations require independent on-chain verification.\n\n` +
    `- [ ] Maintainer reviewed the complete upstream range and Ultra differences\n- [ ] Required checks passed\n- [ ] Any adapted or intentionally different changes have a reason recorded\n\n` +
    `Incorporation advances only when the integration and its record are merged into the default branch. Do not merge unresolved integration tasks.`
  );
}
