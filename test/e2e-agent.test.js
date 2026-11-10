// End-to-end: drives the real CLI the way an AI agent does (no terminal, stdin closed)
// inside a throwaway git repo, so the agent-facing behaviour is tested as shipped.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../bin/cli.js", import.meta.url));
const hasGit = spawnSync("git", ["--version"]).status === 0;

function run(cwd, command, args) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1", GITSMITH_AI_KEY: "" }
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const gitsmith = (cwd, ...args) => run(cwd, process.execPath, [CLI, ...args]);
const git = (cwd, ...args) => run(cwd, "git", args);

function createRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gitsmith-e2e-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "agent@example.com");
  git(dir, "config", "user.name", "agent");
  git(dir, "config", "core.autocrlf", "false");
  assert.equal(gitsmith(dir, "init").code, 0);
  writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
  return dir;
}

function stage(dir, name) {
  writeFileSync(path.join(dir, name), `${name}\n`);
  git(dir, "add", "-A");
}

const lastSubject = (dir) => git(dir, "log", "-1", "--format=%s").stdout.trim();
const commitCount = (dir) => {
  const result = git(dir, "rev-list", "--count", "HEAD");
  return result.code === 0 ? Number(result.stdout.trim()) : 0;
};

test("e2e: agent workflow with the real CLI", { skip: !hasGit && "git not installed" }, async (t) => {
  const dir = createRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  await t.test("no flags and no terminal exits 1 instead of hanging or faking success", () => {
    stage(dir, "a.txt");
    const result = gitsmith(dir);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /needs an interactive terminal/);
    assert.equal(commitCount(dir), 0);
  });

  await t.test("rules --json tells the agent what is allowed", () => {
    const result = gitsmith(dir, "rules", "--json");
    assert.equal(result.code, 0);
    const rules = JSON.parse(result.stdout);
    assert.ok(rules.types.includes("feat"));
    assert.equal(rules.scope.strict, true);
    assert.equal(rules.messageStyle, "conventional");
    assert.match(rules.commands.commit, /^gitsmith -t feat -s \w+ -m /);
  });

  await t.test("a sloppy message is rejected with every reason and nothing is committed", () => {
    const result = gitsmith(dir, "-t", "feat", "-s", "validation", "-m", "Add checks.", "--json");
    assert.equal(result.code, 1);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.errors.length, 3);
    assert.equal(commitCount(dir), 0);
  });

  await t.test("dry run previews without committing", () => {
    const result = gitsmith(dir, "-t", "feat", "-s", "api", "-m", "add checks", "--dry-run", "--json");
    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.stdout).header, "feat(api): add checks");
    assert.equal(commitCount(dir), 0);
  });

  await t.test("the corrected retry commits and returns the hash, body and trailer intact", () => {
    const body = "Explain why.\n\nCo-Authored-By: Example Bot <bot@example.com>";
    const result = gitsmith(dir, "-t", "feat", "-s", "api", "-m", "add checks", "--body", body, "--json");
    assert.equal(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.match(output.hash, /^[a-f0-9]{7,40}$/);
    assert.equal(lastSubject(dir), "feat(api): add checks");
    const trailers = git(dir, "log", "-1", "--format=%(trailers:key=Co-Authored-By,valueonly)").stdout.trim();
    assert.equal(trailers, "Example Bot <bot@example.com>");
  });

  await t.test("check accepts good headers and rejects bad ones by exit code", () => {
    assert.equal(gitsmith(dir, "check", "fix(ui): handle empty input").code, 0);
    assert.equal(gitsmith(dir, "check", "updated stuff").code, 1);
  });

  await t.test("the hook blocks a bad plain git commit and lets a good one through", () => {
    // Point the hook at this checkout of gitsmith the way a local install would.
    const binDir = path.join(dir, "node_modules", ".bin");
    mkdirSync(binDir, { recursive: true });
    const shim = path.join(binDir, "gitsmith");
    writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath.replace(/\\/g, "/")}" "${CLI.replace(/\\/g, "/")}" "$@"\n`);
    chmodSync(shim, 0o755);

    assert.equal(gitsmith(dir, "hook", "install").code, 0);
    stage(dir, "b.txt");
    const before = commitCount(dir);

    const bad = git(dir, "commit", "-q", "-m", "wip");
    assert.notEqual(bad.code, 0);
    assert.match(bad.stderr, /commit message rejected/);
    assert.equal(commitCount(dir), before);

    const good = git(dir, "commit", "-q", "-m", "fix(ui): add b file");
    assert.equal(good.code, 0, good.stderr);
    assert.equal(lastSubject(dir), "fix(ui): add b file");

    assert.equal(gitsmith(dir, "hook", "uninstall").code, 0);
  });

  await t.test("agents writes the rules into AGENTS.md once, however often it runs", () => {
    gitsmith(dir, "agents");
    gitsmith(dir, "agents");
    const content = readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    assert.equal(content.split("<!-- gitsmith:start -->").length, 2);
    assert.match(content, /gitsmith -t feat -s/);
  });
});
