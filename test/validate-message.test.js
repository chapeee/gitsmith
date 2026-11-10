import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAndValidate,
  checkCommitMessage,
  formatToRegex,
  messageStyleErrors,
  splitCommitMessage
} from "../src/validate/message.js";

const config = {
  types: ["feat", "fix", "docs"],
  askScope: true,
  scopes: ["api", "ui"],
  askTicket: false,
  askBreaking: true,
  format: "{type}({scope}){breaking}: {message}",
  headerMaxLength: 40
};

test("formatToRegex captures every token", () => {
  const match = "feat(api)!: add retry".match(formatToRegex(config.format));
  assert.deepEqual({ ...match.groups }, { type: "feat", scope: "api", breaking: "!", message: "add retry" });
});

test("formatToRegex treats bracketed scope as optional", () => {
  assert.ok(formatToRegex("{type}({scope}): {message}").test("feat: add retry"));
});

test("checkCommitMessage accepts a valid header", () => {
  const result = checkCommitMessage("fix(ui): handle empty input", config);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("checkCommitMessage rejects unknown type with allowed list", () => {
  const result = checkCommitMessage("feet(api): add x", config);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /type "feet" is not allowed\. Allowed: feat, fix, docs/);
});

test("checkCommitMessage rejects free text", () => {
  const result = checkCommitMessage("updated stuff", config);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /does not match the format/);
});

test("checkCommitMessage requires a scope when a scope list exists", () => {
  const result = checkCommitMessage("feat: add x", config);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /scope is required/);
});

test("unknown scope warns by default and errors with strictScopes", () => {
  assert.equal(checkCommitMessage("feat(cli): add x", config).ok, true);
  assert.equal(checkCommitMessage("feat(cli): add x", config).warnings.length, 1);
  assert.equal(checkCommitMessage("feat(cli): add x", { ...config, strictScopes: true }).ok, false);
});

test("checkCommitMessage skips git-generated messages", () => {
  for (const message of ["Merge branch 'main' into dev", 'Revert "feat(api): add x"', "fixup! feat(api): add x"]) {
    const result = checkCommitMessage(message, config);
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
  }
});

test("checkCommitMessage ignores git comments and the scissors diff", () => {
  const raw = "# Please enter the commit message\nfeat(api): add x\n\nbody line\n# ------------------------ >8 ------------------------\ndiff --git a b\n";
  const result = checkCommitMessage(raw, config);
  assert.equal(result.ok, true);
  assert.equal(result.header, "feat(api): add x");
  assert.equal(result.body, "body line");
});

test("checkCommitMessage warns when the body is not separated by a blank line", () => {
  const result = checkCommitMessage("feat(api): add x\nbody right away", config);
  assert.equal(result.ok, true);
  assert.match(result.warnings.join(), /blank line/);
});

test("splitCommitMessage handles CRLF and empty input", () => {
  assert.deepEqual(splitCommitMessage("feat(api): x\r\n\r\nbody"), { header: "feat(api): x", body: "body", blankAfterHeader: true });
  assert.equal(splitCommitMessage("").header, "");
});

test("buildAndValidate builds the header and warns on length", () => {
  const result = buildAndValidate({ type: "feat", scope: "api", message: "add a much longer summary than allowed here" }, config);
  assert.equal(result.ok, true);
  assert.equal(result.header, "feat(api): add a much longer summary than allowed here");
  assert.match(result.warnings.join(), /limit: 40/);
});

test("buildAndValidate adds the breaking marker", () => {
  assert.equal(buildAndValidate({ type: "fix", scope: "ui", message: "drop x", breaking: true }, config).header, "fix(ui)!: drop x");
});

test("buildAndValidate reports missing type and message", () => {
  const result = buildAndValidate({ scope: "api" }, config);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
});

test("buildAndValidate prepends ticketPrefix and rejects unused ticket", () => {
  const ticketConfig = { ...config, askTicket: true, ticketPrefix: "JIRA-", format: "{type}({scope}): [{ticket}] {message}" };
  assert.equal(
    buildAndValidate({ type: "feat", scope: "api", ticket: "12", message: "add x" }, ticketConfig).header,
    "feat(api): [JIRA-12] add x"
  );
  assert.equal(buildAndValidate({ type: "feat", scope: "api", ticket: "12", message: "add x" }, config).ok, false);
});

test("scope with spaces is an error even when not in the list", () => {
  const result = buildAndValidate({ type: "feat", scope: "my scope", message: "add x" }, config);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /cannot contain spaces/);
});

test("message style rejects a capitalised start and a trailing period", () => {
  const result = checkCommitMessage("feat(api): Add checks.", config);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /lowercase letter: "add checks\."/);
  assert.match(result.errors[1], /must not end with a period/);
});

test("message style allows acronyms at the start", () => {
  assert.equal(checkCommitMessage("feat(api): API keys can rotate", config).ok, true);
});

test("messageStyle off disables the style check", () => {
  assert.equal(checkCommitMessage("feat(api): Add checks.", { ...config, messageStyle: "off" }).ok, true);
});

test("messageStyleErrors is empty for a conventional summary", () => {
  assert.deepEqual(messageStyleErrors("add retry logic", config), []);
});
