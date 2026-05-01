import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import {
  extractMentionedFiles,
  loadMentionedFileContexts,
  suggestMentionedFiles
} from "../src/ai/file-context.js";

test("extractMentionedFiles removes @mentions and keeps clean text", () => {
  const result = extractMentionedFiles(
    "updated auth flow @src/auth/login.ts and docs @./README.md, final polish"
  );

  assert.deepEqual(result.mentioned, ["src/auth/login.ts", "./README.md"]);
  assert.equal(result.cleaned, "updated auth flow and docs final polish");
});

test("suggestMentionedFiles performs fuzzy matching", () => {
  const files = ["src/auth/login.ts", "src/auth/logout.ts", "README.md"];
  const suggestions = suggestMentionedFiles(files, "logn", 5);
  assert.equal(suggestions[0], "src/auth/login.ts");
});

test("loadMentionedFileContexts enforces limits and keeps valid files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gitsmith-context-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "small.ts"), "line1\nline2\nline3\n", "utf8");
  await writeFile(path.join(root, "src", "big.ts"), "a\nb\nc\nd\ne\nf\n", "utf8");

  const result = await loadMentionedFileContexts({
    repoRoot: root,
    mentions: ["src/small.ts", "src/missing.ts", "src/big.ts"],
    extraPaths: [],
    maxFileLines: 5,
    maxTotalLines: 10
  });

  assert.equal(result.contexts.length, 1);
  assert.equal(result.contexts[0].path, "src/small.ts");
  assert.equal(result.contexts[0].lineCount, 4);
  assert.equal(result.warnings.length, 2);
});
