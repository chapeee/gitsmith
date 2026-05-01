import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getProviderModel,
  getProviderApiKey,
  getProviderStatus,
  getCredentialsPath,
  removeProviderApiKey,
  saveProviderApiKey,
  saveProviderModel
} from "../src/ai/credentials.js";

async function createHomeDir() {
  return mkdtemp(path.join(os.tmpdir(), "gitsmith-test-"));
}

test("env var key wins over saved file", async () => {
  const homeDir = await createHomeDir();
  await saveProviderApiKey("nvapi-file-123456", { homeDir });
  process.env.GITSMITH_AI_KEY = "nvapi-env-999999";

  const resolved = await getProviderApiKey({ homeDir });
  assert.equal(resolved.source, "env");
  assert.equal(resolved.apiKey, "nvapi-env-999999");

  delete process.env.GITSMITH_AI_KEY;
});

test("saved key is used when env var is empty", async () => {
  const homeDir = await createHomeDir();
  process.env.GITSMITH_AI_KEY = "";
  await saveProviderApiKey("nvapi-file-abcde", { homeDir });

  const resolved = await getProviderApiKey({ homeDir });
  assert.equal(resolved.source, "file");
  assert.equal(resolved.apiKey, "nvapi-file-abcde");
});

test("key:set storage writes credentials and unix mode is 0600", async () => {
  const homeDir = await createHomeDir();
  await saveProviderApiKey("nvapi-perm-check", { homeDir });

  const credentialsPath = getCredentialsPath(homeDir);
  const info = await stat(credentialsPath);
  if (process.platform !== "win32") {
    assert.equal(info.mode & 0o777, 0o600);
  } else {
    assert.ok(info.size > 0);
  }
});

test("removeProviderApiKey deletes saved key", async () => {
  const homeDir = await createHomeDir();
  await saveProviderApiKey("nvapi-remove-check", { homeDir });

  const removed = await removeProviderApiKey({ homeDir });
  assert.equal(removed, true);

  const status = await getProviderStatus({ homeDir });
  assert.equal(status.hasKey, false);
});

test("status returns masked key output", async () => {
  const homeDir = await createHomeDir();
  await saveProviderApiKey("nvapi-abcd1234efgh5678", { homeDir });

  const status = await getProviderStatus({ homeDir });
  assert.equal(status.hasKey, true);
  assert.match(status.maskedKey, /^nvapi-abcd/);
  assert.ok(status.maskedKey.includes("*"));
});

test("saved model is returned from credentials file", async () => {
  const homeDir = await createHomeDir();
  await saveProviderModel("qwen/qwen3-coder-30b", { homeDir });

  const resolved = await getProviderModel({ homeDir });
  assert.equal(resolved.source, "file");
  assert.equal(resolved.model, "qwen/qwen3-coder-30b");
});
