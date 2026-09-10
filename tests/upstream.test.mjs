import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHub } from "../scripts/upstream/github.mjs";
import {
  git,
  readJSON,
  validateRegistry,
  selectActive,
  classify,
  compareHistory,
} from "../scripts/upstream/core.mjs";

test("all six sources are registered; undeclared licenses cannot be imported", () => {
  const registry = validateRegistry(readJSON("upstream/registry.json"));
  assert.equal(registry.sources.length, 6);
  assert.equal(registry.sources.find((s) => s.id === "app").branch, "prod");
  assert.equal(registry.sources.find((s) => s.id === "indexer").path, null);
  assert.throws(() =>
    validateRegistry({
      ...registry,
      sources: [{ ...registry.sources[0], license: null }],
    })
  );
});
test("repeated detection reuses one PR and never marks it incorporated", () => {
  const pulls = [
    {
      state: "open",
      head: { ref: "codex/upstream/app" },
      number: 7,
      draft: false,
    },
  ];
  for (let i = 0; i < 3; i++) {
    const active = selectActive(pulls, "app");
    assert.equal(active.number, 7);
    assert.equal(
      classify({
        incorporated: "old",
        observed: "new",
        active,
        licensed: true,
      }),
      "pending-review"
    );
  }
  assert.throws(() => selectActive([...pulls, ...pulls], "app"));
  assert.equal(
    classify({ incorporated: "a", observed: "a", licensed: true }),
    "current"
  );
  assert.equal(
    classify({ rewritten: true, licensed: true }),
    "blocked-history-rewrite"
  );
  assert.equal(classify({ licensed: false }), "blocked-license");
});
test("GitHub pagination and transient errors preserve all results", async () => {
  let calls = 0;
  const github = new GitHub({
    wait: async () => {},
    fetcher: async (url) => {
      calls++;
      if (calls === 1) return new Response("retry", { status: 502 });
      return new Response(
        JSON.stringify(
          url.searchParams.get("page") === "2" ? [{ id: 2 }] : [{ id: 1 }]
        ),
        {
          headers:
            calls === 2
              ? {
                  link: '<https://api.github.com/repos/a/b/branches?page=2>; rel="next"',
                }
              : {},
        }
      );
    },
  });
  assert.deepEqual(await github.all("/repos/a/b/branches"), [
    { id: 1 },
    { id: 2 },
  ]);
  assert.equal(calls, 3);
  await assert.rejects(github.request("https://untrusted.example"), /origin/);
});
test("complete ranges include renames and rewritten history", () => {
  const dir = mkdtempSync(join(tmpdir(), "poidh-git-test-"));
  try {
    git(["init", "-b", "main"], dir);
    git(["config", "user.name", "Test"], dir);
    git(["config", "user.email", "test@example.invalid"], dir);
    writeFileSync(join(dir, "first.txt"), "initial");
    git(["add", "."], dir);
    git(["commit", "-m", "initial"], dir);
    const base = git(["rev-parse", "HEAD"], dir);
    git(["mv", "first.txt", "renamed.txt"], dir);
    git(["commit", "-m", "rename"], dir);
    const next = git(["rev-parse", "HEAD"], dir);
    const range = compareHistory(base, next, dir);
    assert.equal(range.commits.length, 1);
    assert.equal(range.files[0].previousPath, "first.txt");
    assert.equal(range.rewritten, false);
    git(["checkout", "-b", "rewrite", base], dir);
    writeFileSync(join(dir, "other"), "rewritten");
    git(["add", "."], dir);
    git(["commit", "-m", "different"], dir);
    const rewritten = compareHistory(
      next,
      git(["rev-parse", "HEAD"], dir),
      dir
    );
    assert.equal(rewritten.rewritten, true);
    assert.equal(rewritten.removedCommits[0], next);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("subtree integration preserves an Ultra adapter and exposes conflicts", () => {
  const parent = mkdtempSync(join(tmpdir(), "poidh-subtree-test-"));
  const source = join(parent, "source");
  const target = join(parent, "target");
  const init = (dir) => {
    git(["init", "-b", "main", dir]);
    git(["config", "user.name", "Test"], dir);
    git(["config", "user.email", "test@example.invalid"], dir);
  };
  try {
    init(source);
    writeFileSync(join(source, "app.txt"), "original\n");
    git(["add", "."], source);
    git(["commit", "-m", "initial upstream"], source);
    const first = git(["rev-parse", "HEAD"], source);
    init(target);
    writeFileSync(join(target, "README"), "Ultra");
    git(["add", "."], target);
    git(["commit", "-m", "initial Ultra"], target);
    git(["update-index", "--refresh"], target);
    git(["subtree", "add", "--prefix=apps/web", source, "main"], target);
    writeFileSync(join(target, "adapter.txt"), "Cloudflare adapter\n");
    git(["add", "."], target);
    git(["commit", "-m", "adapter"], target);
    git(["update-index", "--refresh"], target);
    writeFileSync(join(source, "new-feature.txt"), "new upstream feature");
    git(["add", "."], source);
    git(["commit", "-m", "feature"], source);
    const second = git(["rev-parse", "HEAD"], source);
    git(["fetch", source, "main"], target);
    git(["subtree", "merge", "--prefix=apps/web", second], target);
    assert.equal(
      git(["show", "HEAD:adapter.txt"], target),
      "Cloudflare adapter"
    );
    assert.equal(
      git(["show", "HEAD:apps/web/new-feature.txt"], target),
      "new upstream feature"
    );
    writeFileSync(join(target, "apps/web/app.txt"), "Ultra behavior\n");
    git(["add", "."], target);
    git(["commit", "-m", "Ultra change"], target);
    git(["update-index", "--refresh"], target);
    writeFileSync(join(source, "app.txt"), "Conflicting upstream behavior\n");
    git(["add", "."], source);
    git(["commit", "-m", "conflict"], source);
    git(["fetch", source, "main"], target);
    assert.throws(() =>
      git(["subtree", "merge", "--prefix=apps/web", "FETCH_HEAD"], target)
    );
    assert.match(
      git(["diff", "--name-only", "--diff-filter=U"], target),
      /app.txt/
    );
    git(["merge", "--abort"], target);
    assert.equal(
      git(["show", "HEAD:apps/web/app.txt"], target),
      "Ultra behavior"
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
