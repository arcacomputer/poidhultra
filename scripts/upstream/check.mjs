import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GitHub } from "./github.mjs";
import {
  git,
  readJSON,
  validateRegistry,
  compareHistory,
  selectActive,
  classify,
  prBody,
} from "./core.mjs";

const root = process.cwd();
const registry = validateRegistry(readJSON("upstream/registry.json"));
const publish = process.argv.includes("--publish");
const discover = process.argv.includes("--discover");
if (publish && !process.env.GH_TOKEN)
  throw new Error("Publication requires a repository-scoped GitHub App token");
const github = new GitHub({ token: process.env.GH_TOKEN });
const repository = registry.repository;
const out = resolve("upstream/reports");
mkdirSync(out, { recursive: true });
const writeJSON = (file, value) =>
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const status = {
  version: 1,
  startedAt: new Date().toISOString(),
  completedAt: null,
  successful: false,
  sources: [],
  discovery: null,
};
const metadata = (
  await github.request(`/repos/${repository}`).catch((e) => {
    if (!publish && e.status === 404)
      return { data: { default_branch: "main" } };
    throw e;
  })
).data;
const defaultBranch = metadata.default_branch;
const pulls = publish
  ? await github.all(`/repos/${repository}/pulls?state=open`)
  : [];
const issues = publish
  ? await github.all(`/repos/${repository}/issues?state=all`)
  : [];

async function trackingIssue(marker, title, body) {
  const existing = issues.find(
    (issue) => !issue.pull_request && issue.body?.includes(marker)
  );
  if (existing) {
    if (existing.body !== marker + "\n" + body || existing.state !== "open")
      await github.request(`/repos/${repository}/issues/${existing.number}`, {
        method: "PATCH",
        body: { body: marker + "\n" + body, state: "open" },
      });
    return existing.html_url;
  }
  const { data } = await github.request(`/repos/${repository}/issues`, {
    method: "POST",
    body: { title, body: marker + "\n" + body },
  });
  issues.push(data);
  return data.html_url;
}
async function prepare(source, report) {
  const branch = `codex/upstream/${source.id}`;
  const dir = mkdtempSync(join(tmpdir(), "poidh-candidate-"));
  rmSync(dir, { recursive: true });
  // Worktree starts from the default branch, never from an untrusted PR script.
  git(["worktree", "add", "--detach", dir, "HEAD"]);
  try {
    git(["checkout", "-b", branch], dir);
    let target = report.observedRevision;
    if (source.sourcePrefix) {
      // All root commits remain accounted even when only licensed paths may be copied.
      target = git(
        ["subtree", "split", `--prefix=${source.sourcePrefix}`, target],
        root
      )
        .split("\n")
        .at(-1);
    }
    const task = {
      version: 1,
      source: source.id,
      revision: report.observedRevision,
      range: report.range,
      status: "integrated",
      reason: null,
    };
    try {
      git(["subtree", "merge", `--prefix=${source.path}`, target], dir);
    } catch (error) {
      try {
        git(["merge", "--abort"], dir);
      } catch {}
      task.status = "pending";
      task.reason =
        "Subtree merge requires adaptation. Resolve this range on demand; no incorporation record has advanced.";
    }
    mkdirSync(join(dir, "upstream/tasks"), { recursive: true });
    writeJSON(join(dir, `upstream/tasks/${source.id}.json`), task);
    if (task.status === "integrated")
      writeJSON(join(dir, `upstream/incorporated/${source.id}.json`), {
        version: 1,
        source: source.id,
        revision: report.observedRevision,
        subtreeRevision: target,
        disposition: "integrated",
        reason:
          "Complete upstream range applied by Git subtree. Review Ultra differences and required CI before merge.",
        review: "Required maintainer review of this integration PR",
      });
    git(["add", "upstream"], dir);
    git(
      [
        "commit",
        "-m",
        `chore(upstream): account for ${
          source.id
        } ${report.observedRevision.slice(0, 12)}`,
      ],
      dir
    );
    // Never overwrite an existing remote branch, even after a maintainer closed its PR.
    const existing = git(
      ["ls-remote", "--heads", "origin", `refs/heads/${branch}`],
      dir
    );
    if (existing)
      throw new Error(
        `Remote branch ${branch} already exists without an active PR; maintainer must reconcile it`
      );
    git(["push", "origin", `HEAD:refs/heads/${branch}`], dir);
    const { data: pr } = await github.request(`/repos/${repository}/pulls`, {
      method: "POST",
      body: {
        title: `upstream(${
          source.id
        }): integrate ${report.observedRevision.slice(0, 12)}`,
        head: branch,
        base: defaultBranch,
        draft: task.status === "pending",
        body: prBody(source, report, task),
        maintainer_can_modify: true,
      },
    });
    report.pullRequest = pr.html_url;
    report.status =
      task.status === "pending" ? "blocked-integration" : "pending-review";
  } finally {
    git(["worktree", "remove", "--force", dir]);
    git(["branch", "-D", branch]);
  }
}
for (const source of registry.sources) {
  const lock = readJSON(`upstream/incorporated/${source.id}.json`);
  const report = {
    source: source.id,
    repository: source.repository,
    incorporatedRevision: lock.revision,
    observedRevision: null,
    status: "failed-check",
    range: null,
  };
  try {
    const { data: repo } = await github.request(
      `/repositories/${source.repositoryId}`
    );
    report.repository = repo.full_name;
    report.renamed = repo.full_name !== source.repository;
    const { data: branch } = await github.request(
      `/repos/${repo.full_name}/branches/${encodeURIComponent(source.branch)}`
    );
    report.observedRevision = branch.commit.sha;
    git([
      "fetch",
      "--no-tags",
      `https://github.com/${repo.full_name}.git`,
      report.observedRevision,
    ]);
    const base = lock.revision ?? source.baseline;
    try {
      git(["cat-file", "-e", base]);
    } catch {
      git([
        "fetch",
        "--no-tags",
        `https://github.com/${repo.full_name}.git`,
        base,
      ]);
    }
    report.range = compareHistory(base, report.observedRevision, root);
    report.observations = {
      branches: (await github.all(`/repos/${repo.full_name}/branches`)).map(
        (b) => ({ name: b.name, sha: b.commit.sha })
      ),
      pulls: (
        await github.all(`/repos/${repo.full_name}/pulls?state=open`)
      ).map((p) => ({
        number: p.number,
        url: p.html_url,
        head: p.head.sha,
        base: p.base.ref,
        title: p.title,
      })),
      releases: (await github.all(`/repos/${repo.full_name}/releases`)).map(
        (r) => ({
          id: r.id,
          tag: r.tag_name,
          publishedAt: r.published_at,
          url: r.html_url,
          prerelease: r.prerelease,
        })
      ),
    };
    const active = selectActive(pulls, source.id);
    report.pullRequest = active?.html_url ?? null;
    report.status = classify({
      incorporated: lock.revision,
      observed: report.observedRevision,
      rewritten: report.range.rewritten,
      active,
      licensed: !!source.path,
    });
    if (
      publish &&
      ["blocked-history-rewrite", "blocked-license"].includes(report.status)
    ) {
      report.issue = await trackingIssue(
        `<!-- poidh-blocked:${source.id} -->`,
        `upstream(${source.id}): ${report.status}`,
        `Source: https://github.com/${repo.full_name}\n\nObserved: ${
          report.observedRevision
        }\nIncorporated: ${lock.revision ?? "none"}\n\n${
          report.status === "blocked-license"
            ? "Reuse permission is undeclared. Implement behavior independently and document a reviewed mapping."
            : "History was rewritten. Review both removed and new commits; do not silently reset the baseline."
        }`
      );
    }
    if (publish && report.status === "pending") await prepare(source, report);
    if (publish && active && report.observedRevision !== lock.revision) {
      // New revisions are reported without replacing a maintainer's work on the active PR.
      report.waitingForActiveIntegration = true;
    }
    report.checkedAt = new Date().toISOString();
  } catch (error) {
    report.status = "failed-check";
    report.error = error.message;
  }
  status.sources.push(report);
  writeJSON(join(out, `${source.id}.json`), report);
}
if (discover) {
  try {
    const repos = await github.all(
      `/users/${registry.discoveryOwner}/repos?type=owner&sort=created`
    );
    const known = new Set(registry.sources.map((s) => s.repositoryId));
    status.discovery = {
      checkedAt: new Date().toISOString(),
      repositories: repos.map((r) => ({
        id: r.id,
        name: r.full_name,
        url: r.html_url,
        registered: known.has(r.id),
      })),
    };
    for (const repo of repos.filter((r) => !known.has(r.id)))
      if (publish)
        await trackingIssue(
          `<!-- poidh-discovery:${repo.id} -->`,
          `upstream: assess ${repo.full_name}`,
          `Newly discovered source: ${repo.html_url}\n\nReview licensing, production branch, relationship to poidh, and required integration. Add it to the versioned registry or document an intentional exclusion. Repository identity: ${repo.id}.`
        );
  } catch (error) {
    status.discovery = { error: error.message };
  }
}
status.completedAt = new Date().toISOString();
status.successful =
  status.sources.every((s) => s.status !== "failed-check") &&
  !status.discovery?.error;
writeJSON(join(out, "status.json"), status);
if (publish) {
  const dir = mkdtempSync(join(tmpdir(), "poidh-status-"));
  rmSync(dir, { recursive: true });
  const remote = git([
    "ls-remote",
    "--heads",
    "origin",
    "refs/heads/maintenance-state",
  ]);
  if (remote) {
    git(["fetch", "origin", "maintenance-state"]);
    git(["worktree", "add", "--detach", dir, "FETCH_HEAD"]);
  } else {
    git(["worktree", "add", "--detach", dir, "HEAD"]);
    git(["checkout", "--orphan", "maintenance-state"], dir);
    git(["rm", "-rf", "."], dir);
  }
  try {
    let previous;
    try {
      previous = readJSON(join(dir, "status.json"));
    } catch {}
    status.lastSuccessfulCheck = status.successful
      ? status.completedAt
      : previous?.lastSuccessfulCheck ?? null;
    if (!status.discovery && previous?.discovery)
      status.discovery = previous.discovery;
    writeJSON(join(dir, "status.json"), status);
    git(["add", "status.json"], dir);
    git(
      [
        "commit",
        "-m",
        `maintenance: ${status.successful ? "checked" : "failed"} ${
          status.completedAt
        }`,
      ],
      dir
    );
    git(["push", "origin", "HEAD:refs/heads/maintenance-state"], dir);
  } finally {
    git(["worktree", "remove", "--force", dir]);
  }
}
console.log(
  JSON.stringify(
    {
      successful: status.successful,
      sources: status.sources.map((s) => ({
        source: s.source,
        status: s.status,
        error: s.error,
      })),
      report: join(out, "status.json"),
    },
    null,
    2
  )
);
if (!status.successful) process.exitCode = 1;
