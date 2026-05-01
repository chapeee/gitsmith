import test from "node:test";
import assert from "node:assert/strict";
import { withAiDefaults } from "../src/config/loader.js";

test("withAiDefaults keeps missing ai block unchanged (feature off)", () => {
  const config = {
    types: ["feat"],
    askScope: false,
    askTicket: false,
    askBreaking: false,
    format: "{type}: {message}"
  };

  const result = withAiDefaults(config);
  assert.deepEqual(result, config);
  assert.equal(result.ai, undefined);
});

test("withAiDefaults fills ai defaults for partial enabled block", () => {
  const config = {
    types: ["feat"],
    askScope: false,
    askTicket: false,
    askBreaking: false,
    format: "{type}: {message}",
    ai: {
      enabled: true,
      model: "custom-model"
    }
  };

  const result = withAiDefaults(config);
  assert.equal(result.ai.enabled, true);
  assert.equal(result.ai.provider, "nvidia");
  assert.equal(result.ai.model, "custom-model");
  assert.equal(result.ai.endpoint, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(result.ai.askByDefault, true);
  assert.equal(result.ai.allowNewScopes, true);
  assert.equal(result.ai.maxContextFileLines, 500);
  assert.equal(result.ai.maxContextTotalLines, 1500);
  assert.equal(result.ai.mentionSuggestionLimit, 12);
});
