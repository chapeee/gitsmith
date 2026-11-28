import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../bin/cli.js", import.meta.url));

const RULES = {
  types: ["feat"],
  askScope: false,
  askTicket: false,
  askBreaking: false,
  format: "{type}: {message}"
};

function checkWithConfig(t, content, files = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gitsmith-loader-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, ".commitconfig.json"), content);
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return spawnSync(process.execPath, [CLI, "check", "feat: add retry"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" }
  });
}

test("config with a UTF-8 byte order mark loads", (t) => {
  const result = checkWithConfig(t, `﻿${JSON.stringify(RULES)}`, {
    ".commitconfig.local.json": `﻿{"ai":{"enabled":false}}`
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Valid commit message/);
});

test("config that is not a JSON object gets a clear error", (t) => {
  for (const content of ["null", "[]", '"rules"']) {
    const result = checkWithConfig(t, content);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\.commitconfig\.json must contain a JSON object/);
  }
});

test("local config that is not a JSON object gets a clear error", (t) => {
  const result = checkWithConfig(t, JSON.stringify(RULES), { ".commitconfig.local.json": "null" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.commitconfig\.local\.json must contain a JSON object/);
});
