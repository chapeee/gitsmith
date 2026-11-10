import test from "node:test";
import assert from "node:assert/strict";
import { describeRules, renderRulesMarkdown } from "../src/agent/rules.js";
import { hasCommitFlags } from "../src/commands/commit.js";
import { HOOK_MARKER, HOOK_SCRIPT } from "../src/commands/hook.js";

const config = {
  types: ["feat", "fix"],
  askScope: true,
  scopes: ["api"],
  askTicket: false,
  askBreaking: true,
  format: "{type}({scope}): {message}",
  headerMaxLength: 72
};

test("hasCommitFlags detects no-prompt mode", () => {
  assert.equal(hasCommitFlags({}), false);
  assert.equal(hasCommitFlags({ aiMode: "auto", breaking: false }), false);
  assert.equal(hasCommitFlags({ type: "feat" }), true);
  assert.equal(hasCommitFlags({ breaking: true }), true);
});

test("describeRules exposes a commit command agents can copy", () => {
  const rules = describeRules(config);
  assert.equal(rules.example, "feat(api): add short summary in imperative mood");
  assert.equal(rules.commands.commit, 'gitsmith -t feat -s api -m "<imperative summary>"');
  assert.deepEqual(rules.scope, { used: true, allowed: ["api"], strict: false });
});

test("renderRulesMarkdown lists types, scopes and the command", () => {
  const markdown = renderRulesMarkdown(config);
  assert.match(markdown, /`feat`, `fix`/);
  assert.match(markdown, /`api`/);
  assert.match(markdown, /gitsmith -t feat -s api/);
});

test("hook script is marked and calls gitsmith check with the message file", () => {
  assert.ok(HOOK_SCRIPT.startsWith("#!/bin/sh"));
  assert.ok(HOOK_SCRIPT.includes(HOOK_MARKER));
  assert.ok(HOOK_SCRIPT.includes('check --file "$1"'));
});

test("gitsmith init defaults to strict scopes and conventional message style", async () => {
  const { defaultConfig } = await import("../src/config/default.js");
  assert.equal(defaultConfig.strictScopes, true);
  assert.equal(defaultConfig.messageStyle, "conventional");
});
