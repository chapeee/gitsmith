import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeConfigs, resolveConfig } from "../src/config/resolve.js";
import { toShareableRules } from "../src/commands/rules.js";

function tempDir(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gitsmith-extends-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const write = (file, value) => writeFileSync(file, JSON.stringify(value));

test("mergeConfigs replaces lists, merges objects and appends with key+", () => {
  const sources = {};
  const merged = mergeConfigs(
    { types: ["feat"], scopes: ["api"], ai: { enabled: true, model: "a" } },
    { types: ["fix"], "scopes+": ["ui", "api"], ai: { model: "b" } },
    "project",
    sources
  );
  assert.deepEqual(merged.types, ["fix"]);
  assert.deepEqual(merged.scopes, ["api", "ui"]);
  assert.deepEqual(merged.ai, { enabled: true, model: "b" });
  assert.equal(sources.types, "project");
  assert.equal(sources["ai.model"], "project");
});

test("resolveConfig follows presets and files, with the project winning", async (t) => {
  const dir = tempDir(t);
  mkdirSync(path.join(dir, "team"));
  write(path.join(dir, "team", "base.json"), { extends: "gitsmith:conventional", scopes: ["billing"], headerMaxLength: 90 });
  const configPath = path.join(dir, ".commitconfig.json");

  const { config, sources, chain } = await resolveConfig(
    { extends: "./team/base.json", "scopes+": ["infra"], headerMaxLength: 100 },
    { configPath }
  );

  assert.deepEqual(chain, ["gitsmith:conventional", "team/base.json", ".commitconfig.json"]);
  assert.deepEqual(config.scopes, ["billing", "infra"]);
  assert.equal(config.headerMaxLength, 100);
  assert.equal(config.format, "{type}({scope}): {message}");
  assert.equal(sources.types, "gitsmith:conventional");
  assert.equal(sources.headerMaxLength, ".commitconfig.json");
  assert.equal(sources.scopes, "team/base.json + .commitconfig.json");
});

test("several extends apply in order, later ones winning", async (t) => {
  const dir = tempDir(t);
  write(path.join(dir, "a.json"), { headerMaxLength: 50, messageStyle: "off" });
  const { config } = await resolveConfig({ extends: ["./a.json", "gitsmith:angular"] }, { configPath: path.join(dir, ".commitconfig.json") });
  assert.equal(config.headerMaxLength, 100);
  assert.equal(config.messageStyle, "conventional");
});

test("extends loops and unknown presets are reported clearly", async (t) => {
  const dir = tempDir(t);
  write(path.join(dir, "a.json"), { extends: "./b.json" });
  write(path.join(dir, "b.json"), { extends: "./a.json" });
  const configPath = path.join(dir, ".commitconfig.json");
  await assert.rejects(resolveConfig({ extends: "./a.json" }, { configPath }), /loops back/);
  await assert.rejects(resolveConfig({ extends: "gitsmith:nope" }, { configPath }), /Unknown preset "gitsmith:nope"/);
  await assert.rejects(resolveConfig({ extends: "./missing.json" }, { configPath }), /Could not read rules file/);
});

test("an npm package can ship gitsmith.json", async (t) => {
  const dir = tempDir(t);
  const pkgDir = path.join(dir, "node_modules", "@acme", "gitsmith-rules");
  mkdirSync(pkgDir, { recursive: true });
  write(path.join(pkgDir, "package.json"), { name: "@acme/gitsmith-rules", version: "1.0.0" });
  write(path.join(pkgDir, "gitsmith.json"), { extends: "gitsmith:minimal", headerMaxLength: 60 });
  const { config, chain } = await resolveConfig({ extends: "@acme/gitsmith-rules" }, { configPath: path.join(dir, ".commitconfig.json") });
  assert.equal(config.headerMaxLength, 60);
  assert.equal(config.askScope, false);
  assert.equal(chain[0], "gitsmith:minimal");
});

test("remote rules are cached, pinned and used offline", async (t) => {
  const dir = tempDir(t);
  const body = JSON.stringify({ extends: "gitsmith:conventional", headerMaxLength: 80 });
  const sha = createHash("sha256").update(body).digest("hex");
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(body, { status: 200 });
  };
  const options = { configPath: path.join(dir, ".commitconfig.json"), cacheDir: path.join(dir, "cache"), fetchImpl };
  const url = "https://example.com/rules.json";

  assert.equal((await resolveConfig({ extends: url }, options)).config.headerMaxLength, 80);
  await resolveConfig({ extends: url }, options);
  assert.equal(calls, 1, "second load comes from the cache");

  assert.equal((await resolveConfig({ extends: `${url}#sha256=${sha}` }, options)).config.headerMaxLength, 80);
  await assert.rejects(resolveConfig({ extends: `https://example.com/other.json#sha256=${"0".repeat(64)}` }, options), /pinned sha256/);

  const offline = { ...options, fetchImpl: async () => { throw new Error("offline"); } };
  assert.equal((await resolveConfig({ extends: url }, offline)).config.headerMaxLength, 80);
  await assert.rejects(resolveConfig({ extends: "https://example.com/never.json" }, offline), /Could not download/);
});

test("the personal local file can only change safe ai settings", async (t) => {
  const dir = tempDir(t);
  const { config, warnings } = await resolveConfig(
    { extends: "gitsmith:conventional", ai: { enabled: true, endpoint: "https://integrate.api.nvidia.com/v1/chat/completions" } },
    {
      configPath: path.join(dir, ".commitconfig.json"),
      localJson: { strictScopes: false, ai: { sendDiff: false, endpoint: "http://elsewhere" } }
    }
  );
  assert.equal(config.strictScopes, true);
  assert.equal(config.ai.sendDiff, false);
  assert.equal(config.ai.endpoint, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(warnings.length, 2);
});

test("toShareableRules drops ai and extends", () => {
  const rules = toShareableRules({ types: ["feat"], format: "{type}: {message}", ai: { enabled: true }, extends: "x" });
  assert.deepEqual(rules, { types: ["feat"], format: "{type}: {message}" });
});
