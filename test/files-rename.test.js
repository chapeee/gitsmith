// --files must accept the new path of a staged rename, the path get_status reports.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../bin/cli.js", import.meta.url));
const hasGit = spawnSync("git", ["--version"]).status === 0;
const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });

test("--files accepts the new path of a staged rename", { skip: !hasGit && "git not installed" }, (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gitsmith-rename-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "agent@example.com");
  git(dir, "config", "user.name", "agent");
  spawnSync(process.execPath, [CLI, "init"], { cwd: dir });
  writeFileSync(path.join(dir, "old.js"), "export const a = 1;\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "chore(config): initial");
  git(dir, "mv", "old.js", "new.js");

  const run = spawnSync(
    process.execPath,
    [CLI, "-t", "refactor", "-s", "api", "-m", "rename module", "--files", "new.js", "--dry-run", "--json"],
    { cwd: dir, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } }
  );
  const result = JSON.parse(run.stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.files, ["new.js"]);
});
