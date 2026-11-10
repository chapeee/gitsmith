// End-to-end: launches `gitsmith mcp` as a real subprocess and drives it with the
// official MCP client over stdio, the same way Claude Code or Cursor would.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { withGitsmithServer } from "../src/commands/agents.js";

const CLI = fileURLToPath(new URL("../bin/cli.js", import.meta.url));
const hasGit = spawnSync("git", ["--version"]).status === 0;

const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });

function createRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gitsmith-mcp-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "agent@example.com");
  git(dir, "config", "user.name", "agent");
  git(dir, "config", "core.autocrlf", "false");
  spawnSync(process.execPath, [CLI, "init"], { cwd: dir });
  return dir;
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  return { isError: Boolean(result.isError), data: JSON.parse(result.content[0].text) };
}

test("e2e: gitsmith MCP server", { skip: !hasGit && "git not installed" }, async (t) => {
  const dir = createRepo();
  const client = new Client({ name: "gitsmith-test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [CLI, "mcp"],
      cwd: dir,
      env: { ...process.env, NO_COLOR: "1" },
      stderr: "pipe"
    })
  );
  t.after(async () => {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  await t.test("lists the tools and sends workflow instructions", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["check_message", "commit", "get_diff", "get_rules", "get_status"]);
    assert.equal(tools.find((tool) => tool.name === "get_rules").annotations.readOnlyHint, true);
    assert.match(client.getInstructions(), /Use it for every commit instead of plain git commit/);
  });

  await t.test("get_rules returns the rules and where they came from", async () => {
    const { isError, data } = await call(client, "get_rules");
    assert.equal(isError, false);
    assert.ok(data.types.includes("feat"));
    assert.equal(data.scope.strict, true);
    assert.deepEqual(data.resolvedFrom, [".commitconfig.json"]);
  });

  await t.test("get_status shows untracked work", async () => {
    writeFileSync(path.join(dir, "api.js"), "export const api = 1;\n");
    writeFileSync(path.join(dir, "ui.js"), "export const ui = 1;\n");
    const { data } = await call(client, "get_status");
    assert.deepEqual(data.untracked.sort(), [".commitconfig.json", "api.js", "ui.js"]);
    assert.deepEqual(data.staged, []);
  });

  await t.test("check_message flags rule breaks with isError", async () => {
    const bad = await call(client, "check_message", { message: "feat(validation): Add checks." });
    assert.equal(bad.isError, true);
    assert.equal(bad.data.errors.length, 3);
    const good = await call(client, "check_message", { message: "feat(api): add checks" });
    assert.equal(good.isError, false);
  });

  await t.test("a rejected commit explains the fix and commits nothing", async () => {
    const { isError, data } = await call(client, "commit", { type: "feet", scope: "api", message: "add api", files: ["api.js"] });
    assert.equal(isError, true);
    assert.match(data.errors[0], /type "feet" is not allowed/);
    assert.notEqual(git(dir, "rev-parse", "--verify", "-q", "HEAD").status, 0);
  });

  await t.test("commit with files splits work into separate commits", async () => {
    const first = await call(client, "commit", {
      type: "chore",
      scope: "config",
      message: "add gitsmith config",
      files: [".commitconfig.json"]
    });
    assert.equal(first.isError, false, JSON.stringify(first.data));

    const second = await call(client, "commit", {
      type: "feat",
      scope: "api",
      message: "add api module",
      files: ["api.js"],
      co_authors: ["Claude <noreply@anthropic.com>"]
    });
    assert.equal(second.isError, false, JSON.stringify(second.data));
    assert.match(second.data.hash, /^[a-f0-9]{7,40}$/);

    const subjects = git(dir, "log", "--format=%s").stdout.trim().split("\n");
    assert.deepEqual(subjects, ["feat(api): add api module", "chore(config): add gitsmith config"]);
    assert.equal(git(dir, "show", "--name-only", "--format=", "HEAD").stdout.trim(), "api.js");
    assert.equal(
      git(dir, "log", "-1", "--format=%(trailers:key=Co-Authored-By,valueonly)").stdout.trim(),
      "Claude <noreply@anthropic.com>"
    );

    // ui.js was never named, so it stays uncommitted.
    const { data } = await call(client, "get_status");
    assert.deepEqual(data.untracked, ["ui.js"]);
  });

  await t.test("get_diff shows changes for specific paths", async () => {
    writeFileSync(path.join(dir, "api.js"), "export const api = 2;\n");
    const { data } = await call(client, "get_diff", { paths: ["api.js"] });
    assert.match(data.diff, /\+export const api = 2;/);
  });

  await t.test("commit refuses paths with no changes", async () => {
    const { isError, data } = await call(client, "commit", { type: "fix", scope: "ui", message: "fix ui", files: ["missing.js"] });
    assert.equal(isError, true);
    assert.match(data.errors[0], /no changes to commit: missing\.js/);
  });
});

test("withGitsmithServer adds gitsmith and keeps other servers", () => {
  const result = withGitsmithServer({ mcpServers: { other: { command: "x" } } });
  assert.deepEqual(Object.keys(result.mcpServers).sort(), ["gitsmith", "other"]);
  assert.deepEqual(result.mcpServers.gitsmith.args, ["-y", "gitsmith", "mcp"]);
  assert.deepEqual(withGitsmithServer(null).mcpServers.gitsmith.command, "npx");
});
