import test from "node:test";
import assert from "node:assert/strict";
import {
  AiNetworkError,
  AiResponseError,
  AiValidationError,
  suggestCommit
} from "../src/ai/nvidia.js";

const baseConfig = {
  types: ["feat", "fix", "docs"],
  askScope: true,
  scopes: ["ui", "api"],
  askTicket: false,
  askBreaking: true,
  format: "{type}({scope}): {message}",
  ai: {
    enabled: true,
    provider: "nvidia",
    model: "nvidia/llama-3.3-nemotron-super-49b-v1",
    endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
    askByDefault: true,
    allowNewScopes: true
  }
};

test("suggestCommit parses well-formed JSON response", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              type: "feat",
              scope: "ui",
              scopeIsNew: false,
              message: "add login flow",
              isBreaking: false,
              ticket: null,
              reason: "new UI feature"
            })
          }
        }
      ]
    })
  });

  const result = await suggestCommit({
    description: "added login UI",
    config: baseConfig,
    apiKey: "nvapi-test"
  });

  assert.equal(result.type, "feat");
  assert.equal(result.scope, "ui");
  global.fetch = originalFetch;
});

test("suggestCommit strips markdown fences before JSON parsing", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content:
              "```json\n{\"type\":\"fix\",\"scope\":\"api\",\"scopeIsNew\":false,\"message\":\"fix auth token check\",\"isBreaking\":false,\"ticket\":null,\"reason\":\"api auth fix\"}\n```"
          }
        }
      ]
    })
  });

  const result = await suggestCommit({
    description: "fixed auth token validation",
    config: baseConfig,
    apiKey: "nvapi-test"
  });

  assert.equal(result.type, "fix");
  assert.equal(result.scope, "api");
  global.fetch = originalFetch;
});

test("suggestCommit throws AiValidationError for invalid type", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              type: "chore",
              scope: "api",
              scopeIsNew: false,
              message: "cleanup",
              isBreaking: false,
              ticket: null,
              reason: "maintenance"
            })
          }
        }
      ]
    })
  });

  await assert.rejects(
    () => suggestCommit({ description: "cleanup", config: baseConfig, apiKey: "nvapi-test" }),
    (error) => error instanceof AiValidationError && error.field === "type"
  );
  global.fetch = originalFetch;
});

test("suggestCommit throws AiResponseError for invalid JSON", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: "not-json" } }]
    })
  });

  await assert.rejects(
    () => suggestCommit({ description: "cleanup", config: baseConfig, apiKey: "nvapi-test" }),
    (error) => error instanceof AiResponseError
  );
  global.fetch = originalFetch;
});

test("suggestCommit maps non-OK responses to AiNetworkError with status", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({})
  });

  await assert.rejects(
    () => suggestCommit({ description: "cleanup", config: baseConfig, apiKey: "bad-key" }),
    (error) => error instanceof AiNetworkError && error.status === 401
  );
  global.fetch = originalFetch;
});

test("suggestCommit maps unknown scope to nearest configured scope when allowNewScopes is false", async () => {
  const originalFetch = global.fetch;
  const lockedScopeConfig = {
    ...baseConfig,
    ai: {
      ...baseConfig.ai,
      allowNewScopes: false
    }
  };

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              type: "feat",
              scope: "payments",
              scopeIsNew: true,
              message: "add payment flow",
              isBreaking: false,
              ticket: null,
              reason: "new area"
            })
          }
        }
      ]
    })
  });

  const result = await suggestCommit({
    description: "added payments",
    config: lockedScopeConfig,
    apiKey: "nvapi-test"
  });

  assert.equal(result.scope, "api");
  assert.equal(result.scopeIsNew, false);
  global.fetch = originalFetch;
});

test("suggestCommit includes referenced file contents in prompt payload", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (_url, options = {}) => {
    capturedBody = JSON.parse(String(options.body ?? "{}"));
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "feat",
                scope: "api",
                scopeIsNew: false,
                message: "add endpoint input validation",
                isBreaking: false,
                ticket: null,
                reason: "api improvement"
              })
            }
          }
        ]
      })
    };
  };

  await suggestCommit({
    description: "updated validation",
    fileContexts: [
      {
        path: "src/api/validator.ts",
        lineCount: 3,
        content: "export function validate() {\n  return true;\n}\n"
      }
    ],
    config: baseConfig,
    apiKey: "nvapi-test"
  });

  const promptText = capturedBody?.messages?.[1]?.content ?? "";
  assert.match(promptText, /Referenced files/);
  assert.match(promptText, /src\/api\/validator\.ts/);
  assert.match(promptText, /export function validate/);
  global.fetch = originalFetch;
});

test("suggestCommit uses model override for request model field", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (_url, options = {}) => {
    capturedBody = JSON.parse(String(options.body ?? "{}"));
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "feat",
                scope: "api",
                scopeIsNew: false,
                message: "add model override support",
                isBreaking: false,
                ticket: null,
                reason: "model selected"
              })
            }
          }
        ]
      })
    };
  };

  await suggestCommit({
    description: "test override",
    config: baseConfig,
    apiKey: "nvapi-test",
    modelOverride: {
      id: "qwen/qwen3-coder-30b"
    }
  });

  assert.equal(capturedBody.model, "qwen/qwen3-coder-30b");
  global.fetch = originalFetch;
});
