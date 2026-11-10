import test from "node:test";
import assert from "node:assert/strict";
import { buildUserPrompt } from "../src/ai/nvidia.js";
import { aiUnavailableReason } from "../src/commands/agent.js";
import { validatePeople } from "../src/commands/commit.js";
import { buildCommitBody, isValidPerson } from "../src/git/executor.js";

const config = {
  types: ["feat", "fix"],
  scopes: ["api"],
  askScope: true,
  askTicket: false,
  askBreaking: true,
  ai: { enabled: true, allowNewScopes: false }
};

test("buildUserPrompt includes the staged diff when given", () => {
  const prompt = buildUserPrompt(config, "", { stat: " src/a.js | 2 +-", diff: "+const a = 1;" });
  assert.match(prompt, /Staged changes/);
  assert.match(prompt, /src\/a\.js/);
  assert.match(prompt, /\+const a = 1;/);
  assert.doesNotMatch(prompt, /What I did/);
});

test("buildUserPrompt works with only a description, as before", () => {
  const prompt = buildUserPrompt(config, "fix login");
  assert.match(prompt, /What I did: fix login/);
  assert.doesNotMatch(prompt, /Staged changes/);
});

test("isValidPerson accepts git's Name <email> shape only", () => {
  assert.equal(isValidPerson("Claude <noreply@anthropic.com>"), true);
  assert.equal(isValidPerson("Claude"), false);
  assert.equal(isValidPerson("<noreply@anthropic.com>"), false);
  assert.equal(isValidPerson("Claude noreply@anthropic.com"), false);
});

test("buildCommitBody puts Co-Authored-By trailers last", () => {
  assert.equal(
    buildCommitBody("Why it changed.", ["Claude <noreply@anthropic.com>", "Pat <pat@example.com>"]),
    "Why it changed.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nCo-Authored-By: Pat <pat@example.com>"
  );
  assert.equal(buildCommitBody("", ["Claude <noreply@anthropic.com>"]), "Co-Authored-By: Claude <noreply@anthropic.com>");
  assert.equal(buildCommitBody("Only body", undefined), "Only body");
});

test("validatePeople reports malformed --author and --co-author", () => {
  assert.deepEqual(validatePeople({ author: "Claude <noreply@anthropic.com>" }), []);
  assert.equal(validatePeople({ author: "Claude", coAuthor: ["nobody"] }).length, 2);
});

test("aiUnavailableReason explains when the agent cannot use AI", () => {
  assert.match(aiUnavailableReason({ ...config, ai: undefined }, "key"), /AI is off/);
  assert.match(aiUnavailableReason(config, null), /No NVIDIA API key/);
  assert.equal(aiUnavailableReason(config, "key"), null);
});
