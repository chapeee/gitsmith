import test from "node:test";
import assert from "node:assert/strict";
import { findMarkers, planSectionUpdate, SECTION_END } from "../src/agent/section.js";
import { planMcpUpdate, MCP_SERVER_ENTRY } from "../src/commands/agents.js";

const RULES_V1 = "## Commit messages\n\nUse feat or fix.";
const RULES_V2 = "## Commit messages\n\nUse feat, fix or docs.";

const startMarkers = (text) => (text.match(/^<!-- gitsmith:start hash=[a-f0-9]{12} -->$/gm) ?? []).length;
const endMarkers = (text) => (text.match(/^<!-- gitsmith:end -->$/gm) ?? []).length;

// Text outside the managed block must survive byte for byte.
function outside(text) {
  const start = text.search(/^<!-- gitsmith:start/m);
  const endIndex = text.indexOf(SECTION_END);
  return [text.slice(0, start), text.slice(endIndex + SECTION_END.length)];
}

test("creates a new file with one section", () => {
  const plan = planSectionUpdate(null, RULES_V1);
  assert.equal(plan.status, "created");
  assert.equal(startMarkers(plan.content), 1);
  assert.equal(endMarkers(plan.content), 1);
  assert.match(plan.content, /Use feat or fix\./);
});

test("appends to existing content without changing a single byte of it", () => {
  for (const existing of ["# My rules\n\nBe nice.\n", "# My rules\n\nBe nice.", "# Mine\n\n\n   ", "﻿# BOM file\n", "# Mine\n\n"]) {
    const plan = planSectionUpdate(existing, RULES_V1);
    assert.equal(plan.status, "appended");
    assert.ok(plan.content.startsWith(existing), `prefix kept for ${JSON.stringify(existing)}`);
    assert.equal(startMarkers(plan.content), 1);
  }
});

test("keeps Windows line endings consistent", () => {
  const existing = "# Mine\r\nline\r\n";
  const plan = planSectionUpdate(existing, RULES_V1);
  assert.ok(plan.content.startsWith(existing));
  assert.doesNotMatch(plan.content.replace(/\r\n/g, ""), /\n/, "no bare LF mixed in");
});

test("repeated runs are idempotent: no rewrite, no duplicates", () => {
  const first = planSectionUpdate("# Mine\n", RULES_V1).content;
  const second = planSectionUpdate(first, RULES_V1);
  assert.equal(second.status, "unchanged");
  assert.equal(second.content, null);
});

test("updates only inside the markers when the rules change", () => {
  const before = `# Top\n\nmy intro\n\n${planSectionUpdate(null, RULES_V1).content}\n## After\nmy footer\n`;
  const plan = planSectionUpdate(before, RULES_V2);
  assert.equal(plan.status, "updated");
  assert.deepEqual(outside(plan.content), outside(before));
  assert.match(plan.content, /feat, fix or docs/);
  assert.doesNotMatch(plan.content, /Use feat or fix\./);
  assert.equal(startMarkers(plan.content), 1);
});

test("keeps edits made inside the section, unless forced", () => {
  const original = planSectionUpdate("# Mine\n", RULES_V1).content;
  const edited = original.replace("Use feat or fix.", "Use feat or fix. Also: squash before merging.");

  const kept = planSectionUpdate(edited, RULES_V2);
  assert.equal(kept.status, "kept-edits");
  assert.equal(kept.content, null);

  const forced = planSectionUpdate(edited, RULES_V2, { force: true });
  assert.equal(forced.status, "updated");
  assert.match(forced.content, /feat, fix or docs/);
  assert.ok(forced.content.startsWith("# Mine\n"));
});

test("a hand-made section without a fingerprint counts as user content", () => {
  const legacy = "# Mine\n<!-- gitsmith:start -->\nmy custom text\n<!-- gitsmith:end -->\n";
  assert.equal(planSectionUpdate(legacy, RULES_V1).status, "kept-edits");
  const forced = planSectionUpdate(legacy, RULES_V1, { force: true });
  assert.equal(forced.status, "updated");
  assert.equal(startMarkers(forced.content), 1);
});

test("markers mentioned in prose or code blocks are never treated as markers", () => {
  const prose = "Use `<!-- gitsmith:start -->` and `<!-- gitsmith:end -->` markers.\n";
  const fenced = "Example:\n```md\n<!-- gitsmith:start -->\nexample\n<!-- gitsmith:end -->\n```\n";
  for (const existing of [prose, fenced]) {
    assert.deepEqual(findMarkers(existing), []);
    const plan = planSectionUpdate(existing, RULES_V1);
    assert.equal(plan.status, "appended");
    assert.ok(plan.content.startsWith(existing), "the user's text is untouched");
  }
});

test("broken marker layouts are reported and nothing is written", () => {
  const cases = {
    "start without end": "# Mine\n<!-- gitsmith:start -->\nold\n",
    "end without start": "# Mine\nold\n<!-- gitsmith:end -->\n",
    "end before start": "<!-- gitsmith:end -->\nx\n<!-- gitsmith:start -->\n",
    "two sections": "<!-- gitsmith:start -->\nA\n<!-- gitsmith:end -->\nX\n<!-- gitsmith:start -->\nB\n<!-- gitsmith:end -->\n"
  };
  for (const [name, existing] of Object.entries(cases)) {
    const plan = planSectionUpdate(existing, RULES_V1, { force: true });
    assert.equal(plan.status, "malformed", name);
    assert.equal(plan.content, null, name);
    assert.match(plan.message, /file was not changed/, name);
  }
});

test("a section at the very end of a file without a final newline stays that way", () => {
  const original = planSectionUpdate(null, RULES_V1).content.replace(/\n$/, "");
  const plan = planSectionUpdate(`# Top\n\n${original}`, RULES_V2);
  assert.equal(plan.status, "updated");
  assert.ok(plan.content.endsWith(SECTION_END));
});

test(".mcp.json keeps other servers and a customized gitsmith entry", () => {
  assert.equal(planMcpUpdate(null).status, "created");

  const others = planMcpUpdate({ mcpServers: { other: { command: "x" } } });
  assert.equal(others.status, "added");
  assert.deepEqual(Object.keys(others.config.mcpServers).sort(), ["gitsmith", "other"]);

  assert.equal(planMcpUpdate({ mcpServers: { gitsmith: MCP_SERVER_ENTRY } }).status, "unchanged");

  const custom = { mcpServers: { gitsmith: { command: "node", args: ["bin/cli.js", "mcp"] } } };
  assert.equal(planMcpUpdate(custom).status, "kept-custom");
  assert.deepEqual(planMcpUpdate(custom, { force: true }).config.mcpServers.gitsmith, MCP_SERVER_ENTRY);
});
