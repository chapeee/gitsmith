import test from "node:test";
import assert from "node:assert/strict";
import { describeRules, renderRulesMarkdown } from "../src/agent/rules.js";
import { SECTION_END, SECTION_START, upsertSection } from "../src/commands/agents.js";
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

test("upsertSection creates, appends and replaces without touching other content", () => {
  assert.equal(upsertSection(null, "A"), `${SECTION_START}\nA\n${SECTION_END}\n`);

  const appended = upsertSection("# Title\n", "A");
  assert.equal(appended, `# Title\n\n${SECTION_START}\nA\n${SECTION_END}\n`);

  const replaced = upsertSection(`${appended}\nfooter\n`, "B");
  assert.match(replaced, /# Title/);
  assert.match(replaced, /footer/);
  assert.match(replaced, /\nB\n/);
  assert.doesNotMatch(replaced, /\nA\n/);
});

test("hook script is marked and calls gitsmith check with the message file", () => {
  assert.ok(HOOK_SCRIPT.startsWith("#!/bin/sh"));
  assert.ok(HOOK_SCRIPT.includes(HOOK_MARKER));
  assert.ok(HOOK_SCRIPT.includes('check --file "$1"'));
});
