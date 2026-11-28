import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePorcelainZ } from "../src/git/executor.js";

const CLI = fileURLToPath(new URL("../bin/cli.js", import.meta.url));
const hasGit = spawnSync("git", ["--version"]).status === 0;
const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });

test("parsePorcelainZ keeps paths unquoted and reads renames", () => {
  const out = "R  new.txt\0old.txt\0?? my file.txt\0 M src/café.js\0";
  assert.deepEqual(parsePorcelainZ(out), [
    { x: "R", y: " ", path: "new.txt", from: "old.txt" },
    { x: "?", y: "?", path: "my file.txt" },
    { x: " ", y: "M", path: "src/café.js" }
  ]);
  assert.deepEqual(parsePorcelainZ(""), []);
});

function createRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gitsmith-status-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "dev@example.com");
  git(dir, "config", "user.name", "dev");
  spawnSync(process.execPath, [CLI, "init"], { cwd: dir });
  writeFileSync(path.join(dir, "old.txt"), "a\n");
  writeFileSync(path.join(dir, "gone.txt"), "b\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

function commitFiles(dir, message, files) {
  const result = spawnSync(
    process.execPath,
    [CLI, "-t", "fix", "-s", "api", "-m", message, "--json", "--files", ...files],
    { cwd: dir, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } }
  );
  return JSON.parse(result.stdout);
}

test("--files accepts renamed, deleted and space-containing paths", { skip: !hasGit && "git not installed" }, (t) => {
  const dir = createRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  git(dir, "mv", "old.txt", "new.txt");
  unlinkSync(path.join(dir, "gone.txt"));
  writeFileSync(path.join(dir, "my file.txt"), "x\n");

  assert.equal(commitFiles(dir, "rename file", ["new.txt", "old.txt"]).ok, true);
  assert.match(git(dir, "show", "--stat", "--format=", "HEAD").stdout, /old\.txt => new\.txt/);

  assert.equal(commitFiles(dir, "remove file", ["gone.txt"]).ok, true);
  assert.equal(commitFiles(dir, "add file", ["my file.txt"]).ok, true);
  assert.equal(git(dir, "status", "--porcelain").stdout, "");
});
